import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/haqqi/app-shell";
import { ExpectedMoney } from "@/components/haqqi/expected-money";
import { UpgradeNotice } from "@/components/haqqi/plus";
import { useSubscription } from "@/lib/subscription";
import { ensureStarterRecords } from "@/lib/seed-receivables";
import {
  effectiveStatus,
  expectedWindow,
  formatMoney,
  loadReceivables,
  outstanding,
  receivedEvents,
  todayISO,
  totalReceived,
  type ReceivableRecord,
} from "@/lib/receivables";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Haqqi" },
      { name: "description", content: "See where your money is stuck and how fast it comes back." },
      { property: "og:title", content: "Insights — Haqqi" },
      {
        property: "og:description",
        content: "Money in limbo, recovery speed and your Haqqi Score.",
      },
    ],
  }),
  component: Insights,
});

const MS_DAY = 86_400_000;
const NOT_ENOUGH = "Not enough data yet";

const parseDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const dayMonth = (iso: string) =>
  parseDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_DAY));

function Insights() {
  const [items, setItems] = useState<ReceivableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<30 | 90 | 180>(30);
  const [scoreInfo, setScoreInfo] = useState(false);
  const { isPlus } = useSubscription();

  useEffect(() => {
    let active = true;
    ensureStarterRecords()
      .then(() => loadReceivables())
      .then((data) => {
        if (!active) return;
        setItems(data);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currencies = useMemo(
    () => [...new Set(items.map((r) => r.currency))].sort(),
    [items],
  );
  const mainCurrency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of items) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "KWD";
  }, [items]);

  /** Totals kept strictly per currency — no conversion, no mixing. */
  const totals = useMemo(() => {
    const monthPrefix = todayISO().slice(0, 7);
    return currencies.map((currency) => {
      const rows = items.filter((r) => r.currency === currency);
      let owed = 0;
      let pending = 0;
      let overdue = 0;
      let receivedMonth = 0;
      let receivedAll = 0;
      for (const r of rows) {
        const status = effectiveStatus(r);
        const left = outstanding(r);
        owed += left;
        if (status === "Overdue") overdue += left;
        else if (status === "Pending") pending += left;
        for (const event of receivedEvents(r)) {
          receivedAll += event.amount;
          if (event.date.slice(0, 7) === monthPrefix) receivedMonth += event.amount;
        }
      }
      return { currency, owed, pending, overdue, receivedMonth, receivedAll };
    });
  }, [items, currencies]);

  const main = useMemo(() => items.filter((r) => r.currency === mainCurrency), [items, mainCurrency]);

  const recovery = useMemo(() => {
    const completionDays: number[] = [];
    const refundDays: number[] = [];
    for (const r of main) {
      if (effectiveStatus(r) !== "Received") continue;
      const events = receivedEvents(r);
      const last = events[events.length - 1];
      if (!last) continue;
      const days = daysBetween(r.date_owed, last.date);
      completionDays.push(days);
      if (r.type.toLowerCase().includes("refund")) refundDays.push(days);
    }
    const avg = (list: number[]) =>
      list.length >= 2 ? `${Math.round(list.reduce((a, b) => a + b, 0) / list.length)} days` : NOT_ENOUGH;

    const open = main.filter((r) => effectiveStatus(r) !== "Received");
    const overdueOpen = open.filter((r) => effectiveStatus(r) === "Overdue");
    const oldest = [...open].sort((a, b) => a.date_owed.localeCompare(b.date_owed))[0];
    const largest = [...open].sort((a, b) => outstanding(b) - outstanding(a))[0];

    return {
      avgReceive: avg(completionDays),
      avgRefund: avg(refundDays),
      openCount: open.length,
      overdueCount: overdueOpen.length,
      oldest: oldest
        ? `${oldest.owed_by} — since ${dayMonth(oldest.date_owed)}`
        : NOT_ENOUGH,
      largest: largest
        ? `${formatMoney(outstanding(largest), largest.currency)} — ${largest.owed_by}`
        : NOT_ENOUGH,
      open,
      overdueOpen,
    };
  }, [main]);

  /** 0–100 health of outstanding money: overdue share, overdue age and on-time arrivals. */
  const score = useMemo(() => {
    if (main.length === 0) return null;
    const open = recovery.open;
    const outstandingTotal = open.reduce((sum, r) => sum + outstanding(r), 0);
    const overdueTotal = recovery.overdueOpen.reduce((sum, r) => sum + outstanding(r), 0);
    const overdueShare = outstandingTotal > 0 ? overdueTotal / outstandingTotal : 0;

    const overdueAges = recovery.overdueOpen.map((r) => {
      const window = expectedWindow(r);
      return window ? daysBetween(window.latest, todayISO()) : 0;
    });
    const worstAge = overdueAges.length ? Math.max(...overdueAges) : 0;

    const settled = main.filter((r) => effectiveStatus(r) === "Received");
    const onTime = settled.filter((r) => {
      const window = expectedWindow(r);
      const events = receivedEvents(r);
      const last = events[events.length - 1];
      if (!window || !last) return true;
      return last.date.slice(0, 10) <= window.latest;
    });
    const onTimeRate = settled.length ? onTime.length / settled.length : 1;

    const value = Math.max(
      0,
      Math.min(
        100,
        Math.round(100 - overdueShare * 55 - Math.min(worstAge, 60) * 0.35 - (1 - onTimeRate) * 20),
      ),
    );

    const message =
      overdueShare >= 0.5
        ? "A large portion of your outstanding money is currently overdue."
        : overdueShare > 0
          ? "You have some overdue money worth following up on."
          : "Most of your expected money is arriving on time.";

    return { value, message };
  }, [main, recovery]);

  const breakdown = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    let received = 0;
    for (const r of main) {
      const status = effectiveStatus(r);
      const left = outstanding(r);
      received += totalReceived(r);
      if (status === "Overdue") overdue += left;
      else if (status === "Pending") pending += left;
    }
    const total = pending + overdue + received;
    return {
      total,
      slices: [
        { label: "Pending", amount: pending, className: "bg-warning" },
        { label: "Overdue", amount: overdue, className: "bg-destructive" },
        { label: "Received", amount: received, className: "bg-success" },
      ],
    };
  }, [main]);

  const receivedSeries = useMemo(() => {
    const buckets =
      range === 30
        ? Array.from({ length: 6 }, (_, i) => {
            const end = new Date();
            end.setDate(end.getDate() - (5 - i) * 5);
            const start = new Date(end);
            start.setDate(start.getDate() - 4);
            return {
              key: `w${i}`,
              label: `${start.getDate()}/${start.getMonth() + 1}`,
              from: start,
              to: end,
              amount: 0,
            };
          })
        : Array.from({ length: range === 90 ? 3 : 6 }, (_, i) => {
            const count = range === 90 ? 3 : 6;
            const now = new Date();
            const dt = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
            const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
            return {
              key: `${dt.getFullYear()}-${dt.getMonth()}`,
              label: dt.toLocaleDateString("en-GB", { month: "short" }),
              from: dt,
              to: end,
              amount: 0,
            };
          });

    for (const r of main) {
      for (const event of receivedEvents(r)) {
        const when = parseDate(event.date);
        const bucket = buckets.find((b) => when >= b.from && when <= b.to);
        if (bucket) bucket.amount += event.amount;
      }
    }
    const max = Math.max(...buckets.map((b) => b.amount), 1);
    return buckets.map((b) => ({ ...b, height: Math.round((b.amount / max) * 100) }));
  }, [main, range]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of main) map.set(r.type, (map.get(r.type) ?? 0) + Number(r.amount));
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, amount]) => ({
        label,
        amount,
        share: total > 0 ? Math.round((amount / total) * 100) : 0,
      }));
  }, [main]);

  const smartInsights = useMemo(() => {
    const notes: string[] = [];
    const t = totals.find((x) => x.currency === mainCurrency);
    if (!t) return notes;
    if (t.pending > 0) notes.push(`You currently have ${formatMoney(t.pending, mainCurrency)} pending.`);
    if (t.overdue > 0) notes.push(`${formatMoney(t.overdue, mainCurrency)} is currently overdue.`);

    const largest = [...recovery.open].sort((a, b) => outstanding(b) - outstanding(a))[0];
    if (largest) {
      notes.push(
        `Your largest outstanding amount is ${formatMoney(outstanding(largest), largest.currency)} from ${largest.owed_by}.`,
      );
    }

    const soon = recovery.open.filter((r) => {
      const window = expectedWindow(r);
      if (!window) return false;
      return daysBetween(todayISO(), window.latest) <= 7 && window.latest >= todayISO();
    });
    const soonAmount = soon.reduce((sum, r) => sum + outstanding(r), 0);
    if (t.owed > 0 && soonAmount / t.owed > 0.5) {
      notes.push("Most of your outstanding money is expected within the next 7 days.");
    }

    const recoveredByType = new Map<string, number>();
    for (const r of main) {
      const got = totalReceived(r);
      if (got > 0) recoveredByType.set(r.type, (recoveredByType.get(r.type) ?? 0) + got);
    }
    const totalRecovered = [...recoveredByType.values()].reduce((a, b) => a + b, 0);
    const topRecovered = [...recoveredByType.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topRecovered && totalRecovered > 0 && topRecovered[1] / totalRecovered > 0.5) {
      notes.push(`${topRecovered[0]} makes up most of the money you have recovered.`);
    }
    return notes;
  }, [totals, mainCurrency, recovery, main]);

  const isEmpty = !loading && items.length === 0;

  return (
    <AppShell>
      <PageHeader title="Insights" subtitle="Where your money sits and how quickly it returns." />

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading your insights…</p>
      ) : isEmpty ? (
        <div className="surface-card mt-6 p-8">
          <p className="font-display text-xl">No insights yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add money you are owed to see your recovery trends here.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <section className="surface-card p-6">
            <h2 className="section-label">Money in Limbo</h2>
            <p className="mt-1 text-sm text-muted-foreground">Money that is still owed to you.</p>
            {totals.map((t) => (
              <div key={t.currency} className="mt-5">
                {currencies.length > 1 ? (
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t.currency}
                  </p>
                ) : null}
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    { l: "Total Currently Owed", v: t.owed },
                    { l: "Total Pending", v: t.pending },
                    { l: "Total Overdue", v: t.overdue },
                    { l: "Received This Month", v: t.receivedMonth },
                    { l: "Received All Time", v: t.receivedAll },
                  ].map((k) => (
                    <div key={k.l}>
                      <p className="text-xs text-muted-foreground">{k.l}</p>
                      <p className="numeric mt-2 text-xl font-semibold">
                        {formatMoney(k.v, t.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {isPlus ? (
            <ExpectedMoney items={items} />
          ) : (
            <UpgradeNotice
              title="Expected Money forecasting"
              description="See what is expected back in the next 7, 14 and 30 days, plus your projected incoming money, with Haqqi Plus."
            />
          )}



          <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
            <section className="surface-card p-6">
              {!isPlus ? (
                <UpgradeNotice
                  title="Haqqi Score"
                  description="Your Haqqi Score summarises how reliably money comes back to you. It is part of Haqqi Plus."
                />
              ) : (
              <>
              <div className="flex items-center gap-2">
                <h2 className="section-label">Haqqi Score</h2>
                <button
                  type="button"
                  aria-label="What is the Haqqi Score?"
                  onClick={() => setScoreInfo((v) => !v)}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] text-muted-foreground"
                >
                  i
                </button>
              </div>
              {scoreInfo ? (
                <p className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  Your Haqqi Score reflects the status of money owed to you. It is not a credit score
                  and does not measure creditworthiness.
                </p>
              ) : null}
              {score ? (
                <>
                  <p className="numeric mt-4 text-[26px] font-semibold tabular-nums">
                    {score.value}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">/ 100</span>
                  </p>
                  <div className="mt-3 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${score.value}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{score.message}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Indicator only. Not a credit score.
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">{NOT_ENOUGH}</p>
              )}
              </>
              )}
            </section>

            <section className="surface-card p-6">
              <h2 className="section-label">Recovery insights</h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {[
                  { l: "Average time to receive money", v: recovery.avgReceive },
                  { l: "Average refund time", v: recovery.avgRefund },
                  { l: "Currently outstanding", v: `${recovery.openCount}` },
                  { l: "Overdue receivables", v: `${recovery.overdueCount}` },
                  { l: "Oldest outstanding", v: recovery.oldest },
                  { l: "Largest outstanding", v: recovery.largest },
                ].map((k) => (
                  <div key={k.l}>
                    <p className="text-xs text-muted-foreground">{k.l}</p>
                    <p className="mt-1 text-sm font-medium">{k.v}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card p-6">
              <h2 className="section-label">Money status breakdown</h2>
              {breakdown.total > 0 ? (
                <>
                  <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted">
                    {breakdown.slices.map((s) => (
                      <div
                        key={s.label}
                        className={s.className}
                        style={{ width: `${(s.amount / breakdown.total) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-5 space-y-3">
                    {breakdown.slices.map((s) => (
                      <div key={s.label} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${s.className}`} />
                          {s.label}
                        </span>
                        <span className="numeric text-muted-foreground">
                          {formatMoney(s.amount, mainCurrency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">{NOT_ENOUGH}</p>
              )}
            </section>

            <section className="surface-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-label">Money Received</h2>
                <div className="flex gap-2">
                  {([30, 90, 180] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={range === r}
                      onClick={() => setRange(r)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        range === r
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {r === 30 ? "Last 30 Days" : r === 90 ? "Last 3 Months" : "Last 6 Months"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex h-44 items-end gap-3">
                {receivedSeries.map((b) => (
                  <div key={b.key} className="flex flex-1 flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t-lg bg-sand transition-colors hover:bg-primary"
                      style={{ height: `${Math.max(b.height, 3)}%` }}
                      title={formatMoney(b.amount, mainCurrency)}
                    />
                    <span className="text-[11px] text-muted-foreground">{b.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card p-6">
              <h2 className="section-label">Where your money is coming from</h2>
              <div className="mt-5 space-y-4">
                {byType.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{NOT_ENOUGH}</p>
                ) : (
                  byType.map((c) => (
                    <div key={c.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{c.label}</span>
                        <span className="numeric text-muted-foreground">
                          {formatMoney(c.amount, mainCurrency)}
                        </span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${c.share}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="surface-card p-6">
              <h2 className="section-label">What stands out</h2>
              {smartInsights.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{NOT_ENOUGH}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {smartInsights.map((note) => (
                    <li key={note} className="rounded-lg bg-muted/60 p-3 text-sm">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {currencies.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              Charts and recovery insights use {mainCurrency}. Other currencies are shown separately
              above and never combined.
            </p>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
