-- Fix security issues identified in the scan

-- 1. Fix function search path mutable issues by setting proper search_path
-- Update existing functions to have secure search_path

CREATE OR REPLACE FUNCTION public.is_member(u uuid, t uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.memberships m where m.user_id = u and m.tenant_id = t)
$function$;

CREATE OR REPLACE FUNCTION public.has_role(u uuid, t uuid, min_role role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._is_active_tenant(tid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active_tenant_id = tid
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_member_of(tid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.tenant_members m where m.tenant_id = tid and m.user_id = auth.uid());
$function$;

-- 2. Strengthen RLS policies for sensitive data access
-- Ensure leads table has the most restrictive policies
DROP POLICY IF EXISTS "leads_select_active_member" ON public.leads;
CREATE POLICY "leads_select_active_member" ON public.leads
  FOR SELECT 
  USING (
    auth.uid() IS NOT NULL 
    AND is_member(auth.uid(), tenant_id) 
    AND _is_active_tenant(tenant_id)
  );

-- Ensure calls table has proper tenant isolation
DROP POLICY IF EXISTS "calls_select" ON public.calls;
CREATE POLICY "calls_select" ON public.calls
  FOR SELECT 
  USING (
    auth.uid() IS NOT NULL 
    AND is_member(auth.uid(), tenant_id) 
    AND _is_active_tenant(tenant_id)
  );

-- Ensure messages table has proper tenant isolation  
DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT 
  USING (
    auth.uid() IS NOT NULL 
    AND is_member(auth.uid(), tenant_id) 
    AND _is_active_tenant(tenant_id)
  );

-- 3. Add audit logging for sensitive data access
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  tenant_id uuid REFERENCES public.tenants(id),
  table_name text NOT NULL,
  action text NOT NULL,
  accessed_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only allow viewing own audit logs
CREATE POLICY "audit_log_self_read" ON public.security_audit_log
  FOR SELECT 
  USING (auth.uid() = user_id);

-- 4. Create function to validate tenant membership for all sensitive operations
CREATE OR REPLACE FUNCTION public.validate_tenant_access(target_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE 
    WHEN auth.uid() IS NULL THEN false
    WHEN NOT EXISTS(
      SELECT 1 FROM public.memberships m 
      WHERE m.user_id = auth.uid() AND m.tenant_id = target_tenant_id
    ) THEN false
    WHEN NOT EXISTS(
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.active_tenant_id = target_tenant_id
    ) THEN false
    ELSE true
  END;
$function$;