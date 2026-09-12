import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripePriceId = Deno.env.get("STRIPE_PRICE_ID");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Supabase environment not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({
          error: "STRIPE_SECRET_KEY is not configured in Supabase environment secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate user via JWT
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client to inspect existing subscription
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: existingSub } = await adminClient
      .from("subscriptions")
      .select("id, plan, status, stripe_customer_id, stripe_subscription_id, subscription_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // Prevent duplicate active subscription
    if (
      existingSub &&
      existingSub.plan === "plus" &&
      existingSub.status === "active" &&
      (!existingSub.subscription_ends_at || new Date(existingSub.subscription_ends_at) > new Date())
    ) {
      return new Response(
        JSON.stringify({
          error: "You already have an active Haqqi Plus subscription.",
          alreadySubscribed: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Resolve or create Stripe Customer
    let customerId = existingSub?.stripe_customer_id;
    if (!customerId) {
      const existingCustomers = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const newCustomer = await stripe.customers.create({
          email: user.email,
          metadata: {
            supabase_user_id: user.id,
          },
        });
        customerId = newCustomer.id;
      }

      // Record customer ID on subscription row
      await adminClient.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_customer_id: customerId,
        },
        { onConflict: "user_id" }
      );
    }

    const body = await req.json().catch(() => ({}));
    const returnUrl = (body.returnUrl as string) || "http://localhost:3000/plans";
    const cleanReturnUrl = returnUrl.split("?")[0];

    // Build line items (Price ID or dynamic KWD 2.990)
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
      client_reference_id: user.id,
      line_items: lineItems,
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
        },
      },
      metadata: {
        supabase_user_id: user.id,
      },
      success_url: `${cleanReturnUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${cleanReturnUrl}?cancelled=true`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error creating checkout session:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
