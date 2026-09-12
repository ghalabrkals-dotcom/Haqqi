import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  effectiveStatus,
  expectedLabel,
  expectedWindow,
  formatMoney,
  outstanding,
  todayISO,
  type ReceivableRecord,
} from "@/lib/receivables";

const MS_DAY = 86_400_000;
const parseDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const daysFromToday = (iso: string) =>
  Math.round((parseDate(iso).getTime() - parseDate(todayISO()).getTime()) / MS_DAY);

type Bucket = "Overdue" | "Today" | "Next 7 Days" | "Next 14 Days" | "Later" | "Expected Date Unknown";

const BUCKET_ORDER: Bucket[] = [
  "Overdue",
  "Today",
  "Next 7 Days",
  "Next 14 Days",
  "Later",
  "Expected Date Unknown",
];

/** Final expected date for a receivable (business-day ranges use the last day). */
function finalExpected(r: ReceivableRecord): string | null {
  return expectedWindow(r)?.latest ?? null;
}

function bucketFor(r: ReceivableRecord): Bucket {
  if (effectiveStatus(r) === "Overdue") return "Overdue";
  const date = finalExpected(r);
  if (!date) return "Expected Date Unknown";
  const diff = daysFromToday(date);
  if (diff <= 0) return "Today";
  if (diff <= 7) return "Next 7 Days";
  if (diff <= 14) return "Next 14 Days";
  return "Later";
}

const statusClass = (status: string) =>
  status === "Received"
    ? "bg-success/15 text-success"
    : status === "Overdue"
      ? "bg-destructive/15 text-destructive"
      : "bg-warning/15 text-warning";

const dotClass = (status: string) =>
  status === "Received" ? "bg-success" : status === "Overdue" ? "bg-destructive" : "bg-warning";

