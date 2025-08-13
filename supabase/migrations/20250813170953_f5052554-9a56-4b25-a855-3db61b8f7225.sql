-- Fix function search_path security issues by setting search_path for functions
create or replace function public.refresh_kpis()
returns void 
language sql 
security definer
set search_path = 'public'
as $$
  refresh materialized view public.mv_kpis_7d;
$$;

create or replace function public.purge_old()
returns void 
language plpgsql 
security definer
set search_path = 'public'
as $$
begin
  delete from public.calls where at < now() - interval '90 days';
end$$;

-- Hide materialized view from API by revoking permissions
revoke all on public.mv_kpis_7d from anon;
revoke all on public.mv_kpis_7d from authenticated;