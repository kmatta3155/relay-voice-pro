-- Fix the last remaining function search path issue
CREATE OR REPLACE FUNCTION public.purge_old()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.calls where at < now() - interval '90 days';
end$function$;

-- The extension in public warning is for the vector extension which is required
-- for the knowledge base functionality and is safe to keep in public schema
-- as it's a standard practice for pgvector extension