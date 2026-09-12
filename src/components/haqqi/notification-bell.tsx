import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { loadReceivables } from "@/lib/receivables";
import {
  buildNotifications,
  readIds,
  saveReadIds,
  type Notification,
} from "@/lib/notifications";

const when = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

const dot: Record<Notification["kind"], string> = {
  overdue: "bg-destructive",
  today: "bg-warning",
  soon: "bg-warning",
  partial: "bg-success/70",
  received: "bg-success",
};

export function NotificationBell({ align = "right" }: { align?: "left" | "right" } = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setRead(readIds());
    loadReceivables().then((records) => {
      if (active) setItems(buildNotifications(records));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = useMemo(
    () => items.filter((n) => !read.includes(n.id)).length,
    [items, read],
  );

  function markAllRead() {
    const ids = items.map((n) => n.id);
    setRead(ids);
    saveReadIds(ids);
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className={`absolute z-50 mt-2 ${align === "left" ? "left-0" : "right-0"} w-[320px] overflow-hidden rounded-lg border border-border bg-card sm:w-[360px]`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="section-label">Reminders</p>
            {items.length > 0 && unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Mark all as read
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nothing needs your attention yet.</p>
            ) : (
              items.map((n) => {
                const isRead = read.includes(n.id);
                return (
                  <Link
                    key={n.id}
                    to="/money/$id"
                    params={{ id: n.receivableId }}
                    onClick={() => {
                      if (!isRead) {
                        const next = [...read, n.id];
                        setRead(next);
                        saveReadIds(next);
                      }
                      setOpen(false);
                    }}
                    className={`flex gap-3 px-4 py-3 transition-colors hover:bg-muted ${isRead ? "" : "bg-secondary/40"}`}
                  >
                    <span className={`status-transition mt-1.5 size-2 shrink-0 rounded-full ${dot[n.kind]}`} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${isRead ? "text-muted-foreground" : "font-medium"}`}
                      >
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {when(n.date)}
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
