import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Content-Type": "application/json" } });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required environment variables for stripe-webhook.");
    return new Response(
      JSON.stringify({ error: "Server configuration missing required secrets." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature header." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`Processing Stripe event: ${event.type} (${event.id})`);

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
            console.error(
              `checkout.session.completed: Could not find supabase_user_id for session ${session.id}`
            );
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

          const { error: upsertErr } = await adminClient.from("subscriptions").upsert(
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

          if (upsertErr) {
            console.error("Error upserting subscription on checkout.session.completed:", upsertErr);
            throw upsertErr;
          }
          console.log(`Successfully activated Haqqi Plus for user ${userId}`);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        const userId = subscription.metadata?.supabase_user_id;

        const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const cancelAtPeriodEnd = subscription.cancel_at_period_end;

        // Map Stripe subscription status to Haqqi status
        let plan = "plus";
        let status = "active";

        if (subscription.status === "active" || subscription.status === "trialing") {
          plan = "plus";
          status = "active";
        } else if (subscription.status === "past_due") {
          plan = "plus";
          status = "past_due";
        } else if (
          subscription.status === "canceled" ||
          subscription.status === "unpaid" ||
          subscription.status === "incomplete_expired"
        ) {
          plan = "free";
          status = "cancelled";
        }

        // Try updating by stripe_subscription_id first, then by stripe_customer_id or user_id
        let query = adminClient
          .from("subscriptions")
          .update({
            plan,
            status,
            billing_provider: "stripe",
            stripe_subscription_id: subscription.id,
            subscription_started_at: periodStart,
            subscription_ends_at: periodEnd,
            cancel_at_period_end: cancelAtPeriodEnd,
          });

        if (userId) {
          query = query.eq("user_id", userId);
        } else if (customerId) {
          query = query.eq("stripe_customer_id", customerId);
        } else {
          query = query.eq("stripe_subscription_id", subscription.id);
        }

        const { error: updateErr } = await query;
        if (updateErr) {
          console.error(`Error updating subscription ${subscription.id}:`, updateErr);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        const userId = subscription.metadata?.supabase_user_id;

        console.log(`Subscription ${subscription.id} deleted. Reverting user to Free plan.`);

        // Revert user to free plan, preserve all receivables and user data!
        let query = adminClient
          .from("subscriptions")
          .update({
            plan: "free",
            status: "cancelled",
            billing_provider: "stripe",
            cancel_at_period_end: false,
            subscription_ends_at: new Date().toISOString(),
          });

        if (userId) {
          query = query.eq("user_id", userId);
        } else if (customerId) {
          query = query.eq("stripe_customer_id", customerId);
        } else {
          query = query.eq("stripe_subscription_id", subscription.id);
        }

        const { error: cancelErr } = await query;
        if (cancelErr) {
          console.error("Error setting subscription to cancelled:", cancelErr);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

          await adminClient
            .from("subscriptions")
            .update({
              status: "active",
              subscription_ends_at: periodEnd,
            })
            .eq("stripe_subscription_id", subscriptionId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

        if (subscriptionId) {
          console.warn(`Payment failed for subscription ${subscriptionId}. Marking past_due.`);
          await adminClient
            .from("subscriptions")
            .update({
              status: "past_due",
            })
            .eq("stripe_subscription_id", subscriptionId);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`Error processing webhook event ${event.type}:`, err);
    return new Response(JSON.stringify({ error: err.message || "Webhook processing failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
