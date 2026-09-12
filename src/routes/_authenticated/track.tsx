import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/haqqi/app-shell";
import { FormAlert } from "@/components/haqqi/auth-layout";
import { addBusinessDays } from "@/lib/receivables";
import { scanMoneyOwed, type ScanResult } from "@/lib/scan.functions";
import { loadReceivables } from "@/lib/receivables";
import { LimitDialog, PlusBadge, UpgradeNotice } from "@/components/haqqi/plus";
import { FREE_ACTIVE_LIMIT, activeReceivableCount, useSubscription } from "@/lib/subscription";

export const Route = createFileRoute("/_authenticated/track")({
  head: () => ({
    meta: [
      { title: "Track Money — Haqqi" },
      {
        name: "description",
        content:
          "Add a refund, deposit or personal loan to Haqqi and follow it until it comes back to you.",
      },
      { property: "og:title", content: "Track Money — Haqqi" },
      { property: "og:description", content: "Add money you are waiting to receive." },
    ],
  }),
  component: TrackMoney,
});

const currencies = ["KWD", "USD", "EUR", "GBP", "SAR", "AED", "Other"];
const types = [
  "Refund",
  "Deposit",
  "Cancelled Order",
  "Failed / Reversed Transaction",
  "Duplicate Charge",
  "Travel / Ticket Refund",
  "Merchant Dispute",
  "Money Owed by Someone",
  "Other",
];
const paymentMethods = ["Debit Card", "Credit Card", "Bank Transfer", "Cash", "Apple Pay", "Other"];

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20";

