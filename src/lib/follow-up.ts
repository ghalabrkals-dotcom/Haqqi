import {
  expectedLabel,
  expectedWindow,
  formatMoney,
  outstanding,
  todayISO,
  type ReceivableRecord,
} from "@/lib/receivables";

export type Tone = "Short" | "Polite" | "Firm";

const MS_DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);

export function daysOverdue(r: ReceivableRecord): number {
  const window = expectedWindow(r);
  if (!window) return 0;
  const diff = Math.round((parse(todayISO()).getTime() - parse(window.latest).getTime()) / MS_DAY);
  return Math.max(0, diff);
}

const pick = (options: readonly string[], variant: number): string =>
  options[variant % options.length] ?? options[0] ?? "";

/** Builds a follow-up message from the receivable's own stored details. */
export function generateFollowUp(r: ReceivableRecord, tone: Tone, variant = 0): string {
  const remaining = formatMoney(outstanding(r), r.currency);
  const original = formatMoney(Number(r.amount), r.currency);
  const partial = outstanding(r) < Number(r.amount);
  const ref = r.reference_number ? ` for order #${r.reference_number}` : "";
  const late = daysOverdue(r);
  const lateText = late > 0 ? `${late} ${late === 1 ? "day" : "days"}` : "some time";
  const expected = expectedLabel(r).replace("Expected ", "");
  const who = r.owed_by;
  const kind = r.type.toLowerCase();
  const personal = r.type === "Money Owed by Someone";

  if (personal) {
    const options = {
      Short: [
        `Hey, just a reminder about the ${remaining} from earlier. Whenever you get a chance, can you send it over? Thanks.`,
        `Hi ${who}, quick reminder about the ${remaining}. Send it over whenever you can, thanks!`,
      ],
      Polite: [
        `Hi ${who}, hope you're doing well. Just a gentle reminder about the ${remaining} from ${expected}. Whenever it's convenient, could you send it over? Thank you!`,
        `Hey ${who}, no rush at all, but I wanted to check in about the ${remaining} we agreed on. Let me know when works for you. Thanks!`,
      ],
      Firm: [
        `Hi ${who}, the ${remaining} is now ${lateText} past when we agreed. Could you please send it over this week? Thanks.`,
        `Hi ${who}, I've been waiting ${lateText} for the ${remaining}. Please let me know today when you can transfer it.`,
      ],
    } as const;
    return pick([...options[tone]], variant);
  }

  const options = {
    Short: [
      `Following up on my ${kind} of ${remaining}${ref} from ${who}. It is now ${lateText} overdue. Please share an update.`,
      `${who}: my ${kind} of ${remaining}${ref} is ${lateText} overdue. Could you confirm the status?`,
    ],
    Polite: [
      `Hi, I'm following up regarding my ${kind} of ${remaining}${ref}. The expected ${kind} period has now passed. Could you please provide an update on the status? Thank you.`,
      `Hello, I wanted to kindly follow up on my ${kind} of ${remaining}${ref}, which was expected ${expected} and is now ${lateText} overdue. I'd appreciate an update at your earliest convenience. Thank you.`,
    ],
    Firm: [
      `Hello, I'm following up regarding the outstanding ${kind} of ${remaining}${ref}. The expected ${kind} period has passed, and the amount remains unpaid. Please provide an update and confirm when the ${kind} will be completed.`,
      `Hello, the ${kind} of ${remaining}${ref} is now ${lateText} overdue against an original amount of ${original}. This has not been resolved despite the expected date of ${expected}. Please confirm in writing when payment will be issued.`,
    ],
  } as const;

  const base = pick([...options[tone]], variant);
  return partial && tone !== "Short"
    ? `${base} (${formatMoney(Number(r.amount) - outstanding(r), r.currency)} of the original ${original} has already been received.)`
    : base;
}
