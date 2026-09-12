import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Copy, MessageSquare, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { generateFollowUp, type Tone } from "@/lib/follow-up";
import { UpgradeNotice } from "@/components/haqqi/plus";
import { useSubscription } from "@/lib/subscription";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/haqqi/app-shell";
import { FormAlert } from "@/components/haqqi/auth-layout";
import {
  effectiveStatus,
  expectedLabel,
  formatMoney,
  loadReceivable,
  outstanding,
  receivedEvents,
  timingLabel,
  todayISO,
  totalReceived,
  type ReceivableRecord,
} from "@/lib/receivables";

export const Route = createFileRoute("/_authenticated/money/$id")({
  head: () => ({
    meta: [
      { title: "Receivable details — Haqqi" },
      {
        name: "description",
        content: "See everything about one receivable and record the money you have received.",
      },
      { property: "og:title", content: "Receivable details — Haqqi" },
      {
        property: "og:description",
        content: "Status timeline, payment history and updates for a single receivable.",
      },
    ],
  }),
  component: ReceivableDetail,
});

const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20";

const types = [
  "Refund",
  "Deposit",
  "Hotel Deposit",
  "Cancelled Order",
  "Failed / Reversed Transaction",
  "Duplicate Charge",
  "Travel / Ticket Refund",
  "Merchant Dispute",
  "Money Owed by Someone",
  "Other",
];
const paymentMethods = ["Debit Card", "Credit Card", "Bank Transfer", "Cash", "Apple Pay", "Other"];

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  const tone =
    key === "overdue"
      ? "bg-destructive/10 text-destructive"
      : key === "received"
        ? "bg-success/12 text-success"
        : "bg-secondary text-secondary-foreground";
  return (
    <span className={`status-transition rounded-full px-3 py-1 text-xs font-semibold capitalize ${tone}`}>
      {status}
    </span>
  );
}

