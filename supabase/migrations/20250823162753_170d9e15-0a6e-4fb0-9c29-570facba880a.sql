-- Fix infinite recursion in tenant_users RLS policies
DROP POLICY IF EXISTS "tu_read" ON public.tenant_users;
DROP POLICY IF EXISTS "tu_update" ON public.tenant_users;
DROP POLICY IF EXISTS "tu_write" ON public.tenant_users;

-- Create new, simple policies for tenant_users that avoid recursion
CREATE POLICY "tenant_users_read_by_auth_user" 
ON public.tenant_users 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "tenant_users_read_by_tenant_member" 
ON public.tenant_users 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.memberships m 
  WHERE m.tenant_id = tenant_users.tenant_id 
  AND m.user_id = auth.uid()
  AND m.role IN ('OWNER', 'MANAGER')
));

CREATE POLICY "tenant_users_write_by_tenant_manager" 
ON public.tenant_users 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.memberships m 
  WHERE m.tenant_id = tenant_users.tenant_id 
  AND m.user_id = auth.uid()
  AND m.role IN ('OWNER', 'MANAGER')
));

CREATE POLICY "tenant_users_update_by_tenant_manager" 
ON public.tenant_users 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.memberships m 
  WHERE m.tenant_id = tenant_users.tenant_id 
  AND m.user_id = auth.uid()
  AND m.role IN ('OWNER', 'MANAGER')
));

-- Fix business_hours policies to use memberships instead of tenant_users
DROP POLICY IF EXISTS "bh_read" ON public.business_hours;
DROP POLICY IF EXISTS "bh_update" ON public.business_hours;
DROP POLICY IF EXISTS "bh_write" ON public.business_hours;

CREATE POLICY "business_hours_read_by_member" 
ON public.business_hours 
FOR SELECT 
USING (is_member(auth.uid(), tenant_id));

CREATE POLICY "business_hours_write_by_manager" 
ON public.business_hours 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

CREATE POLICY "business_hours_update_by_manager" 
ON public.business_hours 
FOR UPDATE 
USING (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

-- Fix services policies
DROP POLICY IF EXISTS "svc_read" ON public.services;
DROP POLICY IF EXISTS "svc_update" ON public.services;
DROP POLICY IF EXISTS "svc_write" ON public.services;

CREATE POLICY "services_read_by_member" 
ON public.services 
FOR SELECT 
USING (is_member(auth.uid(), tenant_id));

CREATE POLICY "services_write_by_manager" 
ON public.services 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

CREATE POLICY "services_update_by_manager" 
ON public.services 
FOR UPDATE 
USING (has_role(auth.uid(), tenant_id, 'MANAGER'::role));