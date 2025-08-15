-- Add metadata support and keyword search function for enhanced knowledge management

-- Add metadata column to knowledge_chunks if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'knowledge_chunks' AND column_name = 'meta') THEN
        ALTER TABLE public.knowledge_chunks ADD COLUMN meta jsonb DEFAULT '{}';
    END IF;
END $$;

-- Create keyword search function for business queries
CREATE OR REPLACE FUNCTION public.search_knowledge_keywords(
  p_tenant uuid,
  p_query text,
  p_match_count integer DEFAULT 5
)
RETURNS TABLE(chunk_id uuid, source_id uuid, content text, score double precision)
LANGUAGE sql
STABLE
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

-- Create fast lookup table for common business queries
CREATE TABLE IF NOT EXISTS public.business_quick_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  question_type text NOT NULL, -- 'hours', 'pricing', 'services', 'contact', 'location'
  question_pattern text NOT NULL, -- regex pattern for matching questions
  answer text NOT NULL,
  confidence double precision DEFAULT 0.9,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS for quick answers
ALTER TABLE public.business_quick_answers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for quick answers
CREATE POLICY "quick_answers_tenant_read" ON public.business_quick_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = business_quick_answers.tenant_id
    )
  );

CREATE POLICY "quick_answers_tenant_write" ON public.business_quick_answers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = business_quick_answers.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = business_quick_answers.tenant_id
    )
  );

-- Create function to get quick answers
CREATE OR REPLACE FUNCTION public.get_quick_answer(
  p_tenant uuid,
  p_query text
)
RETURNS TABLE(answer text, confidence double precision, question_type text)
LANGUAGE sql
STABLE
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_meta ON public.knowledge_chunks USING gin(meta);
CREATE INDEX IF NOT EXISTS idx_quick_answers_tenant ON public.business_quick_answers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quick_answers_type ON public.business_quick_answers(question_type);