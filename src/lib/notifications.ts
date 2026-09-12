import {
  expectedWindow,
  formatMoney,
  outstanding,
  receivedEvents,
  todayISO,
  effectiveStatus,
  type ReceivableRecord,
} from "@/lib/receivables";

export type Notification = {
  id: string;
  receivableId: string;
  kind: "soon" | "today" | "overdue" | "partial" | "received";
  title: string;
  date: string;
};

const MS_DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);

const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((parse(toISO).getTime() - parse(fromISO).getTime()) / MS_DAY);

const shiftDays = (iso: string, days: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Builds in-app reminders from the signed-in user's own receivables. */
export function buildNotifications(items: ReceivableRecord[]): Notification[] {
  const today = todayISO();
  const list: Notification[] = [];

  for (const r of items) {
    const amount = Number(r.amount);
    const remaining = outstanding(r);
    const events = receivedEvents(r);
    const status = effectiveStatus(r);

    if (status === "Received") {
      const last = events[events.length - 1];
      list.push({
        id: `${r.id}-received`,
        receivableId: r.id,
        kind: "received",
        title: `Your ${formatMoney(amount, r.currency)} ${r.type.toLowerCase()} from ${r.owed_by} has been fully received.`,
        date: last ? last.date : r.updated_at.slice(0, 10),
      });
    } else {
      events.forEach((event, i) => {
        list.push({
          id: `${r.id}-partial-${i}`,
          receivableId: r.id,
          kind: "partial",
          title: `${formatMoney(event.amount, r.currency)} was received from ${r.owed_by}. ${formatMoney(remaining, r.currency)} is still owed.`,
          date: event.date,
        });
      });

      const window = expectedWindow(r);
      if (window) {
        const diff = daysBetween(today, window.latest);
        if (diff === 0) {
          list.push({
            id: `${r.id}-due-today`,
            receivableId: r.id,
            kind: "today",
            title: `Your ${formatMoney(remaining, r.currency)} ${r.type.toLowerCase()} from ${r.owed_by} is due today.`,
            date: today,
          });
        } else if (diff > 0) {
          for (const milestone of [3, 1]) {
            if (diff <= milestone) {
              list.push({
                id: `${r.id}-soon-${milestone}`,
                receivableId: r.id,
                kind: "soon",
                title: `Your ${formatMoney(remaining, r.currency)} ${r.type.toLowerCase()} from ${r.owed_by} is expected within ${diff} ${diff === 1 ? "day" : "days"}.`,
                date: shiftDays(window.latest, -milestone),
              });
              break;
            }
          }
        } else {
          const late = Math.abs(diff);
          for (const milestone of [7, 3, 1]) {
            if (late >= milestone) {
              list.push({
                id: `${r.id}-overdue-${milestone}`,
                receivableId: r.id,
                kind: "overdue",
                title: `Your ${formatMoney(remaining, r.currency)} ${r.type.toLowerCase()} from ${r.owed_by} is now ${late} ${late === 1 ? "day" : "days"} overdue.`,
                date: shiftDays(window.latest, milestone),
              });
              break;
            }
          }
        }
      }
    }
  }

  return list.sort((a, b) => b.date.localeCompare(a.date));
}

const STORAGE_KEY = "haqqi:read-notifications";

export function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveReadIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}
