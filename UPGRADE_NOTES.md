
# RelayAI Dashboard Enhancements (2025-08-18)

This update adds:
- Polished Overview KPIs, animated charts, skeleton loaders
- Conversation IQ card + transcript drilldown
- Leads mini-pipeline, Knowledge status, Usage & Billing tile
- Tenant badge/switcher and health chips
- Supabase SQL: views (vw_dashboard_kpis, vw_calls_by_day, vw_bookings_by_source), RPCs (seed/reset/toggle-ai-sms), after-hours stamping trigger
- Edge functions for demo reset/seed, AI SMS toggle, CSAT webhook

## Deploy

1. Apply migrations:
   ```bash
   supabase db push
   ```

2. Deploy edge functions:
   ```bash
   supabase functions deploy reset-demo
   supabase functions deploy seed-demo
   supabase functions deploy toggle-ai-sms
   supabase functions deploy csat-webhook
   ```

3. Ensure env vars for functions:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. Rebuild the web app.