function Row({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-foreground">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

type Errors = Record<string, string>;

function TrackMoney() {
  const navigate = useNavigate();
  const { isPlus } = useSubscription();
  const [limitOpen, setLimitOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KWD");
  const [type, setType] = useState("");
  const [owedBy, setOwedBy] = useState("");
  const [dateOwed, setDateOwed] = useState("");
  const [returnType, setReturnType] = useState<"exact_date" | "business_days" | "unknown">(
    "unknown",
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const scan = useServerFn(scanMoneyOwed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"manual" | "scan">("manual");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanned, setScanned] = useState<ScanResult | null>(null);
  const [fromScan, setFromScan] = useState(false);

  const notDetected = (value: unknown) => scanned !== null && (value === null || value === "");

  function applyScan(result: ScanResult) {
    setAmount(result.amount !== null ? String(result.amount) : "");
    if (result.currency && currencies.includes(result.currency)) setCurrency(result.currency);
    setType(result.type ?? "");
    setOwedBy(result.owed_by ?? "");
    setDateOwed(result.date_owed ?? "");
    setReturnType(result.expected_return_type);
    setExpectedDate(result.expected_date ?? "");
    setMinDays(result.min_business_days !== null ? String(result.min_business_days) : "");
    setMaxDays(result.max_business_days !== null ? String(result.max_business_days) : "");
    setReference(result.reference_number ?? "");
    setScanned(result);
    setFromScan(true);
    setMode("manual");
    setErrors({});
    setFormError("");
  }

  async function handleFile(file: File) {
    setScanError("");
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      setScanError("Please upload a JPG, JPEG, PNG or WEBP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setScanError("That image is too large. Please upload one under 8 MB.");
      return;
    }
    setScanning(true);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const result = await scan({ data: { image } });
      applyScan(result);
    } catch {
      setScanError("We couldn't read this clearly.");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }


  const rangePreview = (() => {
    if (returnType !== "business_days" || !dateOwed || !minDays || !maxDays) return "";
    const min = Number(minDays);
    const max = Number(maxDays);
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < min) return "";
    const fmt = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `Expected ${fmt(addBusinessDays(dateOwed, min))} – ${fmt(addBusinessDays(dateOwed, max))}`;
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const next: Errors = {};
    const amountValue = Number(amount);
    if (!amount.trim() || Number.isNaN(amountValue) || amountValue <= 0)
      next["amount"] = "Enter an amount greater than 0.";
    if (!type) next["type"] = "Choose a type.";
    if (!owedBy.trim()) next["owedBy"] = "Tell us who owes you.";
    else if (owedBy.trim().length > 120) next["owedBy"] = "Keep this under 120 characters.";
    if (!dateOwed) next["dateOwed"] = "Choose the date the money became owed.";
    if (returnType === "exact_date" && !expectedDate)
      next["expectedDate"] = "Choose the expected date.";
    if (returnType === "business_days") {
      const min = Number(minDays);
      const max = Number(maxDays);
      if (!minDays || Number.isNaN(min) || min < 0) next["minDays"] = "Enter a minimum.";
      if (!maxDays || Number.isNaN(max) || max < 0) next["maxDays"] = "Enter a maximum.";
      if (!next["minDays"] && !next["maxDays"] && max < min)
        next["maxDays"] = "Maximum must be equal to or greater than the minimum.";
    }
    if (notes.length > 1000) next["notes"] = "Notes must be under 1000 characters.";
    if (reference.length > 120) next["reference"] = "Keep this under 120 characters.";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!isPlus) {
      const existing = await loadReceivables();
      if (activeReceivableCount(existing) >= FREE_ACTIVE_LIMIT) {
        setLimitOpen(true);
        return;
      }
    }

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setSaving(false);
      setFormError("Your session expired. Please sign in again.");
      return;
    }

    const { data: inserted, error } = await supabase.from("receivables").insert({
      user_id: user.id,
      amount: amountValue,
      currency,
      type,
      owed_by: owedBy.trim(),
      date_owed: dateOwed,
      expected_return_type: returnType,
      expected_date: returnType === "exact_date" ? expectedDate : null,
      min_business_days: returnType === "business_days" ? Number(minDays) : null,
      max_business_days: returnType === "business_days" ? Number(maxDays) : null,
      payment_method: paymentMethod || null,
      reference_number: reference.trim() || null,
      notes: notes.trim() || null,
    })
      .select("id")
      .maybeSingle();

    if (error) {
      setSaving(false);
      setFormError("We couldn't save this right now. Please try again.");
      return;
    }

    setSuccess("Money added to Haqqi.");
    const id = inserted?.id;
    setTimeout(() => {
      if (fromScan && id) void navigate({ to: "/money/$id", params: { id } });
      else void navigate({ to: "/dashboard" });
    }, 900);
  }

  return (
    <AppShell>
      <PageHeader title="Track Money" subtitle="Add money you are waiting to receive." />

      <div className="mt-6 flex max-w-3xl flex-wrap gap-3">
        <button
          type="button"
          aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}
          className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition-colors ${
            mode === "manual"
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <Pencil className="size-4" />
          Enter Manually
        </button>
        <button
          type="button"
          aria-pressed={mode === "scan"}
          onClick={() => {
            setMode("scan");
            setScanError("");
          }}
          className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition-colors ${
            mode === "scan"
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <Sparkles className="size-4" />
          Scan with AI
          {!isPlus ? <PlusBadge /> : null}
        </button>
      </div>

      {mode === "scan" && !isPlus ? (
        <section className="surface-card mt-6 max-w-3xl p-6 sm:p-8">
          <UpgradeNotice
            title="AI Scan Money Owed"
            description="Haqqi Plus reads a refund or payment confirmation and fills in the details for you. You can still add money manually on the Free plan."
          />
        </section>
      ) : null}

      {mode === "scan" && isPlus ? (
        <section className="surface-card mt-6 max-w-3xl p-6 sm:p-8">
          {scanning ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
              <p className="text-[15px] font-semibold tracking-tight">Reading your confirmation…</p>
              <p className="text-sm text-muted-foreground">This only takes a moment.</p>
            </div>
          ) : scanError ? (
            <div className="py-6 text-center">
              <p className="font-display text-xl">{scanError}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Try another image or enter the details manually.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setScanError("");
                    fileRef.current?.click();
                  }}
                  className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScanError("");
                    setMode("manual");
                  }}
                  className="rounded-md border border-border bg-card px-6 py-3 text-sm font-semibold hover:bg-muted"
                >
                  Enter Manually
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-6 py-14 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <Upload className="size-7 text-primary" />
              <span className="font-display text-xl">Upload a screenshot or confirmation</span>
              <span className="text-sm text-muted-foreground">
                Haqqi will identify the important details for you.
              </span>
              <span className="text-xs text-muted-foreground">JPG, JPEG, PNG or WEBP</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            disabled={scanning}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <p className="mt-5 text-xs text-muted-foreground">
            Your screenshot is only used to read these details. Nothing is saved until you confirm.
          </p>
        </section>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className={`surface-card mt-6 max-w-3xl p-6 sm:p-8 ${mode === "scan" ? "hidden" : ""}`}
      >
        {scanned ? (
          <div className="mb-6">
            <h2 className="section-label">We found these details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Check everything and correct anything before saving.
              {notDetected(scanned.owed_by) ||
              notDetected(scanned.amount) ||
              notDetected(scanned.type) ||
              notDetected(scanned.date_owed)
                ? " Some fields were not detected — please fill them in."
                : ""}
            </p>
          </div>
        ) : null}
        {success ? <FormAlert tone="success">{success}</FormAlert> : null}
        {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}


        <div className="grid gap-5 sm:grid-cols-2">
          <Row label="Amount" error={errors["amount"]}>
            <input
              className={inputClass}
              type="number"
              step="0.001"
              min="0"
              inputMode="decimal"
              placeholder="0.000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Row>

          <Row label="Currency">
            <select
              className={inputClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Type" error={errors["type"]}>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Select a type</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Who owes you the money?" error={errors["owedBy"]}>
            <input
              className={inputClass}
              placeholder="Zara, Booking.com, a friend's name"
              maxLength={120}
              value={owedBy}
              onChange={(e) => setOwedBy(e.target.value)}
            />
          </Row>

          <Row label="Date the money became owed" error={errors["dateOwed"]}>
            <input
              className={inputClass}
              type="date"
              value={dateOwed}
              onChange={(e) => setDateOwed(e.target.value)}
            />
          </Row>

          <Row label="Expected return">
            <select
              className={inputClass}
              value={returnType}
              onChange={(e) => setReturnType(e.target.value as typeof returnType)}
            >
              <option value="exact_date">Exact date</option>
              <option value="business_days">Business day range</option>
              <option value="unknown">Unknown</option>
            </select>
          </Row>

          {returnType === "exact_date" ? (
            <Row label="Expected date" error={errors["expectedDate"]}>
              <input
                className={inputClass}
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </Row>
          ) : null}

          {returnType === "business_days" ? (
            <>
              <Row label="Minimum business days" error={errors["minDays"]}>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  placeholder="5"
                  value={minDays}
                  onChange={(e) => setMinDays(e.target.value)}
                />
              </Row>
              <Row label="Maximum business days" error={errors["maxDays"]}>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  placeholder="10"
                  value={maxDays}
                  onChange={(e) => setMaxDays(e.target.value)}
                />
              </Row>
              {rangePreview ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">{rangePreview}</p>
              ) : null}
            </>
          ) : null}

          <Row label="Payment method (optional)">
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
          </Row>

          <Row label="Order / reference number (optional)" error={errors["reference"]}>
            <input
              className={inputClass}
              placeholder="e.g. ORD-48219"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Row>
        </div>

        <div className="mt-5">
          <Row label="Notes (optional)" error={errors["notes"]}>
            <textarea
              className={`${inputClass} min-h-28 resize-y`}
              maxLength={1000}
              placeholder="Anything worth remembering about this money."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Row>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-7 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {saving ? "Saving…" : "Track This Money"}
        </button>
      </form>
      <LimitDialog open={limitOpen} onClose={() => setLimitOpen(false)} />
    </AppShell>
  );
}
