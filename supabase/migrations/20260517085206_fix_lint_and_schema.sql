-- Fix DB lint errors and missing schema elements

-- 1. Add missing price column to appointments (referenced by seed_demo_data)
alter table if exists public.appointments
  add column if not exists price numeric;

-- 2. Fix reset_demo_data: remove reference to non-existent sms_messages table
create or replace function public.reset_demo_data(p_tenant uuid)
returns void language plpgsql as $$
begin
  delete from calls where tenant_id = p_tenant;
  delete from appointments where tenant_id = p_tenant;
  delete from leads where tenant_id = p_tenant;
end $$;

-- 3. Fix seed_demo_data: now price column exists on appointments
create or replace function public.seed_demo_data(p_tenant uuid)
returns void language plpgsql as $$
begin
  -- seed calls
  insert into calls(tenant_id, status, start_at, end_at, after_hours, csat, outcome, estimated_value)
  select p_tenant,
    (case when i%3=0 then 'missed' else 'answered' end),
    now() - (i||' days')::interval,
    now() - (i||' days')::interval + interval '5 minutes',
    (i%2=0),
    (random()*2+3)::numeric,
    'info',
    (random()*200)::numeric
  from generate_series(1,14) g(i);

  -- seed appointments
  insert into appointments(tenant_id, start_at, price, source)
  select p_tenant,
    now() + (i||' days')::interval,
    (random()*100+50)::numeric,
    (case when i%2=0 then 'voice_after_hours' else 'web' end)
  from generate_series(1,6) g(i);

  -- seed leads
  insert into leads(tenant_id, stage, score, source) values
    (p_tenant,'New',60,'sms'),
    (p_tenant,'Qualified',75,'voice_after_hours'),
    (p_tenant,'Booked',85,'web');
end $$;
