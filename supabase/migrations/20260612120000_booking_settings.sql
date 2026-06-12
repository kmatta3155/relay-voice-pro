-- Per-tenant booking configuration: run the AI as the salon's booking system
-- (native) or hand callers off to the salon's existing platform (external).
create table if not exists public.booking_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mode text not null default 'native' check (mode in ('native', 'external')),
  provider text,                       -- e.g. 'Vagaro', 'Square', 'Fresha'
  external_url text,                   -- booking link the AI offers in external mode
  slot_granularity_minutes int not null default 30,
  buffer_minutes int not null default 0,
  default_service_minutes int not null default 60,
  timezone text default 'America/New_York',
  updated_at timestamptz default now()
);

alter table public.booking_settings enable row level security;

drop policy if exists booking_settings_select on public.booking_settings;
create policy booking_settings_select on public.booking_settings
  for select using (public.is_member(auth.uid(), tenant_id));
drop policy if exists booking_settings_write on public.booking_settings;
create policy booking_settings_write on public.booking_settings
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));

-- Link appointments to a staff row (the existing `staff` text column stays for
-- the voice agent's free-text writes; this is the structured reference).
alter table public.appointments add column if not exists staff_id uuid references public.staff(id) on delete set null;
alter table public.appointments add column if not exists service_id uuid references public.services(id) on delete set null;
alter table public.appointments add column if not exists status text default 'booked';
alter table public.appointments add column if not exists phone text;
alter table public.appointments add column if not exists source text default 'manual';
create index if not exists idx_appts_staff on public.appointments(staff_id);
