import { supabase } from "@/integrations/supabase/client";

export type PaymentRecord = {
  id: string;
  receivable_id: string;
  amount: number;
  currency: string;
  received_date: string;
  created_at: string;
};

export type ReceivableRecord = {
  id: string;
  owed_by: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  date_owed: string;
  expected_return_type: string | null;
  expected_date: string | null;
  min_business_days: number | null;
  max_business_days: number | null;
  payment_method?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  payments?: PaymentRecord[];
};

export const RECEIVABLE_FIELDS =
  "id, owed_by, type, amount, currency, status, date_owed, expected_return_type, expected_date, min_business_days, max_business_days, payment_method, reference_number, notes, created_at, updated_at";

export const PAYMENT_FIELDS = "id, receivable_id, amount, currency, received_date, created_at";

/** Loads the signed-in user's receivables with their recorded payments attached. */
export async function loadReceivables(): Promise<ReceivableRecord[]> {
  const [{ data: rows }, { data: payments }] = await Promise.all([
    supabase.from("receivables").select(RECEIVABLE_FIELDS).order("created_at", { ascending: false }),
    supabase
      .from("receivable_payments")
      .select(PAYMENT_FIELDS)
      .order("received_date", { ascending: true }),
  ]);
  const byReceivable = new Map<string, PaymentRecord[]>();
  for (const p of (payments ?? []) as PaymentRecord[]) {
    const list = byReceivable.get(p.receivable_id) ?? [];
    list.push({ ...p, amount: Number(p.amount) });
    byReceivable.set(p.receivable_id, list);
  }
  return ((rows ?? []) as ReceivableRecord[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    payments: byReceivable.get(r.id) ?? [],
  }));
}

