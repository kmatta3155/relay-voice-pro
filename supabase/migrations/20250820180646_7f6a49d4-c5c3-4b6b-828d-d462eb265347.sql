-- Admin Onboarding: data model (idempotent)

create table if not exists public.tenant_branding (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  logo_url text,
  brand_color text default '#6d28d9',
  updated_at timestamptz default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  duration_minutes int not null default 30,
  price numeric,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.business_hours (
  tenant_id uuid not null references tenants(id) on delete cascade,
  dow int not null check (dow between 0 and 6),
  open_time time not null,
  close_time time not null,
  primary key (tenant_id, dow)
);

create table if not exists public.holidays (
  tenant_id uuid not null references tenants(id) on delete cascade,
  day date not null,
  name text,
  primary key (tenant_id, day)
);

create table if not exists public.tenant_users (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','staff')),
  created_at timestamptz default now(),
  primary key (tenant_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','manager','staff')),
  status text not null default 'pending',
  created_at timestamptz default now()
);

-- Add columns to agent_settings if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'twilio_number') THEN
    ALTER TABLE agent_settings ADD COLUMN twilio_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'forward_number') THEN
    ALTER TABLE agent_settings ADD COLUMN forward_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'after_hours_voicemail') THEN
    ALTER TABLE agent_settings ADD COLUMN after_hours_voicemail boolean default true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'greeting') THEN
    ALTER TABLE agent_settings ADD COLUMN greeting text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'website_url') THEN
    ALTER TABLE agent_settings ADD COLUMN website_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'ai_sms_autoreplies') THEN
    ALTER TABLE agent_settings ADD COLUMN ai_sms_autoreplies boolean default false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'agent_ws_url') THEN
    ALTER TABLE agent_settings ADD COLUMN agent_ws_url text;
  END IF;
END $$;

-- RLS (minimal; align with your patterns)
alter table tenant_branding enable row level security;
create policy if not exists t_brand_read on tenant_branding
  for select using (exists (select 1 from tenant_users tu where tu.tenant_id = tenant_branding.tenant_id and tu.user_id = auth.uid()));
create policy if not exists t_brand_write on tenant_branding
  for insert with check (exists (select 1 from tenant_users tu where tu.tenant_id = tenant_branding.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));
create policy if not exists t_brand_update on tenant_branding
  for update using (exists (select 1 from tenant_users tu where tu.tenant_id = tenant_branding.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));

alter table services enable row level security;
create policy if not exists svc_read on services
  for select using (exists (select 1 from tenant_users tu where tu.tenant_id = services.tenant_id and tu.user_id = auth.uid()));
create policy if not exists svc_write on services
  for insert with check (exists (select 1 from tenant_users tu where tu.tenant_id = services.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));
create policy if not exists svc_update on services
  for update using (exists (select 1 from tenant_users tu where tu.tenant_id = services.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));

alter table business_hours enable row level security;
create policy if not exists bh_read on business_hours
  for select using (exists (select 1 from tenant_users tu where tu.tenant_id = business_hours.tenant_id and tu.user_id = auth.uid()));
create policy if not exists bh_write on business_hours
  for insert with check (exists (select 1 from tenant_users tu where tu.tenant_id = business_hours.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));
create policy if not exists bh_update on business_hours
  for update using (exists (select 1 from tenant_users tu where tu.tenant_id = business_hours.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));

alter table holidays enable row level security;
create policy if not exists hd_read on holidays
  for select using (exists (select 1 from tenant_users tu where tu.tenant_id = holidays.tenant_id and tu.user_id = auth.uid()));
create policy if not exists hd_write on holidays
  for insert with check (exists (select 1 from tenant_users tu where tu.tenant_id = holidays.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));
create policy if not exists hd_update on holidays
  for update using (exists (select 1 from tenant_users tu where tu.tenant_id = holidays.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin','manager')));

alter table tenant_users enable row level security;
create policy if not exists tu_read on tenant_users for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy if not exists tu_write on tenant_users for insert
  with check (exists (select 1 from tenant_users tu where tu.tenant_id = tenant_users.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin')));
create policy if not exists tu_update on tenant_users for update
  using (exists (select 1 from tenant_users tu where tu.tenant_id = tenant_users.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin')));

alter table invites enable row level security;
create policy if not exists inv_read on invites for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy if not exists inv_write on invites for insert
  with check (exists (select 1 from tenant_users tu where tu.tenant_id = invites.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin')));
create policy if not exists inv_update on invites for update
  using (exists (select 1 from tenant_users tu where tu.tenant_id = invites.tenant_id and tu.user_id = auth.uid() and tu.role in ('owner','admin')));