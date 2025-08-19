-- Clean up and fix leads table RLS policies for proper security
-- Remove old overlapping policies
DROP POLICY IF EXISTS "leads active tenant del" ON public.leads;
DROP POLICY IF EXISTS "leads active tenant ro" ON public.leads;
DROP POLICY IF EXISTS "leads active tenant upd" ON public.leads;
DROP POLICY IF EXISTS "leads active tenant wr" ON public.leads;
DROP POLICY IF EXISTS "leads del" ON public.leads;
DROP POLICY IF EXISTS "leads ins" ON public.leads;
DROP POLICY IF EXISTS "leads ro" ON public.leads;
DROP POLICY IF EXISTS "leads upd" ON public.leads;

-- Create secure, non-overlapping policies for leads table
-- Only allow tenant members to select leads for their tenant
CREATE POLICY "leads_tenant_select" ON public.leads
FOR SELECT 
USING (is_member(auth.uid(), tenant_id));

-- Only allow tenant members to insert leads for their tenant
CREATE POLICY "leads_tenant_insert" ON public.leads
FOR INSERT 
WITH CHECK (is_member(auth.uid(), tenant_id));

-- Only allow tenant members to update leads for their tenant
CREATE POLICY "leads_tenant_update" ON public.leads
FOR UPDATE 
USING (is_member(auth.uid(), tenant_id))
WITH CHECK (is_member(auth.uid(), tenant_id));

-- Only allow managers and owners to delete leads
-- Keep the existing delete policy as it's properly restrictive