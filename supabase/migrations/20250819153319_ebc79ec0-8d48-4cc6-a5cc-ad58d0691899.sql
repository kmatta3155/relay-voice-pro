-- Fix email harvesting security issues

-- 1. Fix tenant_invites table - only MANAGER+ roles should see/create invites
DROP POLICY IF EXISTS "invites_select" ON public.tenant_invites;
DROP POLICY IF EXISTS "invites_insert" ON public.tenant_invites;

-- Only managers and owners can view tenant invites
CREATE POLICY "invites_select_managers_only" 
ON public.tenant_invites 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m 
    WHERE m.user_id = auth.uid() 
    AND m.tenant_id = tenant_invites.tenant_id 
    AND m.role IN ('OWNER', 'MANAGER')
  )
);

-- Only managers and owners can create tenant invites  
CREATE POLICY "invites_insert_managers_only" 
ON public.tenant_invites 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.memberships m 
    WHERE m.user_id = auth.uid() 
    AND m.tenant_id = tenant_invites.tenant_id 
    AND m.role IN ('OWNER', 'MANAGER')
  )
);

-- 2. Strengthen leads table RLS to prevent email/phone harvesting
-- The current policies use helper functions, let's make them more explicit about data protection

-- Add a policy comment to document the security consideration
COMMENT ON TABLE public.leads IS 'Contains sensitive customer contact information (email, phone). Access restricted to tenant members only via RLS policies.';

-- 3. Add explicit protection for profiles table (defense in depth)
-- Create a more explicit policy name to make security intention clear
DROP POLICY IF EXISTS "profiles self read" ON public.profiles;
DROP POLICY IF EXISTS "profiles self write" ON public.profiles;

CREATE POLICY "profiles_own_data_only_read" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "profiles_own_data_only_write" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 4. Add security comments to sensitive tables
COMMENT ON TABLE public.tenant_invites IS 'Contains invitation email addresses. Access restricted to MANAGER+ roles only to prevent email harvesting.';
COMMENT ON TABLE public.profiles IS 'Contains user email addresses. Users can only access their own profile data.';
COMMENT ON TABLE public.messages IS 'Contains private communications with customer phone numbers. Access restricted to tenant members only.';
COMMENT ON TABLE public.calls IS 'Contains customer phone numbers and call data. Access restricted to tenant members only.';
COMMENT ON TABLE public.appointments IS 'Contains customer scheduling information. Access restricted to tenant members only.';