/** Loads one receivable (owner-only through RLS) with its payments. */
export async function loadReceivable(id: string): Promise<ReceivableRecord | null> {
  const [{ data: row }, { data: payments }] = await Promise.all([
    supabase.from("receivables").select(RECEIVABLE_FIELDS).eq("id", id).maybeSingle(),
    supabase
      .from("receivable_payments")
      .select(PAYMENT_FIELDS)
      .eq("receivable_id", id)
      .order("received_date", { ascending: true }),
  ]);
  if (!row) return null;
  const record = row as ReceivableRecord;
  return {
    ...record,
    amount: Number(record.amount),
    payments: ((payments ?? []) as PaymentRecord[]).map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}


const MS_DAY = 86_400_000;

const parse = (iso: string) => new Date(`${iso}T00:00:00`);

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const todayISO = () => toISO(new Date());

/** Monday–Friday only; Saturday and Sunday are skipped. */
export function addBusinessDays(startISO: string, days: number): string {
  const date = parse(startISO);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return toISO(date);
}

export type ExpectedWindow = { earliest: string; latest: string; exact: boolean };

export function expectedWindow(r: ReceivableRecord): ExpectedWindow | null {
  const kind = r.expected_return_type ?? (r.expected_date ? "exact_date" : "unknown");
  if (kind === "exact_date" && r.expected_date) {
    return { earliest: r.expected_date, latest: r.expected_date, exact: true };
  }
  if (kind === "business_days" && r.min_business_days !== null && r.max_business_days !== null) {
    return {
      earliest: addBusinessDays(r.date_owed, r.min_business_days),
      latest: addBusinessDays(r.date_owed, r.max_business_days),
      exact: false,
    };
  }
  if (r.expected_date) {
    return { earliest: r.expected_date, latest: r.expected_date, exact: true };
  }
  return null;
}

export type EffectiveStatus = "Received" | "Pending" | "Overdue";

const isStoredReceived = (r: ReceivableRecord) => r.status.toLowerCase() === "received";

/** Total money already received against this receivable. */
export function totalReceived(r: ReceivableRecord): number {
  const payments = r.payments ?? [];
  if (payments.length > 0) {
    const sum = payments.reduce((total, p) => total + Number(p.amount), 0);
    return Math.min(sum, Number(r.amount));
  }
  return isStoredReceived(r) ? Number(r.amount) : 0;
}

/** Money still outstanding on this receivable. */
export function outstanding(r: ReceivableRecord): number {
  return Math.max(0, Number(r.amount) - totalReceived(r));
}

/** Each payment recorded against the receivable, oldest first. */
export function receivedEvents(r: ReceivableRecord): { amount: number; date: string }[] {
  const payments = r.payments ?? [];
  if (payments.length > 0) {
    return payments
      .map((p) => ({ amount: Number(p.amount), date: p.received_date }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  if (isStoredReceived(r)) {
    return [{ amount: Number(r.amount), date: (r.updated_at ?? r.created_at).slice(0, 10) }];
  }
  return [];
}

/** Received never changes. Anything else with a passed final expected date is Overdue. */
export function effectiveStatus(r: ReceivableRecord): EffectiveStatus {
  if (isStoredReceived(r) || outstanding(r) === 0) return "Received";
  const window = expectedWindow(r);
  if (window && window.latest < todayISO()) return "Overdue";
  return "Pending";
}


const dayMonth = (iso: string) =>
  parse(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function expectedLabel(r: ReceivableRecord): string {
  const window = expectedWindow(r);
  if (!window) return "Expected date unknown";
  if (window.earliest === window.latest) return `Expected ${dayMonth(window.latest)}`;
  return `Expected ${dayMonth(window.earliest)} – ${dayMonth(window.latest)}`;
}

/** "Expected in 4 days" / "Expected tomorrow" / "3 days overdue"; null when not applicable. */
export function timingLabel(r: ReceivableRecord): string | null {
  if (effectiveStatus(r) === "Received") return null;
  const window = expectedWindow(r);
  if (!window) return null;
  const diff = Math.round((parse(window.latest).getTime() - parse(todayISO()).getTime()) / MS_DAY);
  if (diff < 0) {
    const n = Math.abs(diff);
    return `${n} ${n === 1 ? "day" : "days"} overdue`;
  }
  if (diff === 0) return "Expected today";
  if (diff === 1) return "Expected tomorrow";
  return `Expected in ${diff} days`;
}

/** Not received, has an expected date, sorted by the earliest expected date first. */
export function expectedSoon(items: ReceivableRecord[]): ReceivableRecord[] {
  return items
    .filter((r) => effectiveStatus(r) !== "Received" && expectedWindow(r) !== null)
    .sort((a, b) =>
      (expectedWindow(a)?.earliest ?? "").localeCompare(expectedWindow(b)?.earliest ?? ""),
    );
}

/** Shared money formatting: KD 42.000 / 42.00 USD. */
export function formatMoney(amount: number, currency: string): string {
  const digits = currency === "KWD" ? 3 : 2;
  const value = Number(amount).toLocaleString("en-KW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return currency === "KWD" ? `KD ${value}` : `${value} ${currency}`;
}

export type ActivityEntry = {
  key: string;
  receivable: ReceivableRecord;
  kind: "tracked" | "received";
  date: string;
  label: string;
  /** Amount this specific entry represents, in the receivable's currency. */
  amount: number;
};

/** One entry when the money was tracked, plus one entry per payment received. */
export function activityEntries(items: ReceivableRecord[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const r of items) {
    entries.push({
      key: `${r.id}-tracked`,
      receivable: r,
      kind: "tracked",
      date: r.created_at,
      amount: Number(r.amount),
      label: `${formatMoney(Number(r.amount), r.currency)} ${r.type.toLowerCase()} added from ${r.owed_by}`,
    });
    receivedEvents(r).forEach((event, i) => {
      const full = event.amount >= Number(r.amount) - 0.0001;
      entries.push({
        key: `${r.id}-received-${i}`,
        receivable: r,
        kind: "received",
        date: `${event.date.slice(0, 10)}T23:59:59`,
        amount: event.amount,
        label: full
          ? `Received ${formatMoney(event.amount, r.currency)} from ${r.owed_by}`
          : `Received ${formatMoney(event.amount, r.currency)} of ${formatMoney(Number(r.amount), r.currency)} from ${r.owed_by}`,
      });
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
