import { AnimatedMoney } from "@/components/haqqi/animated-number";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader, SectionHeading } from "@/components/haqqi/app-shell";
import { ensureStarterRecords } from "@/lib/seed-receivables";
import {
  activityEntries,
  effectiveStatus,
  expectedLabel,
  expectedSoon as computeExpectedSoon,
  formatMoney,
  loadReceivables,
  outstanding,
  receivedEvents,
  timingLabel,
  type ReceivableRecord,
} from "@/lib/receivables";

type Receivable = ReceivableRecord;

const money = formatMoney;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Haqqi — Track the money you're owed" },
      {
        name: "description",
        content:
          "Haqqi is a personal receivables tracker for refunds, deposits and money owed to you, in KWD.",
      },
      { property: "og:title", content: "Haqqi — Track the money you're owed" },
      {
        property: "og:description",
        content: "See refunds, deposits and personal loans in one clear dashboard.",
      },
    ],
  }),
  component: Dashboard,
});

type Totals = Record<string, number>;

function addTo(totals: Totals, currency: string, amount: number) {
  totals[currency] = (totals[currency] ?? 0) + amount;
}

function sortedTotals(totals: Totals) {
  return Object.entries(totals).sort(([a], [b]) =>
    a === "KWD" ? -1 : b === "KWD" ? 1 : a.localeCompare(b),
  );
}

