import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/haqqi/app-shell";
import { ensureStarterRecords } from "@/lib/seed-receivables";
import {
  activityEntries,
  effectiveStatus,
  formatMoney,
  loadReceivables,
  type ReceivableRecord,
} from "@/lib/receivables";

const money = formatMoney;

const shortDate = (iso: string) =>
  new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "Activity — Haqqi" },
      { name: "description", content: "Every update on the money you are owed, in one timeline." },
      { property: "og:title", content: "Activity — Haqqi" },
      { property: "og:description", content: "A timeline of refunds received, added and overdue." },
    ],
  }),
  component: ActivityPage,
});

const filters = ["All", "Received", "Pending", "Overdue"] as const;
type Filter = (typeof filters)[number];

const emptyMessage: Record<Filter, string> = {
  All: "No activity yet.",
  Received: "Nothing received yet.",
  Pending: "Nothing pending.",
  Overdue: "Nothing overdue.",
};

const dotClass = (status: string) =>
  status === "Received"
    ? "bg-success"
    : status === "Overdue"
      ? "bg-destructive"
      : "bg-warning";

function StatusText({ status }: { status: string }) {
  const tone =
    status === "Received"
      ? "text-success"
      : status === "Overdue"
        ? "text-destructive"
        : "text-warning";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <span className={`status-transition size-1.5 rounded-full ${dotClass(status)}`} />
      {status}
    </span>
  );
}

function ActivityPage() {
  const [items, setItems] = useState<ReceivableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("All");

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

  const entries = useMemo(() => {
    const all = activityEntries(items);
    if (filter === "All") return all;
    if (filter === "Received") return all.filter((e) => e.kind === "received");
    return all.filter((e) => e.kind === "tracked" && effectiveStatus(e.receivable) === filter);
  }, [items, filter]);

  return (
    <AppShell>
      <PageHeader title="Activity" subtitle="Every movement on your money." />

      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-border pb-px">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-3 pb-2.5 text-[13px] font-medium transition-colors ${
              filter === f
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="hidden grid-cols-[1fr_110px_110px_120px] gap-4 border-b border-border px-2 py-2 sm:grid">
        <span className="col-label">Detail</span>
        <span className="col-label">Date</span>
        <span className="col-label">Status</span>
        <span className="col-label text-right">Amount</span>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="space-y-3 py-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">{emptyMessage[filter]}</p>
        ) : (
          entries.map((entry, index) => {
            const r = entry.receivable;
            const status = effectiveStatus(r);
            return (
              <Link
                key={`${filter}-${entry.key}`}
                style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }}
                to="/money/$id"
                params={{ id: r.id }}
                className="rise grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-2 py-3 transition-colors hover:bg-accent/40 sm:grid-cols-[1fr_110px_110px_120px]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`status-transition size-1.5 shrink-0 rounded-full ${dotClass(status)}`} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{r.owed_by}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.kind === "received" ? "Payment received" : r.type}
                    </p>
                  </div>
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {shortDate(entry.date)}
                </p>
                <div className="hidden sm:block">
                  <StatusText status={status} />
                </div>
                <p
                  className={`numeric text-right text-[13.5px] font-semibold tabular-nums ${
                    entry.kind === "received" ? "text-success" : ""
                  }`}
                >
                  {entry.kind === "received" ? "+" : ""}
                  {money(entry.amount, r.currency)}
                </p>
                <p className="col-span-2 text-xs text-muted-foreground sm:hidden">
                  {shortDate(entry.date)} · {status}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
