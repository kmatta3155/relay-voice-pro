-- Staff members extracted from salon websites / booking platforms (Vagaro etc.)
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  role text,
  specialties text[],
  source text default 'website',
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, name)
);
create index if not exists idx_staff_tenant on public.staff(tenant_id);

-- Weekly working hours per staff member (dow: 0=Sunday .. 6=Saturday)
create table if not exists public.staff_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  start_time time not null,
  end_time time not null,
  unique (staff_id, dow, start_time)
);
create index if not exists idx_staff_sched_staff on public.staff_schedules(staff_id);
create index if not exists idx_staff_sched_tenant on public.staff_schedules(tenant_id);

alter table public.staff enable row level security;
alter table public.staff_schedules enable row level security;

-- Same membership pattern as other tenant-scoped tables
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select using (public.is_member(auth.uid(), tenant_id));
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));

drop policy if exists staff_sched_select on public.staff_schedules;
create policy staff_sched_select on public.staff_schedules
  for select using (public.is_member(auth.uid(), tenant_id));
drop policy if exists staff_sched_write on public.staff_schedules;
create policy staff_sched_write on public.staff_schedules
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));
