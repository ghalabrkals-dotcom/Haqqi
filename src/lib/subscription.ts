import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { effectiveStatus, type ReceivableRecord } from "@/lib/receivables";

export type Plan = "free" | "plus";

export type Subscription = {
  plan: Plan;
  status: "none" | "active" | "cancelled" | "past_due";
  billing_provider: "none" | "demo" | "stripe" | "paddle";
  subscription_started_at: string | null;
  subscription_ends_at: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  cancel_at_period_end?: boolean | null;
};

export const FREE_ACTIVE_LIMIT = 5;
export const PLUS_PRICE = "KD 2.990";

export const FREE_FEATURES = [
  "Track up to 5 active receivables",
  "Dashboard and Activity",
  "Basic reminders",
  "Receivable details",
  "Mark as received",
  "Partial payments",
];

export const PLUS_FEATURES = [
  "Unlimited receivables",
  "AI Scan Money Owed",
  "Advanced Insights",
  "Haqqi Score",
  "Expected Money forecasting",
  "Smart reminders",
  "Follow-Up Message generator",
  "Demo Transaction Matching",
  "Advanced activity history",
  "Priority access to future features",
];

const FREE_DEFAULT: Subscription = {
  plan: "free",
  status: "none",
  billing_provider: "none",
  subscription_started_at: null,
  subscription_ends_at: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  cancel_at_period_end: false,
};

const FIELDS =
  "plan, status, billing_provider, subscription_started_at, subscription_ends_at, stripe_customer_id, stripe_subscription_id, cancel_at_period_end";

/** Whether a plan is currently entitled to Plus features. */
export function isPlusActive(sub: Subscription | null): boolean {
  if (!sub || sub.plan !== "plus" || sub.status !== "active") return false;
  if (sub.subscription_ends_at && new Date(sub.subscription_ends_at) < new Date()) return false;
  return true;
}

/** Active = still waiting for the money (Pending or Overdue). */
export function activeReceivableCount(items: ReceivableRecord[]): number {
  return items.filter((r) => effectiveStatus(r) !== "Received").length;
}

export async function loadSubscription(): Promise<Subscription> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return FREE_DEFAULT;
  const { data } = await supabase
    .from("subscriptions")
    .select(FIELDS)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  return (data as Subscription | null) ?? FREE_DEFAULT;
}

/**
 * Creates a Stripe Checkout Session on the backend and returns the checkout URL.
 * Redirects the user securely to Stripe's hosted checkout page.
 */
export async function createCheckoutSession(returnUrl?: string): Promise<{ url: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Please sign in to upgrade to Haqqi Plus.");

  const { data, error } = await supabase.functions.invoke("create-checkout-session", {
    body: {
      returnUrl: returnUrl || (typeof window !== "undefined" ? window.location.href : undefined),
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to initialize Stripe Checkout.");
  }
  if (!data?.url) {
    throw new Error(data?.error || "No checkout URL received from server.");
  }

  return { url: data.url };
}

/**
 * Opens the Stripe Customer Portal for managing active subscriptions or cancelling.
 */
export async function openCustomerPortal(returnUrl?: string): Promise<{ url: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Please sign in to manage your subscription.");

  const { data, error } = await supabase.functions.invoke("customer-portal", {
    body: {
      returnUrl: returnUrl || (typeof window !== "undefined" ? window.location.href : undefined),
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to open Stripe Customer Portal.");
  }
  if (!data?.url) {
    throw new Error(data?.error || "No billing portal URL received.");
  }

  return { url: data.url };
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const sub = await loadSubscription();
    setSubscription(sub);
    setLoading(false);
    return sub;
  }, []);

  useEffect(() => {
    let active = true;
    loadSubscription().then((sub) => {
      if (!active) return;
      setSubscription(sub);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    subscription,
    loading,
    isPlus: isPlusActive(subscription),
    refresh,
    setSubscription,
  };
}
