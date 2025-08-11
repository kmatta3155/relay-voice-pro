-- Harden functions: set explicit search_path to satisfy linter and improve security
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, image_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end; $$;

create or replace function public.is_member(u uuid, t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.memberships m where m.user_id = u and m.tenant_id = t)
$$;

create or replace function public.has_role(u uuid, t uuid, min_role public.role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select role from public.memberships where user_id = u and tenant_id = t limit 1
  )
  select case
    when (select role from r) is null then false
    when (select role from r) = 'OWNER'::public.role then true
    when (select role from r) = 'MANAGER'::public.role and min_role in ('MANAGER','AGENT','VIEWER') then true
    when (select role from r) = 'AGENT'::public.role and min_role in ('AGENT','VIEWER') then true
    when (select role from r) = 'VIEWER'::public.role and min_role in ('VIEWER') then true
    else false
  end;
$$;