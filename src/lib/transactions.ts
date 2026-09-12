import { supabase } from "@/integrations/supabase/client";
import {
  effectiveStatus,
  outstanding,
  todayISO,
  type ReceivableRecord,
} from "@/lib/receivables";

export type BankTransaction = {
  id: string;
  transaction_date: string;
  sender_name: string;
  amount: number;
  currency: string;
  reference: string | null;
  notes: string | null;
  matched_receivable_id: string | null;
  matched_at: string | null;
  created_at: string;
};

const FIELDS =
  "id, transaction_date, sender_name, amount, currency, reference, notes, matched_receivable_id, matched_at, created_at";

export async function loadTransactions(): Promise<BankTransaction[]> {
  const { data } = await supabase
    .from("bank_transactions")
    .select(FIELDS)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });
  return ((data ?? []) as BankTransaction[]).map((t) => ({ ...t, amount: Number(t.amount) }));
}

/* ------------------------------------------------------------------ seeding */

const YEAR = new Date().getFullYear();
const d = (month: number, day: number) =>
  `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const starterTransactions = [
  { sender_name: "Zara", amount: 42, transaction_date: d(9, 8), reference: "ZR-88213" },
  { sender_name: "Booking.com", amount: 75, transaction_date: d(9, 17), reference: "BK-40915" },
  { sender_name: "Avis", amount: 60, transaction_date: d(9, 10), reference: "AV-2207" },
];

let inFlight: Promise<void> | null = null;

async function seed() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return;

  const { count, error } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true });
  if (error || (count ?? 0) > 0) return;

  await supabase.from("bank_transactions").insert(
    starterTransactions.map((t) => ({
      user_id: user.id,
      sender_name: t.sender_name,
      amount: t.amount,
      currency: "KWD",
      transaction_date: t.transaction_date,
      reference: t.reference,
    })),
  );
}

/** Adds the sample incoming transactions once per account; never duplicates on refresh. */
export function ensureStarterTransactions(): Promise<void> {
  if (!inFlight) inFlight = seed().catch(() => undefined);
  return inFlight;
}

/* ------------------------------------------------------------------ matching */

export type MatchStrength = "High" | "Medium";

export type Suggestion = {
  receivable: ReceivableRecord;
  strength: MatchStrength;
  coversFull: boolean;
  reasons: string[];
};

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.(com|net|co)\b/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function nameSimilarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const xs = new Set(x.split(" "));
  const ys = y.split(" ");
  const shared = ys.filter((token) => token.length > 2 && xs.has(token)).length;
  if (shared > 0) return 0.7;
  // small typo tolerance on the first token
  const [xf = "", yf = ""] = [x.split(" ")[0], y.split(" ")[0]];
  if (xf.length > 3 && yf.length > 3 && (xf.startsWith(yf.slice(0, 4)) || yf.startsWith(xf.slice(0, 4))))
    return 0.6;
  return 0;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const daysApart = (a: string, b: string) =>
  Math.abs(
    (new Date(`${a.slice(0, 10)}T00:00:00`).getTime() -
      new Date(`${b.slice(0, 10)}T00:00:00`).getTime()) /
      86_400_000,
  );

/**
 * Rule-based suggestions for one incoming transaction.
 * Never confirms anything — the user always decides.
 */
export function suggestMatches(
  transaction: BankTransaction,
  receivables: ReceivableRecord[],
): Suggestion[] {
  if (transaction.matched_receivable_id) return [];
  const open = receivables.filter(
    (r) => effectiveStatus(r) !== "Received" && outstanding(r) > 0.0001,
  );

  const suggestions: Suggestion[] = [];
  for (const r of open) {
    if (r.currency !== transaction.currency) continue;

    const remaining = outstanding(r);
    const exactAmount = near(remaining, transaction.amount) || near(Number(r.amount), transaction.amount);
    const partialAmount = !exactAmount && transaction.amount < remaining;
    if (!exactAmount && !partialAmount) continue;

    const similarity = nameSimilarity(transaction.sender_name, r.owed_by);
    const referenceHit =
      !!transaction.reference &&
      !!r.reference_number &&
      normalise(transaction.reference) === normalise(r.reference_number);

    const closeInTime = daysApart(transaction.transaction_date, r.date_owed) <= 60;
    if (!referenceHit && similarity === 0) continue;
    if (!closeInTime && !referenceHit) continue;

    const reasons: string[] = [];
    if (exactAmount) reasons.push("Amount matches exactly");
    else reasons.push("Covers part of the amount");
    reasons.push("Same currency");
    if (referenceHit) reasons.push("Reference number matches");
    if (similarity >= 0.85) reasons.push("Name matches");
    else if (similarity > 0) reasons.push("Name looks similar");

    const strength: MatchStrength =
      referenceHit || (exactAmount && similarity >= 0.85) ? "High" : "Medium";

    suggestions.push({
      receivable: r,
      strength,
      coversFull: transaction.amount >= remaining - 0.005,
      reasons,
    });
  }

  return suggestions.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === "High" ? -1 : 1;
    return outstanding(a.receivable) - outstanding(b.receivable);
  });
}

/** Records the incoming money as a payment against the receivable and locks the transaction. */
export async function confirmMatch(
  transaction: BankTransaction,
  receivable: ReceivableRecord,
): Promise<{ error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { error: "Please sign in again." };
  if (transaction.matched_receivable_id) return { error: "This transaction is already matched." };

  const remaining = outstanding(receivable);
  if (remaining <= 0.0001) return { error: "This money has already been fully received." };
  const applied = Math.min(transaction.amount, remaining);

  // Claim the transaction first so the same money can never be matched twice.
  const { data: claimed, error: claimError } = await supabase
    .from("bank_transactions")
    .update({ matched_receivable_id: receivable.id, matched_at: new Date().toISOString() })
    .eq("id", transaction.id)
    .is("matched_receivable_id", null)
    .select("id");
  if (claimError) return { error: "We couldn't update that transaction. Please try again." };
  if (!claimed || claimed.length === 0) return { error: "This transaction is already matched." };

  const { error: paymentError } = await supabase.from("receivable_payments").insert({
    receivable_id: receivable.id,
    user_id: user.id,
    amount: applied,
    currency: receivable.currency,
    received_date: transaction.transaction_date.slice(0, 10) || todayISO(),
  });
  if (paymentError) {
    await supabase
      .from("bank_transactions")
      .update({ matched_receivable_id: null, matched_at: null })
      .eq("id", transaction.id);
    return { error: "We couldn't record that payment. Please try again." };
  }

  if (applied >= remaining - 0.005) {
    await supabase.from("receivables").update({ status: "Received" }).eq("id", receivable.id);
  }

  return {};
}
