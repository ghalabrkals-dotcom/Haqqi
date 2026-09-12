-- Migration: Stripe Subscriptions support for Haqqi Plus
-- Adds Stripe customer & subscription identifiers and updates status/RLS constraints

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Create indexes for fast lookup during Stripe webhook processing
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);

-- Update status constraint to support Stripe subscription statuses: none, active, cancelled, past_due
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('none', 'active', 'cancelled', 'past_due'));

-- Restrict write permissions: Only service_role should update subscription status from verified Stripe webhooks.
-- Regular authenticated users can still view (SELECT) their own subscription record.
DROP POLICY IF EXISTS "Users can create their own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscription" ON public.subscriptions;

-- Re-verify SELECT policy
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscriptions;
CREATE POLICY "Users can view their own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Ensure service_role has full control
GRANT ALL ON public.subscriptions TO service_role;
