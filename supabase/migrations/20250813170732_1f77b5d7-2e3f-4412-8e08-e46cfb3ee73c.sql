-- Enable pgcrypto + pg_cron (cron may require paid project)
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- Materialized KPIs view (7d)
create materialized view if not exists public.mv_kpis_7d as
select
  (select count(*) from public.calls where at >= now() - interval '7 days') as calls_7d,
  (select count(*) from public.appointments where start_at >= now() - interval '7 days') as bookings_7d,
  (select count(*) from public.leads where created_at >= now() - interval '7 days') as leads_7d;

create or replace function public.refresh_kpis()
returns void language sql as $$
  refresh materialized view concurrently public.mv_kpis_7d;
$$;

-- Schedule KPI refresh every 15 minutes (if pg_cron available)
do $$ begin
  perform cron.schedule('refresh_kpis_15m', '*/15 * * * *', 'select public.refresh_kpis();');
exception when others then null;
end $$;

-- Tenant invites table
do $$ begin
  create type public.role_kind as enum ('owner', 'manager', 'agent', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  email text not null,
  role role_kind not null default 'agent',
  token uuid unique default gen_random_uuid(),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table public.tenant_invites enable row level security;

-- Invites RLS: only members of tenant can read/insert invites
create policy "invites_select" on public.tenant_invites
  for select using (public.is_member(auth.uid(), tenant_id));

create policy "invites_insert" on public.tenant_invites
  for insert with check (public.is_member(auth.uid(), tenant_id));

-- Add missing columns to messages for compatibility
alter table public.messages add column if not exists direction text check (direction in ('in', 'out'));
alter table public.messages add column if not exists body text;

-- Update existing messages to have proper values
update public.messages set direction = 'in', body = text where direction is null and body is null;

-- Data retention helpers (purge old calls/transcripts)
create or replace function public.purge_old()
returns void language plpgsql as $$
begin
  delete from public.calls where at < now() - interval '90 days';
end$$;

do $$ begin
  perform cron.schedule('purge_old_daily', '15 3 * * *', 'select public.purge_old();');
exception when others then null;
end $$;