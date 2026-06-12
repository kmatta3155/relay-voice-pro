-- Stylist bios + photos
alter table public.staff add column if not exists bio text;
alter table public.staff add column if not exists photo_url text;

-- Which services each stylist performs ("Maya does balayage")
create table if not exists public.staff_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);
create index if not exists idx_staff_services_tenant on public.staff_services(tenant_id);
create index if not exists idx_staff_services_service on public.staff_services(service_id);

-- Vacations / blocked dates per stylist
create table if not exists public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz default now(),
  check (end_date >= start_date)
);
create index if not exists idx_staff_time_off_staff on public.staff_time_off(staff_id);

alter table public.staff_services enable row level security;
alter table public.staff_time_off enable row level security;

drop policy if exists staff_services_select on public.staff_services;
create policy staff_services_select on public.staff_services
  for select using (public.is_member(auth.uid(), tenant_id));
drop policy if exists staff_services_write on public.staff_services;
create policy staff_services_write on public.staff_services
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));

drop policy if exists staff_time_off_select on public.staff_time_off;
create policy staff_time_off_select on public.staff_time_off
  for select using (public.is_member(auth.uid(), tenant_id));
drop policy if exists staff_time_off_write on public.staff_time_off;
create policy staff_time_off_write on public.staff_time_off
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));
