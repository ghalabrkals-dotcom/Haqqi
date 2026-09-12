import { supabase } from "@/integrations/supabase/client";

const YEAR = new Date().getFullYear();
const d = (month: number, day: number) =>
  `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const starterRecords = [
  {
    owed_by: "Zara",
    type: "Refund",
    amount: 42,
    status: "Received",
    date_owed: d(9, 2),
    expected_date: d(9, 8),
  },
  {
    owed_by: "Avis",
    type: "Deposit",
    amount: 100,
    status: "Overdue",
    date_owed: d(8, 28),
    expected_date: d(9, 7),
  },
  {
    owed_by: "Talabat",
    type: "Duplicate Charge",
    amount: 12.25,
    status: "Pending",
    date_owed: d(9, 9),
    expected_date: d(9, 14),
  },
  {
    owed_by: "Namshi",
    type: "Refund",
    amount: 68.25,
    status: "Received",
    date_owed: d(9, 1),
    expected_date: d(9, 6),
  },
  {
    owed_by: "Booking.com",
    type: "Hotel Deposit",
    amount: 75,
    status: "Pending",
    date_owed: d(9, 10),
    expected_date: d(9, 18),
  },
  {
    owed_by: "Sara",
    type: "Money Owed by Someone",
    amount: 25,
    status: "Pending",
    date_owed: d(9, 11),
    expected_date: d(9, 15),
  },
];

let inFlight: Promise<void> | null = null;

async function seed() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return;

  const { count, error } = await supabase
    .from("receivables")
    .select("id", { count: "exact", head: true });
  if (error || (count ?? 0) > 0) return;

  await supabase.from("receivables").insert(
    starterRecords.map((r) => ({
      user_id: user.id,
      owed_by: r.owed_by,
      type: r.type,
      amount: r.amount,
      currency: "KWD",
      status: r.status,
      date_owed: r.date_owed,
      expected_return_type: "exact_date",
      expected_date: r.expected_date,
      created_at: `${r.date_owed}T09:00:00Z`,
    })),
  );
}

/** Adds the starting records once per account; never duplicates on refresh. */
export function ensureStarterRecords(): Promise<void> {
  if (!inFlight) {
    inFlight = seed().catch(() => undefined);
  }
  return inFlight;
}
