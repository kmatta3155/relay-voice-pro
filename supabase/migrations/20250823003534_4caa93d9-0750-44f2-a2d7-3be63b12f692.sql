-- 1) Per-tenant AI Agent (one row per tenant)
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null default 'Receptionist',
  model text not null default 'gpt-5-mini-2025-08-07',
  voice_provider text null,            -- e.g., 'elevenlabs' | 'none'
  voice_id text null,                  -- e.g., ElevenLabs voice ID
  system_prompt text not null default '',
  tools jsonb not null default '{}'::jsonb,      -- tool defs / flags (booking, sms, etc.)
  overrides jsonb not null default '{}'::jsonb,  -- e.g., greetings, language, firstMessage
  status text not null default 'needs_training', -- 'needs_training' | 'training' | 'ready' | 'error'
  version integer not null default 1,
  trained_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure one agent per tenant (can relax later if you want multiple per tenant)
create unique index if not exists ai_agents_tenant_unique on public.ai_agents(tenant_id);

alter table public.ai_agents enable row level security;

-- RLS: members can read; managers+ can write
create policy ai_agents_select
  on public.ai_agents
  for select
  using (is_member(auth.uid(), tenant_id));

create policy ai_agents_insert
  on public.ai_agents
  for insert
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy ai_agents_update
  on public.ai_agents
  for update
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role))
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy ai_agents_delete
  on public.ai_agents
  for delete
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

-- 2) Runtime bindings for external providers (e.g., ElevenLabs agent)
create table if not exists public.agent_runtimes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  provider text not null,                -- 'elevenlabs' | 'openai-rtc' | 'custom'
  external_agent_id text null,           -- provider agent id
  ws_url text null,                      -- provider ws url if applicable
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active', -- 'active' | 'disabled' | 'error'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (agent_id, provider)
);

create index if not exists agent_runtimes_tenant_idx on public.agent_runtimes(tenant_id);

alter table public.agent_runtimes enable row level security;

create policy agent_runtimes_select
  on public.agent_runtimes
  for select
  using (is_member(auth.uid(), tenant_id));

create policy agent_runtimes_insert
  on public.agent_runtimes
  for insert
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy agent_runtimes_update
  on public.agent_runtimes
  for update
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role))
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy agent_runtimes_delete
  on public.agent_runtimes
  for delete
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

-- 3) Training jobs to track (re)training runs per agent
create table if not exists public.agent_training_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  status text not null default 'queued', -- 'queued' | 'running' | 'succeeded' | 'failed'
  started_at timestamptz null,
  finished_at timestamptz null,
  error text null,
  params jsonb not null default '{}'::jsonb,   -- optional tuning params
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists agent_training_jobs_tenant_idx on public.agent_training_jobs(tenant_id);
create index if not exists agent_training_jobs_agent_idx on public.agent_training_jobs(agent_id);

alter table public.agent_training_jobs enable row level security;

create policy agent_training_jobs_select
  on public.agent_training_jobs
  for select
  using (is_member(auth.uid(), tenant_id));

create policy agent_training_jobs_insert
  on public.agent_training_jobs
  for insert
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy agent_training_jobs_update
  on public.agent_training_jobs
  for update
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role))
  with check (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

create policy agent_training_jobs_delete
  on public.agent_training_jobs
  for delete
  using (has_role(auth.uid(), tenant_id, 'MANAGER'::role));