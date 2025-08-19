-- RelayAI Dashboard Enhancements Migration

-- Ensure required columns/tables exist
create table if not exists business_overrides(
  tenant_id uuid not null references tenants(id) on delete cascade,
  open_override boolean,
  until timestamptz,
  updated_at timestamptz default now(),
  primary key(tenant_id)
);

alter table if exists public.calls add column if not exists after_hours boolean;
alter table if exists public.calls add column if not exists csat numeric;
alter table if exists public.calls add column if not exists outcome text;
alter table if exists public.calls add column if not exists booking_id uuid;
alter table if exists public.calls add column if not exists estimated_value numeric;

create table if not exists public.call_transcripts(
  call_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  transcript text
);

create table if not exists public.call_entities(
  id uuid default gen_random_uuid() primary key,
  call_id uuid references call_transcripts(call_id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity_type text,
  value text
);

alter table if exists public.appointments add column if not exists source text check (source in ('voice_after_hours','sms','web'));

alter table if exists public.leads add column if not exists stage text;
alter table if exists public.leads add column if not exists score int;
alter table if exists public.leads add column if not exists archived boolean default false;

create table if not exists public.lead_tasks(
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  due_at timestamptz,
  note text,
  completed boolean default false,
  created_at timestamptz default now()
);

-- Views
create or replace view public.vw_calls_by_day as
select tenant_id, to_char(date_trunc('day', start_at), 'YYYY-MM-DD') as date, count(*)::int as value
from public.calls
group by 1,2;

create or replace view public.vw_bookings_by_source as
select tenant_id, source, count(*)::int as count
from public.appointments
group by 1,2;

create or replace view public.vw_dashboard_kpis as
select
  c.tenant_id,
  count(*)::int as calls,
  count(*) filter (where status='answered')::int as answered,
  count(*) filter (where status='missed')::int as missed,
  count(*) filter (where after_hours and status='answered')::int as recovered,
  coalesce((select count(*) from appointments a where a.tenant_id=c.tenant_id),0)::int as bookings,
  avg(c.csat) as csat_avg,
  sum(coalesce(c.estimated_value,0)) as revenue
from public.calls c
group by 1;

-- after-hours stamping function
create or replace function public.fn_stamp_after_hours()
returns trigger language plpgsql as $$
declare hours jsonb;
begin
  select agent_settings.hours into hours from agent_settings where tenant_id = new.tenant_id;
  -- naive example: mark after-hours when outside 9-17 if hours missing
  if hours is null then
    new.after_hours := extract(hour from new.start_at) < 9 or extract(hour from new.start_at) >= 17;
  else
    -- TODO: parse business hours json; default to above
    new.after_hours := extract(hour from new.start_at) < 9 or extract(hour from new.start_at) >= 17;
  end if;
  return new;
end $$;

drop trigger if exists trg_calls_after_hours on public.calls;
create trigger trg_calls_after_hours before insert or update on public.calls
for each row execute procedure public.fn_stamp_after_hours();

-- RPCs
create or replace function public.reset_demo_data(p_tenant uuid) returns void language plpgsql as $$
begin
  delete from calls where tenant_id = p_tenant;
  delete from appointments where tenant_id = p_tenant;
  delete from sms_messages where tenant_id = p_tenant;
  delete from leads where tenant_id = p_tenant;
end $$;

create or replace function public.seed_demo_data(p_tenant uuid) returns void language plpgsql as $$
begin
  -- seed a few calls
  insert into calls(tenant_id, status, start_at, end_at, after_hours, csat, outcome, estimated_value)
  select p_tenant, (case when i%3=0 then 'missed' else 'answered' end), now() - (i||' days')::interval, now() - (i||' days')::interval + interval '5 minutes',
         (i%2=0), (random()*2+3)::numeric, 'info', (random()*200)::numeric
  from generate_series(1,14) g(i);

  -- seed a few bookings
  insert into appointments(tenant_id, start_at, price, source)
  select p_tenant, now() + (i||' days')::interval, (random()*100+50)::numeric, (case when i%2=0 then 'voice_after_hours' else 'web' end)
  from generate_series(1,6) g(i);

  -- seed leads
  insert into leads(tenant_id, stage, score, source) values
    (p_tenant,'New',60,'sms'),(p_tenant,'Qualified',75,'voice_after_hours'),(p_tenant,'Booked',85,'web');
end $$;

create or replace function public.toggle_ai_sms(p_tenant uuid, p_enabled boolean) returns void language plpgsql as $$
begin
  update agent_settings set ai_sms_autoreplies = p_enabled where tenant_id = p_tenant;
end $$;

-- Helper for UI fallback
create or replace function public.compute_basic_kpis(p_tenant uuid)
returns table(calls int, answered int, missed int, recovered int, bookings int, csat_avg numeric, revenue numeric)
language sql as $$
  with c as (
    select * from public.calls where tenant_id=p_tenant
  )
  select
    (select count(*) from c),
    (select count(*) from c where status='answered'),
    (select count(*) from c where status='missed'),
    (select count(*) from c where after_hours and status='answered'),
    (select count(*) from public.appointments where tenant_id=p_tenant),
    (select avg(csat) from c),
    (select sum(coalesce(estimated_value,0)) from c);
$$;

-- RLS (assumes tenants table + tenant_id columns exist)
alter table business_overrides enable row level security;
create policy if not exists "tenant_read_overrides" on business_overrides for select using (tenant_id = auth.uid()::uuid or true);
create policy if not exists "tenant_write_overrides" on business_overrides for insert with check (true);
create policy if not exists "tenant_update_overrides" on business_overrides for update using (true) with check (true);

-- minimal grants
grant select on vw_calls_by_day, vw_bookings_by_source, vw_dashboard_kpis to anon, authenticated;