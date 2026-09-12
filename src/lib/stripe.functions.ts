import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { z } from "zod";

const CheckoutInput = z.object({
  returnUrl: z.string().optional(),
});

const PortalInput = z.object({
  returnUrl: z.string().optional(),
});

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured on the server.");
  }
  return new Stripe(key, {
    apiVersion: "2023-10-16",
  });
}

function getAdminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL or Key not configured on the server.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const createCheckoutSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CheckoutInput.parse(data))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const userId = context.userId as string;
    const userEmail = (context.claims?.email as string) || undefined;
    const stripe = getStripe();
    const adminSupabase = getAdminSupabase();

    // Check if user already has an active subscription
    const { data: existingSub } = await adminSupabase
      .from("subscriptions")
      .select("id, plan, status, stripe_customer_id, subscription_ends_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (
      existingSub &&
      existingSub.plan === "plus" &&
      existingSub.status === "active" &&
      (!existingSub.subscription_ends_at || new Date(existingSub.subscription_ends_at) > new Date())
    ) {
      throw new Error("You already have an active Haqqi Plus subscription.");
    }

    // Resolve or create Stripe customer
    let customerId = existingSub?.stripe_customer_id;
    if (!customerId) {
      if (userEmail) {
        const list = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (list.data.length > 0) {
          customerId = list.data[0].id;
        }
      }

      if (!customerId) {
        const newCustomer = await stripe.customers.create({
          email: userEmail,
          metadata: { supabase_user_id: userId },
        });
        customerId = newCustomer.id;
      }

      await adminSupabase.from("subscriptions").upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
        },
        { onConflict: "user_id" }
      );
    }

    const cleanReturnUrl = (data.returnUrl || "http://localhost:3000/plans").split("?")[0];
    const stripePriceId = process.env.STRIPE_PRICE_ID;

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    if (stripePriceId && stripePriceId.trim() !== "") {
      lineItems = [{ price: stripePriceId.trim(), quantity: 1 }];
    } else {
      lineItems = [
        {
          price_data: {
            currency: "kwd",
            unit_amount: 2990, // 2.990 KWD = 2990 fils (3 decimals)
            recurring: { interval: "month" },
            product_data: {
              name: "Haqqi Plus",
              description: "Unlimited receivables, AI Scan, and advanced financial insights.",
            },
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: lineItems,
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
      metadata: { supabase_user_id: userId },
      success_url: `${cleanReturnUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${cleanReturnUrl}?cancelled=true`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: session.url };
  });

export const openCustomerPortalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PortalInput.parse(data))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const userId = context.userId as string;
    const stripe = getStripe();
    const adminSupabase = getAdminSupabase();

    const { data: sub } = await adminSupabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      throw new Error("No active Stripe customer found for your account.");
    }

    const cleanReturnUrl = (data.returnUrl || "http://localhost:3000/plans").split("?")[0];

    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: cleanReturnUrl,
    });

    return { url: portal.url };
  });
