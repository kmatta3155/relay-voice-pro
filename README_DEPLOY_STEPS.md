# Finalize Production Additions

## 1) Supabase SQL
Open **Supabase → SQL Editor**, paste the file `sql/production_additions.sql` contents and run.

## 2) Secrets
Set in **Supabase → Project Settings → Functions → Secrets**:
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already in most projects)
- APP_BASE_URL = your app URL (e.g., https://preview--relay-voice-pro.lovable.app)
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (for billing function)
- TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM (for notify function)
- RESEND_KEY (optional, for email)

## 3) Deploy Edge Functions
```bash
supabase functions deploy billing
supabase functions deploy notify
```

## 4) Router Guards
Wrap CRM pages with `<SubGuard>` (already used on Billing). Apply similarly to Overview/Leads/Appointments/Messages/Calls/Analytics routes in your router.

## 5) Stripe
Replace PRICE_ID_* constants in `src/pages/Billing.tsx` with your actual Price IDs. Add Stripe webhook endpoint to:
```
https://<YOUR-SUPABASE-REF>.functions.supabase.co/billing/webhook
```
Subscribe to: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.

## 6) MFA
Enable **TOTP** in Supabase Auth → Providers. Use Settings → MFA in app to enroll.

## 7) Sentry
Set DSN in `src/main.tsx` if not already.

---