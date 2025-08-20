-- Rename all tenant-related tables and columns to customer
-- First, rename the main tables
ALTER TABLE tenants RENAME TO customers;
ALTER TABLE tenant_users RENAME TO customer_users;
ALTER TABLE tenant_members RENAME TO customer_members;
ALTER TABLE tenant_branding RENAME TO customer_branding;
ALTER TABLE tenant_invites RENAME TO customer_invites;

-- Rename columns in all affected tables
ALTER TABLE customers RENAME COLUMN id TO id;
ALTER TABLE customer_users RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_members RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_branding RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_invites RENAME COLUMN tenant_id TO customer_id;

-- Rename tenant_id columns in other tables
ALTER TABLE profiles RENAME COLUMN active_tenant_id TO active_customer_id;
ALTER TABLE agent_settings RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE appointments RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE automations RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE business_hours RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE business_quick_answers RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE calls RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE conversations RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE holidays RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE invites RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE knowledge_chunks RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE knowledge_sources RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE leads RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE logs RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE memberships RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE messages RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE security_audit_log RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE services RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE subscriptions RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE threads RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE unresolved_questions RENAME COLUMN tenant_id TO customer_id;

-- Update function names and parameters
DROP FUNCTION IF EXISTS public._is_active_tenant(uuid);
CREATE OR REPLACE FUNCTION public._is_active_customer(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active_customer_id = cid
  );
$function$;

DROP FUNCTION IF EXISTS public.is_member_of(uuid);
CREATE OR REPLACE FUNCTION public.is_member_of(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.customer_members m where m.customer_id = cid and m.user_id = auth.uid());
$function$;

DROP FUNCTION IF EXISTS public.validate_tenant_access(uuid);
CREATE OR REPLACE FUNCTION public.validate_customer_access(target_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE 
    WHEN auth.uid() IS NULL THEN false
    WHEN NOT EXISTS(
      SELECT 1 FROM public.memberships m 
      WHERE m.user_id = auth.uid() AND m.customer_id = target_customer_id
    ) THEN false
    WHEN NOT EXISTS(
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.active_customer_id = target_customer_id
    ) THEN false
    ELSE true
  END;
$function$;

DROP FUNCTION IF EXISTS public.search_knowledge_keywords(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.search_knowledge_keywords(p_customer uuid, p_query text, p_match_count integer DEFAULT 5)
RETURNS TABLE(chunk_id uuid, source_id uuid, content text, score double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT 
    kc.id as chunk_id,
    kc.source_id,
    kc.content,
    CASE 
      WHEN p_query ILIKE '%hour%' OR p_query ILIKE '%time%' OR p_query ILIKE '%open%' THEN
        CASE 
          WHEN kc.content ILIKE '%hour%' OR kc.content ILIKE '%open%' OR kc.content ILIKE '%close%' OR kc.content ILIKE '%am%' OR kc.content ILIKE '%pm%' THEN 0.9
          ELSE 0.3
        END
      WHEN p_query ILIKE '%price%' OR p_query ILIKE '%cost%' THEN
        CASE 
          WHEN kc.content ILIKE '%price%' OR kc.content ILIKE '%cost%' OR kc.content ILIKE '%$%' THEN 0.9
          ELSE 0.3
        END
      WHEN p_query ILIKE '%service%' OR p_query ILIKE '%treatment%' THEN
        CASE 
          WHEN kc.content ILIKE '%service%' OR kc.content ILIKE '%treatment%' THEN 0.9
          ELSE 0.3
        END
      ELSE 0.5
    END as score
  FROM public.knowledge_chunks kc
  WHERE kc.customer_id = p_customer
    AND (
      kc.content ILIKE '%' || p_query || '%'
      OR (p_query ILIKE '%hour%' AND (kc.content ILIKE '%hour%' OR kc.content ILIKE '%open%' OR kc.content ILIKE '%close%'))
      OR (p_query ILIKE '%price%' AND (kc.content ILIKE '%price%' OR kc.content ILIKE '%cost%' OR kc.content ILIKE '%$%'))
      OR (p_query ILIKE '%service%' AND (kc.content ILIKE '%service%' OR kc.content ILIKE '%treatment%'))
    )
  ORDER BY score DESC, length(kc.content) ASC
  LIMIT p_match_count;
$function$;

DROP FUNCTION IF EXISTS public.is_member(uuid, uuid);
CREATE OR REPLACE FUNCTION public.is_member(u uuid, c uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.memberships m where m.user_id = u and m.customer_id = c)
$function$;

DROP FUNCTION IF EXISTS public.has_role(uuid, uuid, role);
CREATE OR REPLACE FUNCTION public.has_role(u uuid, c uuid, min_role role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with r as (
    select role from public.memberships where user_id = u and customer_id = c limit 1
  )
  select case
    when (select role from r) is null then false
    when (select role from r) = 'OWNER'::public.role then true
    when (select role from r) = 'MANAGER'::public.role and min_role in ('MANAGER','AGENT','VIEWER') then true
    when (select role from r) = 'AGENT'::public.role and min_role in ('AGENT','VIEWER') then true
    when (select role from r) = 'VIEWER'::public.role and min_role in ('VIEWER') then true
    else false
  end;
$function$;

DROP FUNCTION IF EXISTS public.match_knowledge(uuid, vector, integer, double precision);
CREATE OR REPLACE FUNCTION public.match_knowledge(p_customer uuid, p_embedding vector, p_match_count integer DEFAULT 8, p_min_cosine_similarity double precision DEFAULT 0.15)
RETURNS TABLE(chunk_id uuid, source_id uuid, content text, score double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT 
    kc.id,
    kc.source_id,
    kc.content,
    1 - (kc.embedding <=> p_embedding) as score
  FROM public.knowledge_chunks kc
  WHERE kc.customer_id = p_customer
  ORDER BY kc.embedding <=> p_embedding
  LIMIT p_match_count;
$function$;

DROP FUNCTION IF EXISTS public.get_quick_answer(uuid, text);
CREATE OR REPLACE FUNCTION public.get_quick_answer(p_customer uuid, p_query text)
RETURNS TABLE(answer text, confidence double precision, question_type text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT 
    qa.answer,
    qa.confidence,
    qa.question_type
  FROM public.business_quick_answers qa
  WHERE qa.customer_id = p_customer
    AND p_query ~* qa.question_pattern
  ORDER BY qa.confidence DESC
  LIMIT 1;
$function$;