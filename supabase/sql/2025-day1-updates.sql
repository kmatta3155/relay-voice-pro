-- This migration contains Day‑1 tables and column updates needed to support the
-- AI receptionist features built in this project.  Run this migration
-- after applying the core schema in supabase/schema.sql.  Each statement is
-- guarded with IF NOT EXISTS where possible to make the migration
-- idempotent.

-- ---------------------------------------------------------------------------
-- Agent settings
-- ---------------------------------------------------------------------------

-- Stores per‑tenant configuration for the voice and SMS agents.  Only one
-- settings row is allowed per tenant.  Additional columns can be added as
-- needed, for example to track extra preferences or AI model tuning.
create table if not exists public.agent_settings (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_number text,
  agent_ws_url text,
  voice_id text,
  greeting text,
  business_intro text,
  hours_json jsonb,
  default_appointment_minutes integer default 30,
  timezone text default 'America/New_York',
  after_hours_enabled boolean default false,
  after_hours_vm_enabled boolean default false,
  after_hours_forward_to text,
  after_hours_alert_email text,
  sms_ai_enabled boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id)
);

-- Enable Row Level Security (RLS) and restrict reads/writes to members of the
-- tenant.  Managers and owners may write settings; members may read.
alter table public.agent_settings enable row level security;
-- Create row level security (RLS) policies.  PostgreSQL does not support
-- "CREATE POLICY IF NOT EXISTS", so the following policies may error
-- if they already exist.  Run this migration only once per environment.
create policy agent_settings_tenant_read on public.agent_settings
  for select using (public.is_member(auth.uid(), tenant_id));
create policy agent_settings_tenant_write on public.agent_settings
  for update using (public.has_role(auth.uid(), tenant_id, 'MANAGER'));
create policy agent_settings_tenant_insert on public.agent_settings
  for insert with check (public.has_role(auth.uid(), tenant_id, 'MANAGER'));

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------

-- Defines the services offered by a tenant (e.g. haircuts, dental exams).
-- This table supports the AI receptionist when booking appointments.  You
-- can attach a price and a duration to each service.  Names are required.
create table if not exists public.services (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 30,
  price_cents integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.services enable row level security;
create policy services_tenant_read on public.services
  for select using (public.is_member(auth.uid(), tenant_id));
create policy services_tenant_write on public.services
  for update using (public.has_role(auth.uid(), tenant_id, 'MANAGER'));
create policy services_tenant_insert on public.services
  for insert with check (public.has_role(auth.uid(), tenant_id, 'MANAGER'));
create policy services_tenant_delete on public.services
  for delete using (public.has_role(auth.uid(), tenant_id, 'MANAGER'));

-- ---------------------------------------------------------------------------
-- Lead notes
-- ---------------------------------------------------------------------------

-- Additional notes that staff can attach to a lead.  See the leads table in
-- schema.sql for the core lead fields.  Each note belongs to one lead and
-- shares the tenant_id for RLS enforcement.
create table if not exists public.lead_notes (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_id uuid references auth.users(id),
  note text not null,
  created_at timestamptz default now()
);
alter table public.lead_notes enable row level security;
create policy lead_notes_tenant_read on public.lead_notes
  for select using (public.is_member(auth.uid(), tenant_id));
create policy lead_notes_tenant_insert on public.lead_notes
  for insert with check (public.is_member(auth.uid(), tenant_id));

-- ---------------------------------------------------------------------------
-- Appointments enhancements
-- ---------------------------------------------------------------------------

-- Extend the existing appointments table to track status and store the
-- customer’s phone number.  Use conditional additions to keep this
-- migration idempotent.
alter table public.appointments add column if not exists status text default 'confirmed';
alter table public.appointments add column if not exists customer_phone text;

-- ---------------------------------------------------------------------------
-- Tenant billing fields
-- ---------------------------------------------------------------------------

-- Add Stripe customer and subscription info to the tenants table.  Plan key
-- identifies the subscription tier (e.g. starter, pro).
alter table public.tenants add column if not exists stripe_customer_id text;
alter table public.tenants add column if not exists subscription_status text default 'trialing';
alter table public.tenants add column if not exists plan_key text;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Record administrative actions for auditing.  This helps track who did
-- what within a tenant.  Only managers may insert entries.
create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb,
  created_at timestamptz default now()
);
alter table public.audit_log enable row level security;
create policy audit_log_read on public.audit_log
  for select using (public.is_member(auth.uid(), tenant_id));
create policy audit_log_write on public.audit_log
  for insert with check (public.has_role(auth.uid(), tenant_id, 'MANAGER'));

-- ---------------------------------------------------------------------------
-- Voicemails
-- ---------------------------------------------------------------------------

-- Stores voicemail recordings for after‑hours calls.  Recording URL points to
-- the Twilio recording or other storage.  Only managers can see all
-- voicemails.
create table if not exists public.voicemails (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_number text,
  to_number text,
  recording_url text,
  transcription text,
  created_at timestamptz default now()
);
alter table public.voicemails enable row level security;
create policy voicemails_tenant_read on public.voicemails
  for select using (public.is_member(auth.uid(), tenant_id));
create policy voicemails_tenant_write on public.voicemails
  for insert with check (public.has_role(auth.uid(), tenant_id, 'MANAGER'));

-- ---------------------------------------------------------------------------
-- SMS messaging
-- ---------------------------------------------------------------------------

-- All SMS messages (inbound and outbound) are stored here.  Each row
-- includes the sender and recipient phone numbers, the message body and
-- direction.  An optional thread_id can link related messages if you
-- implement threading later.
create table if not exists public.sms_messages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_from text not null,
  phone_to text not null,
  direction text not null, -- inbound or outbound
  body text not null,
  thread_id uuid,
  created_at timestamptz default now()
);
alter table public.sms_messages enable row level security;
create policy sms_messages_tenant_read on public.sms_messages
  for select using (public.is_member(auth.uid(), tenant_id));
create policy sms_messages_tenant_insert on public.sms_messages
  for insert with check (public.is_member(auth.uid(), tenant_id));

-- Tracks the last intent and any context for an ongoing SMS conversation.
create table if not exists public.sms_sessions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_number text not null,
  last_intent text,
  context jsonb,
  updated_at timestamptz default now()
);
alter table public.sms_sessions enable row level security;
create policy sms_sessions_tenant_read on public.sms_sessions
  for select using (public.is_member(auth.uid(), tenant_id));
create policy sms_sessions_tenant_write on public.sms_sessions
  for insert, update using (public.is_member(auth.uid(), tenant_id));

-- Records opt‑out status for customers who text STOP.  A unique constraint
-- ensures a phone number only appears once per tenant.
create table if not exists public.sms_optouts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_number text not null,
  opted_out boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, phone_number)
);
alter table public.sms_optouts enable row level security;
create policy sms_optouts_tenant_read on public.sms_optouts
  for select using (public.is_member(auth.uid(), tenant_id));
create policy sms_optouts_tenant_write on public.sms_optouts
  for insert, update using (public.is_member(auth.uid(), tenant_id));