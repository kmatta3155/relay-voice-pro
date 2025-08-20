-- Fix remaining function search path mutable issues

-- Update all remaining functions that need secure search_path
CREATE OR REPLACE FUNCTION public.match_knowledge(p_tenant uuid, p_embedding vector, p_match_count integer DEFAULT 8, p_min_cosine_similarity double precision DEFAULT 0.15)
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
  WHERE kc.tenant_id = p_tenant
  ORDER BY kc.embedding <=> p_embedding
  LIMIT p_match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_knowledge_keywords(p_tenant uuid, p_query text, p_match_count integer DEFAULT 5)
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
  WHERE kc.tenant_id = p_tenant
    AND (
      kc.content ILIKE '%' || p_query || '%'
      OR (p_query ILIKE '%hour%' AND (kc.content ILIKE '%hour%' OR kc.content ILIKE '%open%' OR kc.content ILIKE '%close%'))
      OR (p_query ILIKE '%price%' AND (kc.content ILIKE '%price%' OR kc.content ILIKE '%cost%' OR kc.content ILIKE '%$%'))
      OR (p_query ILIKE '%service%' AND (kc.content ILIKE '%service%' OR kc.content ILIKE '%treatment%'))
    )
  ORDER BY score DESC, length(kc.content) ASC
  LIMIT p_match_count;
$function$;

CREATE OR REPLACE FUNCTION public.get_quick_answer(p_tenant uuid, p_query text)
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
  WHERE qa.tenant_id = p_tenant
    AND p_query ~* qa.question_pattern
  ORDER BY qa.confidence DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_kpis()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  refresh materialized view public.mv_kpis_7d;
$function$;