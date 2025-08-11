/* ---------- ENABLED EXTENSIONS ---------- */
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

/* ---------- AUTH-PROFILES BRIDGE ---------- */
-- Supabase auth schema has auth.users. We mirror into public.profiles.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  image_url text,
  active_tenant_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_profiles_active_tenant on public.profiles(active_tenant_id);

-- keep profiles in sync on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name, image_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ---------- MULTI-TENANT CORE ---------- */
create table if not exists public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- create enum role if it doesn't exist
DO $$ BEGIN
  CREATE TYPE public.role AS ENUM ('OWNER','MANAGER','AGENT','VIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

create table if not exists public.memberships (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.role not null default 'AGENT',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, tenant_id)
);
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_tenant on public.memberships(tenant_id);

/* ---------- BUSINESS OBJECTS (TENANT-SCOPED) ---------- */
create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  source text,
  status text,
  value integer,
  notes text,
  score integer,
  score_tier text,
  intent text,
  owner_id uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_leads_tenant on public.leads(tenant_id);

create table if not exists public.threads (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  "with" text not null,
  channel text not null, -- sms, web, instagram, facebook
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_threads_tenant on public.threads(tenant_id);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  "from" text not null, -- lead | agent | system
  text text not null,
  at timestamptz default now()
);
create index if not exists idx_messages_tenant on public.messages(tenant_id);
create index if not exists idx_messages_thread on public.messages(thread_id);

create table if not exists public.calls (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  "from" text not null,
  "to" text,
  outcome text,
  duration integer,
  at timestamptz default now(),
  summary text
);
create index if not exists idx_calls_tenant on public.calls(tenant_id);

create table if not exists public.appointments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  customer text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  staff text,
  created_at timestamptz default now()
);
create index if not exists idx_appts_tenant on public.appointments(tenant_id);

create table if not exists public.automations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  "when" text,
  action text,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_automations_tenant on public.automations(tenant_id);

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'stripe',
  customer_id text not null,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_subs_tenant on public.subscriptions(tenant_id);

/* ---------- ROW LEVEL SECURITY (RLS) ---------- */
alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.leads enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.appointments enable row level security;
alter table public.automations enable row level security;
alter table public.subscriptions enable row level security;

/* Helpers to check membership */
create or replace function public.is_member(u uuid, t uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists(select 1 from public.memberships m where m.user_id = u and m.tenant_id = t)
$$;

create or replace function public.has_role(u uuid, t uuid, min_role public.role)
returns boolean
language plpgsql
stable
security definer
as $func$
declare r public.role;
begin
  select role into r from public.memberships where user_id=u and tenant_id=t limit 1;
  if r is null then return false; end if;
  if (r='OWNER') then return true;
  if (r='MANAGER' and min_role in ('MANAGER','AGENT','VIEWER')) then return true;
  if (r='AGENT'   and min_role in ('AGENT','VIEWER')) then return true;
  if (r='VIEWER'  and min_role in ('VIEWER')) then return true;
  return false;
end;
$func$;

/* Policies */
-- profiles: only the user can read/update their profile
DO $$ BEGIN
  create policy "profiles self read"  on public.profiles for select using (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "profiles self write" on public.profiles for update using (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tenants: members can read; owners/managers can update
DO $$ BEGIN
  create policy "tenants read for members" on public.tenants for select using (public.is_member(auth.uid(), id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "tenants update for managers" on public.tenants for update using (public.has_role(auth.uid(), id, 'MANAGER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- memberships: user can see their memberships; managers can manage within tenant
DO $$ BEGIN
  create policy "memberships read self" on public.memberships for select using (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "memberships read by tenant" on public.memberships for select using (public.is_member(auth.uid(), tenant_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "memberships manage by managers" on public.memberships for all using (public.has_role(auth.uid(), tenant_id, 'MANAGER')) with check (public.has_role(auth.uid(), tenant_id, 'MANAGER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tenant-scoped tables: readable/updatable only if member; inserts require membership + correct tenant_id
DO $do$
declare t text;
begin
  for t in select unnest(array['leads','threads','messages','calls','appointments','automations','subscriptions'])
  loop
    execute format('drop policy if exists %I on public.%I;', t||'_select', t);
    execute format('create policy %I on public.%I for select using (public.is_member(auth.uid(), tenant_id));', t||'_select', t);

    execute format('drop policy if exists %I on public.%I;', t||'_insert', t);
    execute format('create policy %I on public.%I for insert with check (public.is_member(auth.uid(), tenant_id));', t||'_insert', t);

    execute format('drop policy if exists %I on public.%I;', t||'_update', t);
    execute format('create policy %I on public.%I for update using (public.is_member(auth.uid(), tenant_id));', t||'_update', t);

    execute format('drop policy if exists %I on public.%I;', t||'_delete', t);
    execute format('create policy %I on public.%I for delete using (public.has_role(auth.uid(), tenant_id, ''MANAGER''));', t||'_delete', t);
  end loop;
end
$do$;

/* ---------- SEED (optional) ---------- */
insert into public.tenants (id, name, slug)
  values (uuid_generate_v4(), 'Demo Tenant', 'demo')
on conflict do nothing;