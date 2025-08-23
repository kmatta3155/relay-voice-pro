-- Fix RLS policies for agent_settings table to use correct helper functions
DROP POLICY IF EXISTS "agent_read" ON agent_settings;
DROP POLICY IF EXISTS "agent_update" ON agent_settings;
DROP POLICY IF EXISTS "agent_write" ON agent_settings;

-- Create new RLS policies using the correct helper functions
CREATE POLICY "agent_settings_select" ON agent_settings
FOR SELECT USING (is_member(auth.uid(), tenant_id));

CREATE POLICY "agent_settings_insert" ON agent_settings
FOR INSERT WITH CHECK (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

CREATE POLICY "agent_settings_update" ON agent_settings
FOR UPDATE USING (has_role(auth.uid(), tenant_id, 'MANAGER'::role))
WITH CHECK (has_role(auth.uid(), tenant_id, 'MANAGER'::role));

CREATE POLICY "agent_settings_delete" ON agent_settings
FOR DELETE USING (has_role(auth.uid(), tenant_id, 'MANAGER'::role));