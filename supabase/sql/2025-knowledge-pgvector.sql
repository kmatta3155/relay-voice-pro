-- Knowledge Management System with pgvector
-- To be run in Supabase SQL Editor

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_sources table (if not exists)
CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'web',
  title TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create knowledge_chunks table (if not exists)
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_id UUID,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unresolved_questions table (if not exists)
CREATE TABLE IF NOT EXISTS public.unresolved_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  question TEXT NOT NULL,
  call_id TEXT,
  asked_by UUID,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unresolved_questions ENABLE ROW LEVEL SECURITY;

-- RLS policies for knowledge_sources
DROP POLICY IF EXISTS "ks-tenant-read" ON public.knowledge_sources;
CREATE POLICY "ks-tenant-read" ON public.knowledge_sources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_sources.tenant_id
    )
  );

DROP POLICY IF EXISTS "ks-tenant-write" ON public.knowledge_sources;
CREATE POLICY "ks-tenant-write" ON public.knowledge_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_sources.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_sources.tenant_id
    )
  );

-- RLS policies for knowledge_chunks
DROP POLICY IF EXISTS "kc-tenant-read" ON public.knowledge_chunks;
CREATE POLICY "kc-tenant-read" ON public.knowledge_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_chunks.tenant_id
    )
  );

DROP POLICY IF EXISTS "kc-tenant-write" ON public.knowledge_chunks;
CREATE POLICY "kc-tenant-write" ON public.knowledge_chunks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_chunks.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = knowledge_chunks.tenant_id
    )
  );

-- RLS policies for unresolved_questions
DROP POLICY IF EXISTS "uq-tenant-read" ON public.unresolved_questions;
CREATE POLICY "uq-tenant-read" ON public.unresolved_questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = unresolved_questions.tenant_id
    )
  );

DROP POLICY IF EXISTS "uq-tenant-write" ON public.unresolved_questions;
CREATE POLICY "uq-tenant-write" ON public.unresolved_questions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = unresolved_questions.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = unresolved_questions.tenant_id
    )
  );

-- Create the vector similarity search function
CREATE OR REPLACE FUNCTION match_knowledge(
  p_tenant UUID,
  p_embedding vector(1536),
  p_match_count INT DEFAULT 8,
  p_min_cosine_similarity FLOAT DEFAULT 0.15
)
RETURNS TABLE (
  chunk_id UUID,
  source_id UUID,
  content TEXT,
  score FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    kc.id,
    kc.source_id,
    kc.content,
    1 - (kc.embedding <=> p_embedding) as score
  FROM public.knowledge_chunks kc
  WHERE kc.tenant_id = p_tenant
  ORDER BY kc.embedding <=> p_embedding
  LIMIT p_match_count;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_id_idx ON public.knowledge_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_tenant_id_idx ON public.knowledge_sources(tenant_id);
CREATE INDEX IF NOT EXISTS unresolved_questions_tenant_id_idx ON public.unresolved_questions(tenant_id);

-- Create vector index for similarity search (HNSW for better performance)
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON public.knowledge_chunks 
USING hnsw (embedding vector_cosine_ops);