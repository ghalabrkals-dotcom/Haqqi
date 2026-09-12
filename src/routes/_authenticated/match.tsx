import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, Link2, Plus, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/haqqi/app-shell";
import { UpgradeNotice } from "@/components/haqqi/plus";
import { useSubscription } from "@/lib/subscription";
import { supabase } from "@/integrations/supabase/client";
import { ensureStarterRecords } from "@/lib/seed-receivables";
import {
  formatMoney,
  loadReceivables,
  outstanding,
  todayISO,
  type ReceivableRecord,
} from "@/lib/receivables";
import {
  confirmMatch,
  ensureStarterTransactions,
  loadTransactions,
  suggestMatches,
  type BankTransaction,
  type Suggestion,
} from "@/lib/transactions";

export const Route = createFileRoute("/_authenticated/match")({
  head: () => ({
    meta: [
      { title: "Match Transactions — Haqqi" },
      {
        name: "description",
        content:
          "Simulate how Haqqi could match incoming bank transactions with the money you are expecting.",
      },
      { property: "og:title", content: "Match Transactions — Haqqi" },
      {
        property: "og:description",
        content: "A safe demo of bank transaction matching against your pending and overdue money.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MatchPage,
});

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20";

const currencies = ["KWD", "USD", "EUR", "GBP", "AED", "SAR"];

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const DISMISS_KEY = "haqqi.match.dismissed";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StrengthPill({ strength }: { strength: "High" | "Medium" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        strength === "High" ? "bg-success/12 text-success" : "bg-warning/15 text-warning-foreground"
      }`}
    >
      {strength} Match
    </span>
  );
}

function MatchPage() {
  const { isPlus } = useSubscription();
  const [receivables, setReceivables] = useState<ReceivableRecord[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [matching, setMatching] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [sender, setSender] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KWD");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    const [items, txns] = await Promise.all([loadReceivables(), loadTransactions()]);
    setReceivables(items);
    setTransactions(txns);
    setLoading(false);
  }, []);

  useEffect(() => {
    setDismissed(readDismissed());
    let active = true;
    Promise.all([ensureStarterRecords(), ensureStarterTransactions()])
      .then(() => (active ? refresh() : undefined))
      .catch(() => (active ? setLoading(false) : undefined));
    return () => {
      active = false;
    };
  }, [refresh]);

  const dismiss = (key: string) => {
    const next = Array.from(new Set([...dismissed, key]));
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const byId = useMemo(
    () => new Map(receivables.map((r) => [r.id, r] as const)),
    [receivables],
  );

  const rows = useMemo(
    () =>
      transactions.map((t) => {
        const suggestions = suggestMatches(t, receivables).filter(
          (s) => !dismissed.includes(`${t.id}:${s.receivable.id}`),
        );
        return { transaction: t, suggestions };
      }),
    [transactions, receivables, dismissed],
  );

  async function addTransaction(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const value = Number(amount);
    if (!sender.trim() || !Number.isFinite(value) || value <= 0 || !date) {
      setError("Please add a sender name, an amount above zero and a date.");
      return;
    }
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) {
      setSaving(false);
      setError("Please sign in again.");
      return;
    }
    const { error: insertError } = await supabase.from("bank_transactions").insert({
      user_id: user.id,
      transaction_date: date,
      sender_name: sender.trim(),
      amount: value,
      currency,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (insertError) {
      setError("We couldn't add that transaction. Please try again.");
      return;
    }
    setSender("");
    setAmount("");
    setReference("");
    setNotes("");
    setDate(todayISO());
    setShowForm(false);
    setMessage("Transaction added.");
    await refresh();
  }

  async function accept(transaction: BankTransaction, suggestion: Suggestion) {
    if (matching) return;
    setMatching(transaction.id);
    setError(null);
    setMessage(null);
    const result = await confirmMatch(transaction, suggestion.receivable);
    if (result.error) {
      setError(result.error);
      setMatching(null);
      await refresh();
      return;
    }
    setMessage(
      suggestion.coversFull
        ? `Matched. ${suggestion.receivable.owed_by} is now marked as received.`
        : `Matched as a partial payment towards ${suggestion.receivable.owed_by}.`,
    );
    await refresh();
    setMatching(null);
  }

  if (!isPlus) {
    return (
      <AppShell>
        <PageHeader
          title="Match Transactions"
          subtitle="Simulate how Haqqi could match incoming bank transactions with money you are expecting."
        />
        <div className="mt-8 max-w-2xl">
          <UpgradeNotice
            title="Demo Transaction Matching"
            description="Haqqi Plus suggests which incoming transactions match the money you are waiting for, and records the payment for you."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Match Transactions"
        subtitle="Simulate how Haqqi could match incoming bank transactions with money you are expecting."
        action={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            Add Transaction
          </button>
        }
      />

      <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-secondary-foreground">
        <ShieldCheck className="size-3.5" />
        Demo Bank Matching
      </span>

      {error ? (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-md bg-success/12 px-4 py-3 text-sm text-success">{message}</p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={addTransaction}
          className="mt-6 rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6"
        >
          <h2 className="section-label">Add an incoming transaction</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Row label="Transaction Date">
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Row>
            <Row label="Sender / Merchant Name">
              <input
                className={inputClass}
                placeholder="Zara"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
              />
            </Row>
            <Row label="Amount">
              <input
                inputMode="decimal"
                className={inputClass}
                placeholder="42.000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Row>
            <Row label="Currency">
              <select
                className={inputClass}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Reference (optional)">
              <input
                className={inputClass}
                placeholder="ZR-88213"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Row>
            <Row label="Notes (optional)">
              <input
                className={inputClass}
                placeholder="Anything worth remembering"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Row>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-6 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto sm:px-8"
          >
            {saving ? "Adding…" : "Add Transaction"}
          </button>
        </form>
      ) : null}

      <section className="mt-8 space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading transactions…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No incoming transactions yet. Add one to see how matching works.
            </p>
          </div>
        ) : (
          rows.map(({ transaction, suggestions }) => {
            const matched = transaction.matched_receivable_id
              ? byId.get(transaction.matched_receivable_id)
              : null;
            return (
              <article
                key={transaction.id}
                className="rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold tracking-tight">{transaction.sender_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {shortDate(transaction.transaction_date)}
                      {transaction.reference ? ` · Ref ${transaction.reference}` : ""}
                    </p>
                    {transaction.notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">{transaction.notes}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg text-success">
                      + {formatMoney(transaction.amount, transaction.currency)}
                    </p>
                    {transaction.matched_receivable_id ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-semibold text-success">
                        <CheckCircle2 className="size-3.5" />
                        Matched
                      </span>
                    ) : suggestions.length === 0 ? (
                      <span className="mt-1 inline-block rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
                        Unmatched
                      </span>
                    ) : null}
                  </div>
                </div>

                {transaction.matched_receivable_id ? (
                  <p className="mt-4 flex items-center gap-2 rounded-md bg-secondary/60 px-4 py-3 text-sm">
                    <Link2 className="size-4 shrink-0 text-muted-foreground" />
                    Matched to{" "}
                    {matched ? (
                      <Link
                        to="/money/$id"
                        params={{ id: matched.id }}
                        className="font-semibold underline underline-offset-4"
                      >
                        {matched.owed_by} — {matched.type}
                      </Link>
                    ) : (
                      <span className="font-semibold">a receivable</span>
                    )}
                  </p>
                ) : suggestions.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No likely receivable found for this transaction.
                  </p>
                ) : (
                  suggestions.map((s) => (
                    <div
                      key={s.receivable.id}
                      className="mt-4 rounded-md border border-border bg-background/60 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Possible Match Found</p>
                        <StrengthPill strength={s.strength} />
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-card p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Expected
                          </p>
                          <p className="mt-1 text-sm font-semibold">
                            {s.receivable.owed_by} {s.receivable.type}
                          </p>
                          <p className="text-sm">
                            {formatMoney(outstanding(s.receivable), s.receivable.currency)} still
                            owed
                          </p>
                        </div>
                        <div className="rounded-lg bg-card p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Incoming
                          </p>
                          <p className="mt-1 text-sm font-semibold">{transaction.sender_name}</p>
                          <p className="text-sm text-success">
                            + {formatMoney(transaction.amount, transaction.currency)}
                          </p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-muted-foreground">{s.reasons.join(" · ")}</p>

                      <p className="mt-3 text-sm font-medium">
                        Is this the money you were expecting?
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => accept(transaction, s)}
                          disabled={matching !== null}
                          className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          {matching === transaction.id ? "Matching…" : "Yes, Match It"}
                        </button>
                        <button
                          type="button"
                          onClick={() => dismiss(`${transaction.id}:${s.receivable.id}`)}
                          disabled={matching !== null}
                          className="rounded-md border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-60"
                        >
                          Not a Match
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </article>
            );
          })
        )}
      </section>

      <section className="mt-8 rounded-lg border border-border bg-secondary/40 p-5">
        <h2 className="flex items-center gap-2 font-display text-[15px]">
          <Info className="size-4 text-muted-foreground" />
          Future Open Banking
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          With user consent, future versions of Haqqi could securely connect to regulated Open
          Banking services to detect incoming transactions and suggest matches automatically.
        </p>
      </section>
    </AppShell>
  );
}
