Supabase Setup (Vite)
Create a Supabase project. Copy Project URL and anon key to .env as:

VITE_SUPABASE_URL

VITE_SUPABASE_ANON_KEY

In Supabase Dashboard → SQL Editor, paste and run supabase/schema.sql.

In Authentication → Providers, enable Email (Magic Link). Optionally enable Google and set authorized redirect to your app origin.

Run your Vite app. Sign in. The first user will be auto‑created in profiles. The app will enroll you into the demo tenant on first login (via ensureDemoTenant()).

All CRUD is protected by RLS. If you can read/write, your membership allows it.

Later: add Supabase Edge Functions for Twilio/Stripe webhooks; map inbound numbers to tenant IDs and insert into calls/messages tables.