export function ExpectedMoney({ items }: { items: ReceivableRecord[] }) {
  const open = useMemo(
    () => items.filter((r) => effectiveStatus(r) !== "Received" && outstanding(r) > 0),
    [items],
  );

  const currencies = useMemo(() => [...new Set(open.map((r) => r.currency))].sort(), [open]);

  const [chartCurrency, setChartCurrency] = useState<string | null>(null);
  const activeCurrency = chartCurrency && currencies.includes(chartCurrency)
    ? chartCurrency
    : (currencies[0] ?? "KWD");

  /** Per-currency summary totals — never converted or combined. */
  const summaries = useMemo(
    () =>
      currencies.map((currency) => {
        const rows = open.filter((r) => r.currency === currency);
        let outstandingTotal = 0;
        let next7 = 0;
        let next14 = 0;
        let overdue = 0;
        for (const r of rows) {
          const left = outstanding(r);
          outstandingTotal += left;
          if (effectiveStatus(r) === "Overdue") {
            overdue += left;
            continue;
          }
          const date = finalExpected(r);
          if (!date) continue;
          const diff = daysFromToday(date);
          if (diff <= 7) next7 += left;
          if (diff <= 14) next14 += left;
        }
        return { currency, outstandingTotal, next7, next14, overdue };
      }),
    [open, currencies],
  );

  const groups = useMemo(() => {
    const map = new Map<Bucket, ReceivableRecord[]>();
    for (const r of open) {
      const bucket = bucketFor(r);
      const list = map.get(bucket) ?? [];
      list.push(r);
      map.set(bucket, list);
    }
    return BUCKET_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
      bucket: b,
      rows: (map.get(b) ?? []).sort((a, c) =>
        (finalExpected(a) ?? "9999").localeCompare(finalExpected(c) ?? "9999"),
      ),
    }));
  }, [open]);

  /** Money expected to arrive over the next 30 days, in 5-day steps. Unknown dates excluded. */
  const chart = useMemo(() => {
    const rows = open.filter((r) => r.currency === activeCurrency);
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const from = i * 5 + 1;
      const to = (i + 1) * 5;
      return { key: `d${i}`, label: `${to}d`, from, to, amount: 0 };
    });
    let todayAmount = 0;
    for (const r of rows) {
      if (effectiveStatus(r) === "Overdue") continue;
      const date = finalExpected(r);
      if (!date) continue;
      const diff = daysFromToday(date);
      if (diff <= 0) {
        todayAmount += outstanding(r);
        continue;
      }
      const bucket = buckets.find((b) => diff >= b.from && diff <= b.to);
      if (bucket) bucket.amount += outstanding(r);
    }
    const all = [
      { key: "today", label: "Today", amount: todayAmount },
      ...buckets.map((b) => ({ key: b.key, label: b.label, amount: b.amount })),
    ];
    const max = Math.max(...all.map((b) => b.amount), 1);
    const total = all.reduce((sum, b) => sum + b.amount, 0);
    return { bars: all.map((b) => ({ ...b, height: Math.round((b.amount / max) * 100) })), total };
  }, [open, activeCurrency]);

  const projected = useMemo(() => {
    const summary = summaries.find((s) => s.currency === activeCurrency);
    return {
      outstanding: summary?.outstandingTotal ?? 0,
      next30: chart.total,
    };
  }, [summaries, activeCurrency, chart]);

  const notes = useMemo(() => {
    const list: string[] = [];
    for (const s of summaries) {
      if (s.next7 > 0) {
        list.push(`${formatMoney(s.next7, s.currency)} is expected within the next 7 days.`);
      }
      if (s.overdue > 0) {
        list.push(`You have ${formatMoney(s.overdue, s.currency)} currently overdue.`);
      }
      if (s.outstandingTotal > 0 && s.next14 / s.outstandingTotal > 0.5) {
        list.push(
          `Most of your outstanding ${s.currency} is expected within the next 14 days.`,
        );
      }
    }
    const week = open.filter((r) => {
      if (effectiveStatus(r) === "Overdue") return false;
      const date = finalExpected(r);
      return date ? daysFromToday(date) >= 0 && daysFromToday(date) <= 7 : false;
    }).length;
    if (week > 0) {
      list.push(`You have ${week} ${week === 1 ? "payment" : "payments"} expected this week.`);
    }
    const unknown = open.filter((r) => !finalExpected(r)).length;
    if (unknown > 0) {
      list.push(
        `${unknown} ${unknown === 1 ? "item has" : "items have"} no expected date yet.`,
      );
    }
    return list;
  }, [summaries, open]);

  return (
    <section className="space-y-6">
      <div className="surface-card p-6">
        <h2 className="section-label">Expected Money</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          See what money is expected to come back to you and when.
        </p>

        {open.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            You have no outstanding money right now.
          </p>
        ) : (
          summaries.map((s) => (
            <div key={s.currency} className="mt-5">
              {summaries.length > 1 ? (
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.currency}
                </p>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { l: "Outstanding Money", v: s.outstandingTotal },
                  { l: "Expected in Next 7 Days", v: s.next7 },
                  { l: "Expected in Next 14 Days", v: s.next14 },
                  { l: "Overdue Money", v: s.overdue },
                ].map((k) => (
                  <div key={k.l}>
                    <p className="text-xs text-muted-foreground">{k.l}</p>
                    <p className="numeric mt-2 text-xl font-semibold">
                      {formatMoney(k.v, s.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {open.length > 0 ? (
        <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
          <div className="surface-card p-6">
            <h3 className="font-display text-[15px]">Money Coming Back</h3>
            <div className="mt-5 space-y-6">
              {groups.map((g) => (
                <div key={g.bucket}>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {g.bucket}
                  </p>
                  <div className="mt-3 space-y-2">
                    {g.rows.map((r) => {
                      const status = effectiveStatus(r);
                      return (
                        <Link
                          key={r.id}
                          to="/money/$id"
                          params={{ id: r.id }}
                          className="flex items-center gap-3 rounded-md border border-border/70 p-3 transition-colors hover:bg-muted/60"
                        >
                          <span className={`h-2.5 w-2.5 rounded-full ${dotClass(status)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{r.owed_by}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {r.type} · {expectedLabel(r)}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="numeric block text-sm font-semibold">
                              {formatMoney(outstanding(r), r.currency)}
                            </span>
                            <span
                              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${statusClass(status)}`}
                            >
                              {status}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="surface-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-[15px]">Expected Money Over Time</h3>
                {currencies.length > 1 ? (
                  <div className="flex gap-2">
                    {currencies.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={c === activeCurrency}
                        onClick={() => setChartCurrency(c)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          c === activeCurrency
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Next 30 days, in {activeCurrency}. Items without an expected date are not shown.
              </p>
              <div className="mt-6 flex h-40 items-end gap-3">
                {chart.bars.map((b) => (
                  <div key={b.key} className="flex flex-1 flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t-lg bg-sand transition-colors hover:bg-primary"
                      style={{ height: `${Math.max(b.height, 3)}%` }}
                      title={formatMoney(b.amount, activeCurrency)}
                    />
                    <span className="text-[11px] text-muted-foreground">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface-card p-6">
              <h3 className="font-display text-[15px]">Projected Incoming Money</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Expected incoming money only. Haqqi is not connected to a bank and this is not your
                account balance.
              </p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Current outstanding</p>
                  <p className="numeric mt-2 text-xl font-semibold">
                    {formatMoney(projected.outstanding, activeCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected in next 30 days</p>
                  <p className="numeric mt-2 text-xl font-semibold">
                    {formatMoney(projected.next30, activeCurrency)}
                  </p>
                </div>
              </div>
            </div>

            <div className="surface-card p-6">
              <h3 className="font-display text-[15px]">Cash-flow insights</h3>
              {notes.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Not enough data yet</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {notes.map((note) => (
                    <li key={note} className="rounded-lg bg-muted/60 p-3 text-sm">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
