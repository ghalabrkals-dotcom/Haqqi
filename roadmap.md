# Haqqi roadmap

## QA & integration pass
- [x] Status colours consistent (activity dots, notification dots, detail timeline)
- [x] Prevent duplicate payment submission on the detail page
- [x] Prevent double transaction matching (atomic claim + disabled buttons)
- [x] Fix mobile horizontal overflow on Dashboard / Insights
- [x] Full authenticated walkthrough of all pages, no console errors

## Professional fintech polish pass
- [x] Tighter typography hierarchy: smaller page/section titles
- [x] Dashboard hierarchy: dominant total, compact supporting stats
- [x] Activity: compact rows, per-event amounts with +, green for received
- [x] Insights: restrained Haqqi Score with "not a credit score" note
- [x] Microcopy trimmed on dashboard and empty states
- [x] Mobile: amount, status and next action lead the screen

## Stripe Subscriptions pass
- [x] Server-side Stripe environment variables & secrets architecture
- [x] Supabase migration for Stripe customer and subscription IDs
- [x] Supabase Edge Function `create-checkout-session` for Haqqi Plus (KD 2.990 / month)
- [x] Supabase Edge Function `customer-portal` for self-serve subscription management & cancellation
- [x] Supabase Edge Function `stripe-webhook` for secure signature verification & state synchronization
- [x] Upgraded Plans page with checkout redirect, webhook confirmation polling, and Customer Portal link
- [x] Demounted Demo Subscription flow
