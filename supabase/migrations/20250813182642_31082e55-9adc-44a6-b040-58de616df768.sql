-- Enable pgcrypto + pg_cron (cron may require paid project)
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- Materialized KPIs view (7d)
create materialized view if not exists public.mv_kpis_7d as
select
  (select count(*) from public.calls where at >= now() - interval '7 days') as calls_7d,
  (select count(*) from public.appointments where start >= now() - interval '7 days') as bookings_7d,
  (select count(*) from public.leads where created_at >= now() - interval '7 days') as leads_7d;

create or replace function public.refresh_kpis()
returns void language sql as $$
  refresh materialized view public.mv_kpis_7d;
$$;

-- Data retention helpers (purge old calls/transcripts)
create or replace function public.purge_old()
returns void language plpgsql as $$
begin
  delete from public.calls where at < now() - interval '90 days';
end$$;

-- Ensure appointments has required columns
alter table public.appointments add column if not exists start timestamptz;
alter table public.appointments add column if not exists "end" timestamptz;

-- Conversations/messages columns (normalization)
alter table public.messages add column if not exists sent_at timestamptz default now();
alter table public.messages alter column sent_at set not null;
alter table public.messages add column if not exists conversation_id uuid;
create index if not exists idx_messages_conv on public.messages(conversation_id, sent_at);

-- (FK may be validated later if legacy rows exist)
do $$ begin
  if not exists (select 1 from pg_constraint where conname='messages_conversation_id_fkey') then
    alter table public.messages add constraint messages_conversation_id_fkey foreign key (conversation_id) references public.conversations(id) on delete cascade not valid;
  end if;
  exception when others then null; end $$;