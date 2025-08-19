-- Tighten RLS on public.leads to prevent customer contact data leakage
-- Ensure only members of the tenant AND with that tenant active can access rows

-- Drop existing policies to avoid permissive OR combinations
DROP POLICY IF EXISTS "leads_select" ON public.leads;
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_delete" ON public.leads;
DROP POLICY IF EXISTS "leads_tenant_select" ON public.leads;
DROP POLICY IF EXISTS "leads_tenant_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_tenant_update" ON public.leads;

-- Recreate strict policies
CREATE POLICY "leads_select_active_member"
ON public.leads
FOR SELECT
USING (
  is_member(auth.uid(), tenant_id) AND _is_active_tenant(tenant_id)
);

CREATE POLICY "leads_insert_active_member"
ON public.leads
FOR INSERT
WITH CHECK (
  is_member(auth.uid(), tenant_id) AND _is_active_tenant(tenant_id)
);

CREATE POLICY "leads_update_active_member"
ON public.leads
FOR UPDATE
USING (
  is_member(auth.uid(), tenant_id) AND _is_active_tenant(tenant_id)
)
WITH CHECK (
  is_member(auth.uid(), tenant_id) AND _is_active_tenant(tenant_id)
);

CREATE POLICY "leads_delete_active_manager"
ON public.leads
FOR DELETE
USING (
  has_role(auth.uid(), tenant_id, 'MANAGER'::role) AND _is_active_tenant(tenant_id)
);

-- Document sensitive nature
COMMENT ON TABLE public.leads IS 'Contains sensitive customer contact info (emails, phones). RLS requires tenant membership and active tenant.';