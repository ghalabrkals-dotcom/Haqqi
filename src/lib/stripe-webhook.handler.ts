import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function handleStripeWebhookRequest(request: Request): Promise<Response> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required environment variables for stripe webhook.");
    return new Response(JSON.stringify({ error: "Server configuration missing secrets" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`[Stripe Webhook] Received: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          const customerId =
            typeof session.customer === "string" ? session.customer : session.customer?.id;
          const userId =
            session.client_reference_id ||
            session.metadata?.supabase_user_id ||
            session.subscription_data?.metadata?.supabase_user_id;

          if (!userId) {
            console.error(`No user ID found for session ${session.id}`);
            break;
          }

          let currentPeriodStart: string | null = null;
          let currentPeriodEnd: string | null = null;
          let cancelAtPeriodEnd = false;

          if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            currentPeriodStart = new Date(sub.current_period_start * 1000).toISOString();
            currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
            cancelAtPeriodEnd = sub.cancel_at_period_end;
          }

          await adminClient.from("subscriptions").upsert(
            {
              user_id: userId,
              plan: "plus",
              status: "active",
              billing_provider: "stripe",
              stripe_customer_id: customerId || null,
              stripe_subscription_id: subscriptionId || null,
              subscription_started_at: currentPeriodStart || new Date().toISOString(),
              subscription_ends_at: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd,
            },
            { onConflict: "user_id" }
          );

          console.log(`[Stripe Webhook] Activated Haqqi Plus for user ${userId}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const userId = sub.metadata?.supabase_user_id;

        let plan = "plus";
        let status = "active";
        if (sub.status === "past_due") {
          status = "past_due";
        } else if (sub.status === "canceled" || sub.status === "unpaid") {
          plan = "free";
          status = "cancelled";
        }

        let q = adminClient.from("subscriptions").update({
          plan,
          status,
          billing_provider: "stripe",
          stripe_subscription_id: sub.id,
          subscription_started_at: new Date(sub.current_period_start * 1000).toISOString(),
          subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
        });

        if (userId) {
          q = q.eq("user_id", userId);
        } else if (customerId) {
          q = q.eq("stripe_customer_id", customerId);
        } else {
          q = q.eq("stripe_subscription_id", sub.id);
        }

        await q;
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const userId = sub.metadata?.supabase_user_id;

        console.log(`[Stripe Webhook] Subscription cancelled for ${sub.id}`);

        let q = adminClient.from("subscriptions").update({
          plan: "free",
          status: "cancelled",
          billing_provider: "stripe",
          cancel_at_period_end: false,
          subscription_ends_at: new Date().toISOString(),
        });

        if (userId) {
          q = q.eq("user_id", userId);
        } else if (customerId) {
          q = q.eq("stripe_customer_id", customerId);
        } else {
          q = q.eq("stripe_subscription_id", sub.id);
        }

        await q;
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await adminClient
            .from("subscriptions")
            .update({
              status: "active",
              subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
            })
            .eq("stripe_subscription_id", subId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

        if (subId) {
          await adminClient
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", subId);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`Error processing webhook event ${event.type}:`, err);
    return new Response(JSON.stringify({ error: err.message || "Webhook processing error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
