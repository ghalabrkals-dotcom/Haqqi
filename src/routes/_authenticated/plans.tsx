import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader, SectionHeading } from "@/components/haqqi/app-shell";
import { PlusBadge } from "@/components/haqqi/plus";
import {
  FREE_FEATURES,
  PLUS_FEATURES,
  PLUS_PRICE,
  createCheckoutSession,
  openCustomerPortal,
  useSubscription,
} from "@/lib/subscription";

type PlansSearchParams = {
  success?: boolean;
  cancelled?: boolean;
  session_id?: string;
};

export const Route = createFileRoute("/_authenticated/plans")({
  validateSearch: (search: Record<string, unknown>): PlansSearchParams => ({
    success: search.success === "true" || search.success === true,
    cancelled: search.cancelled === "true" || search.cancelled === true,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Plans — Haqqi" },
      {
        name: "description",
        content:
          "Compare the Haqqi Free plan and Haqqi Plus, and manage your Stripe subscription.",
      },
      { property: "og:title", content: "Plans — Haqqi" },
      { property: "og:description", content: "Free and Haqqi Plus, side by side." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Plans,
});

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={2} />
          {f}
        </li>
      ))}
    </ul>
  );
}

function Plans() {
  const search = Route.useSearch();
  const { subscription, loading, isPlus, refresh } = useSubscription();

  const [busyUpgrade, setBusyUpgrade] = useState(false);
  const [busyPortal, setBusyPortal] = useState(false);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  // Poll for webhook completion when redirected from successful Stripe Checkout
  useEffect(() => {
    if (!search.success || isPlus) {
      setVerifying(false);
      return;
    }

    setVerifying(true);
    let attempts = 0;
    const maxAttempts = 10;

    const interval = setInterval(async () => {
      attempts += 1;
      const updated = await refresh();
      if (updated && updated.plan === "plus" && updated.status === "active") {
        setVerifying(false);
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        setVerifying(false);
        clearInterval(interval);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [search.success, isPlus, refresh]);

  async function handleUpgrade() {
    if (busyUpgrade) return;
    setBusyUpgrade(true);
    setError("");

    try {
      const { url } = await createCheckoutSession();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (err: any) {
      setError(
        err?.message || "Unable to start Stripe checkout. Please try again or contact support."
      );
      setBusyUpgrade(false);
    }
  }

  async function handleManagePortal() {
    if (busyPortal) return;
    setBusyPortal(true);
    setError("");

    try {
      const { url } = await openCustomerPortal();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No customer portal URL returned.");
      }
    } catch (err: any) {
      setError(
        err?.message || "Unable to open Stripe Customer Portal. Please try again."
      );
      setBusyPortal(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Plans" subtitle="Choose how much of Haqqi you use." />

      {/* Payment Success & Verification Notification */}
      {search.success ? (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
          {verifying ? (
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-primary shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  Verifying your payment with Stripe...
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your Haqqi Plus access will unlock automatically as soon as Stripe confirms the webhook.
                </p>
              </div>
            </div>
          ) : isPlus ? (
            <div className="flex items-start gap-3">
              <ShieldCheck className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  Payment confirmed! Welcome to Haqqi Plus.
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your monthly subscription is active. You now have full access to unlimited receivables, AI scan, and advanced insights.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  Payment received.
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stripe is still finishing confirmation. Please refresh this page in a few seconds.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Payment Cancelled Notification */}
      {search.cancelled ? (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              Checkout was cancelled
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              No payment was charged. You can upgrade to Haqqi Plus whenever you are ready.
            </p>
          </div>
        </div>
      ) : null}

      {/* General Error Message */}
      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-8 grid gap-10 [&>*]:min-w-0 lg:grid-cols-2 lg:gap-14">
        {/* Free Plan Card */}
        <section className="rise border-t border-border pt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Free</h2>
            {!loading && !isPlus ? (
              <span className="col-label text-primary">Current plan</span>
            ) : null}
          </div>
          <p className="numeric mt-3 text-[28px] font-semibold leading-none tracking-tight">KD 0</p>
          <p className="mt-1.5 text-xs text-muted-foreground">Up to 5 active receivables.</p>
          <FeatureList items={FREE_FEATURES} />
        </section>

        {/* Haqqi Plus Card */}
        <section className="rise border-t border-border pt-5" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              Haqqi Plus <PlusBadge />
            </h2>
            {!loading && isPlus ? (
              <span className="col-label text-primary">Current plan</span>
            ) : null}
          </div>
          <p className="numeric mt-3 text-[28px] font-semibold leading-none tracking-tight">
            {PLUS_PRICE}
            <span className="ml-1.5 text-[13px] font-medium text-muted-foreground">/ month</span>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">Everything in Free, without limits.</p>
          <FeatureList items={PLUS_FEATURES} />

          {!isPlus ? (
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={busyUpgrade}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.985] disabled:opacity-60"
            >
              {busyUpgrade ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting to Stripe...
                </>
              ) : (
                "Upgrade to Haqqi Plus"
              )}
            </button>
          ) : (
            <div className="mt-6 space-y-3">
              <div className="text-[13px] text-muted-foreground">
                <p>
                  Active
                  {subscription?.subscription_started_at
                    ? ` since ${new Date(subscription.subscription_started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                    : ""}
                  .
                </p>
                {subscription?.cancel_at_period_end && subscription.subscription_ends_at ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Subscription scheduled to end on{" "}
                    {new Date(subscription.subscription_ends_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    . You retain full Plus access until then.
                  </p>
                ) : subscription?.subscription_ends_at ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Next billing date:{" "}
                    {new Date(subscription.subscription_ends_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                ) : null}
              </div>

              {subscription?.billing_provider === "stripe" ? (
                <button
                  type="button"
                  onClick={handleManagePortal}
                  disabled={busyPortal}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold transition-colors duration-200 hover:bg-muted active:scale-[0.985] disabled:opacity-60"
                >
                  {busyPortal ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Opening portal...
                    </>
                  ) : (
                    <>
                      Manage Subscription
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                    </>
                  )}
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* Billing Information Section */}
      <section className="mt-12">
        <SectionHeading title="Billing & Security" />
        <p className="mt-3 max-w-prose text-[13px] text-muted-foreground leading-relaxed">
          Subscriptions are billed monthly at {PLUS_PRICE} and processed securely through{" "}
          <strong className="font-semibold text-foreground">Stripe</strong> with industry-standard
          end-to-end encryption. Your card details are never stored on Haqqi servers. You can manage
          payment methods, download VAT receipts, or cancel anytime directly via the Stripe Customer
          Portal. If you cancel, your existing receivables and history are never deleted.
        </p>
      </section>
    </AppShell>
  );
}