function Metric({
  label,
  totals,
  tone,
  count,
}: {
  label: string;
  totals: Totals;
  tone?: "destructive" | "success" | "warning";
  count?: number;
}) {
  const entries = sortedTotals(totals);
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="min-w-0 px-0 sm:px-5 sm:first:pl-0">
      <p className="col-label">{label}</p>
      <p className={`numeric mt-1.5 text-[17px] font-semibold tabular-nums ${toneClass}`}>
        {entries.length === 0 ? money(0, "KWD") : money(entries[0]![1], entries[0]![0])}
      </p>
      {entries.slice(1).map(([currency, amount]) => (
        <p key={currency} className="numeric text-xs tabular-nums text-muted-foreground">
          {money(amount, currency)}
        </p>
      ))}
      {typeof count === "number" ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {count} {count === 1 ? "record" : "records"}
        </p>
      ) : null}
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  const tone =
    status === "Received"
      ? "text-success"
      : status === "Overdue"
        ? "text-destructive"
        : "text-warning";
  const dot =
    status === "Received"
      ? "bg-success"
      : status === "Overdue"
        ? "bg-destructive"
        : "bg-warning";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <span className={`status-transition size-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

const filters = ["All", "Pending", "Overdue", "Received"] as const;
const sorts = ["Newest", "Oldest", "Highest Amount", "Lowest Amount"] as const;

function Dashboard() {
  const [firstName, setFirstName] = useState("");
  const [items, setItems] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [sort, setSort] = useState<(typeof sorts)[number]>("Newest");

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", data.user.id)
        .maybeSingle();
      const name =
        profile?.full_name || (data.user.user_metadata?.["full_name"] as string | undefined) || "";
      if (active) setFirstName(name.split(" ")[0] ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

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

  const summary = useMemo(() => {
    const owed: Totals = {};
    const pending: Totals = {};
    const overdue: Totals = {};
    const received: Totals = {};
    let pendingCount = 0;
    let overdueCount = 0;
    const now = new Date();

    for (const r of items) {
      const status = effectiveStatus(r).toLowerCase();
      const remaining = outstanding(r);
      if (status === "pending") {
        addTo(owed, r.currency, remaining);
        addTo(pending, r.currency, remaining);
        pendingCount += 1;
      } else if (status === "overdue") {
        addTo(owed, r.currency, remaining);
        addTo(overdue, r.currency, remaining);
        overdueCount += 1;
      }
      for (const event of receivedEvents(r)) {
        const d = new Date(`${event.date.slice(0, 10)}T00:00:00`);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
          addTo(received, r.currency, event.amount);
        }
      }
    }
    return { owed, pending, overdue, received, pendingCount, overdueCount };
  }, [items]);

  const visible = useMemo(() => {
    const list = items.filter(
      (r) => filter === "All" || effectiveStatus(r).toLowerCase() === filter.toLowerCase(),
    );
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "Newest") return b.created_at.localeCompare(a.created_at);
      if (sort === "Oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "Highest Amount") return Number(b.amount) - Number(a.amount);
      return Number(a.amount) - Number(b.amount);
    });
    return sorted;
  }, [items, filter, sort]);

  const expectedSoon = useMemo(() => computeExpectedSoon(items).slice(0, 5), [items]);
  const recent = useMemo(() => activityEntries(items).slice(0, 5), [items]);
  const isEmpty = !loading && items.length === 0;
  const owedEntries = sortedTotals(summary.owed);

  return (
    <AppShell>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        subtitle="Money you’re waiting for."
        action={
          <Link
            to="/track"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Plus className="size-4" />
            Track Money
          </Link>
        }
      />

      {/* Headline figure */}
      <section className="rise mt-7 border-b border-border pb-6" style={{ animationDelay: "40ms" }}>
        <p className="col-label">Total owed to you</p>
        {loading ? (
          <div className="mt-3 h-10 w-56 animate-pulse rounded bg-muted" />
        ) : (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="numeric text-[40px] font-semibold leading-none tabular-nums tracking-tight sm:text-[52px]">
              <AnimatedMoney
                value={owedEntries.length === 0 ? 0 : owedEntries[0]![1]}
                currency={owedEntries.length === 0 ? "KWD" : owedEntries[0]![0]}
                format={money}
              />
            </p>
            {owedEntries.slice(1).map(([currency, amount]) => (
              <p
                key={currency}
                className="numeric text-base font-semibold tabular-nums text-muted-foreground"
              >
                {money(amount, currency)}
              </p>
            ))}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-y-5 sm:flex sm:divide-x sm:divide-border">
          <Metric
            label="Pending"
            totals={summary.pending}
            tone="warning"
            count={summary.pendingCount}
          />
          <Metric
            label="Overdue"
            totals={summary.overdue}
            tone="destructive"
            count={summary.overdueCount}
          />
          <Metric label="Received this month" totals={summary.received} tone="success" />
        </div>
      </section>

      <div
        className="rise mt-8 grid gap-10 [&>*]:min-w-0 xl:grid-cols-[1.7fr_1fr] xl:gap-12"
        style={{ animationDelay: "100ms" }}
      >
        <section>
          <SectionHeading
            title="Your money"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-0.5">
                  {filters.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                        filter === f
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as (typeof sorts)[number])}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground"
                  aria-label="Sort receivables"
                >
                  {sorts.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          <div className="hidden grid-cols-[1.4fr_0.9fr_0.9fr_130px] gap-4 border-b border-border px-2 py-2 sm:grid">
            <span className="col-label">Owed by</span>
            <span className="col-label">Type</span>
            <span className="col-label">Expected</span>
            <span className="col-label text-right">Amount</span>
          </div>

          <div className="divide-y divide-border">
            {loading ? (
              <div className="space-y-3 py-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-start gap-3 py-8">
                <p className="text-sm font-semibold">Nothing tracked yet</p>
                <p className="text-sm text-muted-foreground">
                  Add a refund, deposit, or money someone owes you.
                </p>
                <Link
                  to="/track"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground"
                >
                  <Plus className="size-4" />
                  Track Money
                </Link>
              </div>
            ) : visible.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground">Nothing here under “{filter}”.</p>
            ) : (
              visible.map((r) => (
                <Link
                  key={r.id}
                  to="/money/$id"
                  params={{ id: r.id }}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-2 py-3 transition-colors hover:bg-accent/40 sm:grid-cols-[1.4fr_0.9fr_0.9fr_130px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{r.owed_by}</p>
                    <div className="mt-0.5 sm:hidden">
                      <StatusText status={effectiveStatus(r)} />
                    </div>
                    <p className="hidden truncate text-xs text-muted-foreground sm:block">
                      {timingLabel(r) || expectedLabel(r)}
                    </p>
                  </div>
                  <p className="hidden truncate text-xs text-muted-foreground sm:block">{r.type}</p>
                  <div className="hidden min-w-0 sm:block">
                    <p className="truncate text-xs text-muted-foreground">{expectedLabel(r)}</p>
                    <div className="mt-1">
                      <StatusText status={effectiveStatus(r)} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="numeric text-[13.5px] font-semibold tabular-nums">
                      {money(outstanding(r) > 0 ? outstanding(r) : r.amount, r.currency)}
                    </p>
                    {outstanding(r) > 0 && outstanding(r) < Number(r.amount) ? (
                      <p className="numeric text-[11px] tabular-nums text-muted-foreground">
                        of {money(r.amount, r.currency)}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {r.type} · {expectedLabel(r)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>

        <div className="flex flex-col gap-10">
          <section>
            <SectionHeading
              title="Expected soon"
              aside={<span className="text-[11px] text-muted-foreground">Nearest first</span>}
            />
            <div className="divide-y divide-border">
              {expectedSoon.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No expected dates yet.</p>
              ) : (
                expectedSoon.map((e) => (
                  <Link
                    key={e.id}
                    to="/money/$id"
                    params={{ id: e.id }}
                    className="flex items-center gap-3 px-2 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{e.owed_by}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {timingLabel(e) || expectedLabel(e)}
                      </p>
                    </div>
                    <p className="numeric text-[13.5px] font-semibold tabular-nums">
                      {money(outstanding(e), e.currency)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section>
            <SectionHeading
              title="Recent activity"
              aside={
                <Link to="/activity" className="text-[11px] font-medium text-primary hover:underline">
                  View all
                </Link>
              }
            />
            <div className="divide-y divide-border">
              {recent.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                recent.map((a) => (
                  <Link
                    key={a.key}
                    to="/money/$id"
                    params={{ id: a.receivable.id }}
                    className="flex items-center gap-2.5 px-2 py-2.5 transition-colors hover:bg-accent/40"
                  >
                    <span
                      className={`status-transition size-1.5 shrink-0 rounded-full ${
                        a.kind === "received"
                          ? "bg-success"
                          : effectiveStatus(a.receivable) === "Overdue"
                            ? "bg-destructive"
                            : "bg-warning"
                      }`}
                    />
                    <p className="min-w-0 flex-1 truncate text-[13px]">{a.label}</p>
                    <p className="shrink-0 text-[11px] text-muted-foreground">
                      {shortDate(a.date)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
