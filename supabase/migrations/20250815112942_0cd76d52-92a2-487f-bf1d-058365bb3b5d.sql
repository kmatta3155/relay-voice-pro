-- Enable pgvector
create extension if not exists vector;

-- Knowledge sources (what we crawled or uploaded)
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_url text,
  source_type text not null default 'web', -- web|gmb|manual|file
  title text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Knowledge chunks (RAG-ready) - using smaller embedding size for ivfflat compatibility
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_id uuid references public.knowledge_sources(id) on delete cascade,
  content text not null,
  token_count int not null default 0,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

-- Unanswered / uncertain questions (learning mode queue)
create table if not exists public.unresolved_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  asked_by uuid,                 -- auth.uid() if known
  question text not null,
  call_id text,                  -- optional correlation
  status text not null default 'open', -- open|auto_answered|resolved|ignored
  notes text,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_kc_tenant on public.knowledge_chunks(tenant_id);
create index if not exists idx_ks_tenant on public.knowledge_sources(tenant_id);
create index if not exists idx_uq_tenant on public.unresolved_questions(tenant_id);
create index if not exists idx_kc_embedding on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Enable RLS
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks  enable row level security;
alter table public.unresolved_questions enable row level security;

-- RLS policies for knowledge_sources
drop policy if exists "ks-tenant-read" on public.knowledge_sources;
create policy "ks-tenant-read" on public.knowledge_sources for select
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active_tenant_id = knowledge_sources.tenant_id
));

drop policy if exists "ks-tenant-write" on public.knowledge_sources;
create policy "ks-tenant-write" on public.knowledge_sources for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = knowledge_sources.tenant_id))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = knowledge_sources.tenant_id));

-- RLS policies for knowledge_chunks
drop policy if exists "kc-tenant-read" on public.knowledge_chunks;
create policy "kc-tenant-read" on public.knowledge_chunks for select
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active_tenant_id = knowledge_chunks.tenant_id
));

drop policy if exists "kc-tenant-write" on public.knowledge_chunks;
create policy "kc-tenant-write" on public.knowledge_chunks for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = knowledge_chunks.tenant_id))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = knowledge_chunks.tenant_id));

-- RLS policies for unresolved_questions
drop policy if exists "uq-tenant-read" on public.unresolved_questions;
create policy "uq-tenant-read" on public.unresolved_questions for select
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active_tenant_id = unresolved_questions.tenant_id
));

drop policy if exists "uq-tenant-write" on public.unresolved_questions;
create policy "uq-tenant-write" on public.unresolved_questions for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = unresolved_questions.tenant_id))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active_tenant_id = unresolved_questions.tenant_id));

-- Helper: cosine similarity search (updated for 1536 dimensions)
create or replace function public.match_knowledge (
  p_tenant uuid,
  p_embedding vector(1536),
  p_match_count int default 8,
  p_min_cosine_similarity float default 0.15
) returns table(
  chunk_id uuid,
  source_id uuid,
  content text,
  score float
)
language sql stable as $$
  select kc.id, kc.source_id, kc.content,
         1 - (kc.embedding <=> p_embedding) as score
  from public.knowledge_chunks kc
  where kc.tenant_id = p_tenant
  order by kc.embedding <=> p_embedding
  limit p_match_count
$$;