function Timeline({ status }: { status: "Received" | "Pending" | "Overdue" }) {
  const steps =
    status === "Received"
      ? ["Tracked", "Waiting", "Received ✓"]
      : status === "Overdue"
        ? ["Tracked", "Waiting", "Expected date passed", "Overdue"]
        : ["Tracked", "Waiting", "Expected", "Received"];
  const currentIndex = status === "Pending" ? 2 : steps.length - 1;

  return (
    <ol className="mt-4 space-y-0">
      {steps.map((step, i) => {
        const done = i <= currentIndex;
        const current = i === currentIndex;
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`status-transition mt-1 size-2.5 shrink-0 rounded-full ${
                  current
                    ? status === "Overdue"
                      ? "bg-destructive ring-4 ring-destructive/15"
                      : status === "Received"
                        ? "bg-success ring-4 ring-success/15"
                        : "bg-warning ring-4 ring-warning/15"
                    : done
                      ? "bg-primary/50"
                      : "bg-border"
                }`}
              />
              {i < steps.length - 1 ? (
                <span className={`w-px flex-1 ${done ? "bg-primary/30" : "bg-border"}`} />
              ) : null}
            </div>
            <span
              className={`pb-5 text-sm ${current ? "font-semibold text-foreground" : done ? "text-foreground/70" : "text-muted-foreground"}`}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReceivableDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<ReceivableRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [showReceive, setShowReceive] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadReceivable(id);
    setRecord(data);
    setLoading(false);
    if (data) setReceiveAmount(outstanding(data).toFixed(data.currency === "KWD" ? 3 : 2));
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <AppShell>
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!record) {
    return (
      <AppShell>
        <div className="surface-card mt-6 p-8 text-center">
          <p className="font-display text-xl">This record isn’t available.</p>
          <Link to="/dashboard" className="mt-3 inline-block text-sm font-semibold text-primary">
            Back to Dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const status = effectiveStatus(record);
  const received = totalReceived(record);
  const remaining = outstanding(record);
  const history = receivedEvents(record);
  const timing = timingLabel(record);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    if (!record || saving) return;
    setError("");
    const value = Number(receiveAmount);
    if (!receiveAmount.trim() || Number.isNaN(value) || value <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (value > remaining + 0.0001) {
      setError(`That is more than the ${formatMoney(remaining, record.currency)} still owed.`);
      return;
    }
    if (!receiveDate) {
      setError("Choose the date you received the money.");
      return;
    }

    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) {
      setSaving(false);
      setError("Your session expired. Please sign in again.");
      return;
    }

    const { error: insertError } = await supabase.from("receivable_payments").insert({
      receivable_id: record.id,
      user_id: user.id,
      amount: value,
      currency: record.currency,
      received_date: receiveDate,
    });
    if (insertError) {
      setSaving(false);
      setError("We couldn't record that payment. Please try again.");
      return;
    }

    const fullyPaid = received + value >= Number(record.amount) - 0.0001;
    if (fullyPaid) {
      await supabase.from("receivables").update({ status: "Received" }).eq("id", record.id);
    }

    setSaving(false);
    setShowReceive(false);
    setMessage(
      fullyPaid
        ? `Received ${formatMoney(value, record.currency)} from ${record.owed_by}.`
        : `Received ${formatMoney(value, record.currency)} of ${formatMoney(Number(record.amount), record.currency)} from ${record.owed_by}.`,
    );
    await refresh();
  }

  async function handleDelete() {
    if (!record) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from("receivables").delete().eq("id", record.id);
    setSaving(false);
    if (deleteError) {
      setError("We couldn't delete this record. Please try again.");
      return;
    }
    void navigate({ to: "/dashboard" });
  }

  return (
    <AppShell>
      <div className="mt-2 flex items-center justify-between gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setConfirmDelete(false);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            <Pencil className="size-4" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(true);
              setEditing(false);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5"
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        </div>
      </div>

      {message ? (
        <div className="mt-5">
          <FormAlert tone="success">{message}</FormAlert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-5">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="surface-card mt-5 p-6">
          <p className="text-[15px] font-semibold tracking-tight">Delete this record?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This will permanently remove this receivable and its payment history.
          </p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleDelete()}
              className="rounded-md bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          <section className="surface-card p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Owed to you by
                </p>
                <h1 className="text-[20px] font-semibold tracking-tight sm:text-[23px]">{record.owed_by}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{record.type}</p>
              </div>
              <StatusPill status={status} />
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Original Amount
                </p>
                <p className="numeric mt-1 text-2xl font-semibold">
                  {formatMoney(Number(record.amount), record.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">Received</p>
                <p className="numeric mt-1 text-2xl font-semibold text-success">
                  {formatMoney(received, record.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Still Owed
                </p>
                <p className="numeric mt-1 text-2xl font-semibold">
                  {formatMoney(remaining, record.currency)}
                </p>
              </div>
            </div>

            <div className="mt-7 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
              <Field label="Currency" value={record.currency} />
              <Field label="Date the money became owed" value={longDate(record.date_owed)} />
              <Field
                label="Expected"
                value={
                  <>
                    {expectedLabel(record)}
                    {timing ? (
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        {timing}
                      </span>
                    ) : null}
                  </>
                }
              />
              {record.payment_method ? (
                <Field label="Payment method" value={record.payment_method} />
              ) : null}
              {record.reference_number ? (
                <Field label="Order / reference number" value={record.reference_number} />
              ) : null}
              {record.notes ? (
                <div className="sm:col-span-2">
                  <Field label="Notes" value={record.notes} />
                </div>
              ) : null}
            </div>

            {status !== "Received" ? (
              <div className="mt-7">
                {showReceive ? (
                  <form onSubmit={handleReceive} className="rounded-md bg-secondary/60 p-5">
                    <p className="text-[15px] font-semibold tracking-tight">Record money received</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold tracking-wide">
                          Amount Received
                        </span>
                        <input
                          className={inputClass}
                          type="number"
                          step="0.001"
                          min="0"
                          inputMode="decimal"
                          value={receiveAmount}
                          onChange={(e) => setReceiveAmount(e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold tracking-wide">
                          Date Received
                        </span>
                        <input
                          className={inputClass}
                          type="date"
                          value={receiveDate}
                          onChange={(e) => setReceiveDate(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Confirm Received"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReceive(false)}
                        className="rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMessage("");
                      setError("");
                      setReceiveAmount(remaining.toFixed(record.currency === "KWD" ? 3 : 2));
                      setReceiveDate(todayISO());
                      setShowReceive(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <CheckCircle2 className="size-4" />
                    Mark as Received
                  </button>
                )}
              </div>
            ) : null}
          </section>

          {status === "Overdue" ? <FollowUp record={record} /> : null}

          {editing ? (
            <EditForm
              record={record}
              onCancel={() => setEditing(false)}
              onSaved={async () => {
                setEditing(false);
                setMessage("Changes saved.");
                await refresh();
              }}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <section className="surface-card p-6">
            <h2 className="section-label">Status</h2>
            <Timeline status={status} />
          </section>

          <section className="surface-card p-6">
            <h2 className="section-label">Payment History</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {history.map((p, i) => (
                  <li key={`${p.date}-${i}`} className="flex items-center justify-between py-3">
                    <span className="text-sm text-muted-foreground">{shortDate(p.date)}</span>
                    <span className="numeric text-sm font-semibold text-success">
                      + {formatMoney(p.amount, record.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function EditForm({
  record,
  onCancel,
  onSaved,
}: {
  record: ReceivableRecord;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [owedBy, setOwedBy] = useState(record.owed_by);
  const [type, setType] = useState(record.type);
  const [amount, setAmount] = useState(String(record.amount));
  const [dateOwed, setDateOwed] = useState(record.date_owed);
  const [expectedDate, setExpectedDate] = useState(record.expected_date ?? "");
  const [paymentMethod, setPaymentMethod] = useState(record.payment_method ?? "");
  const [reference, setReference] = useState(record.reference_number ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const value = Number(amount);
    if (!owedBy.trim()) return setError("Tell us who owes you.");
    if (Number.isNaN(value) || value <= 0) return setError("Enter an amount greater than 0.");
    if (value < totalReceived(record))
      return setError("The amount cannot be less than the payments already recorded.");

    setSaving(true);
    const { error: updateError } = await supabase
      .from("receivables")
      .update({
        owed_by: owedBy.trim(),
        type,
        amount: value,
        date_owed: dateOwed,
        ...(record.expected_return_type === "exact_date" || expectedDate
          ? { expected_return_type: "exact_date", expected_date: expectedDate || null }
          : {}),
        payment_method: paymentMethod || null,
        reference_number: reference.trim() || null,
        notes: notes.trim() || null,
      })
      .eq("id", record.id);
    setSaving(false);
    if (updateError) {
      setError("We couldn't save those changes. Please try again.");
      return;
    }
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="surface-card p-6 sm:p-8">
      <h2 className="section-label">Edit this record</h2>
      {error ? (
        <div className="mt-4">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : null}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">Who owes you</span>
          <input
            className={inputClass}
            value={owedBy}
            maxLength={120}
            onChange={(e) => setOwedBy(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">Type</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            {(types.includes(type) ? types : [type, ...types]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">Original amount</span>
          <input
            className={inputClass}
            type="number"
            step="0.001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">
            Date the money became owed
          </span>
          <input
            className={inputClass}
            type="date"
            value={dateOwed}
            onChange={(e) => setDateOwed(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">
            Expected date (optional)
          </span>
          <input
            className={inputClass}
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">
            Payment method (optional)
          </span>
          <select
            className={inputClass}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="">Not specified</option>
            {paymentMethods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">
            Order / reference number (optional)
          </span>
          <input
            className={inputClass}
            value={reference}
            maxLength={120}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide">Notes (optional)</span>
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Payment history stays exactly as it is when you edit these details.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const tones: Tone[] = ["Short", "Polite", "Firm"];

function FollowUp({ record }: { record: ReceivableRecord }) {
  const { isPlus } = useSubscription();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<Tone>("Polite");
  const [variant, setVariant] = useState(0);
  const [copied, setCopied] = useState("");

  const text = generateFollowUp(record, tone, variant);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Message copied.");
    } catch {
      setCopied("Select the text above to copy it.");
    }
  }

  if (!isPlus) {
    return (
      <section className="surface-card p-6 sm:p-8">
        <UpgradeNotice
          title="Follow-Up Message generator"
          description="Haqqi Plus writes a short, polite or firm follow-up message for overdue money, ready for you to send."
        />
      </section>
    );
  }

  if (!open) {
    return (
      <section className="surface-card p-6 sm:p-8">
        <h2 className="section-label">Need to chase this up?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Haqqi writes the message for you. You choose where and when to send it.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <MessageSquare className="size-4" />
          Create Follow-Up Message
        </button>
      </section>
    );
  }

  return (
    <section className="surface-card p-6 sm:p-8">
      <h2 className="section-label">Follow-up message</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {tones.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tone === t}
            onClick={() => {
              setTone(t);
              setVariant(0);
              setCopied("");
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              tone === t
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <p className="mt-5 whitespace-pre-wrap rounded-md bg-secondary/60 p-5 text-sm leading-relaxed">
        {text}
      </p>

      {copied ? <p className="mt-3 text-xs font-semibold text-success">{copied}</p> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          <Copy className="size-4" />
          Copy Message
        </button>
        <button
          type="button"
          onClick={() => {
            setVariant((v) => v + 1);
            setCopied("");
          }}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-muted"
        >
          <RefreshCw className="size-4" />
          Regenerate
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-muted"
        >
          Close
        </button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Haqqi never sends anything for you.</p>
    </section>
  );
}
