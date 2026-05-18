-- Admin Onboarding: data model - simplified version

CREATE TABLE IF NOT EXISTS public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url text,
  brand_color text DEFAULT '#6d28d9',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,
  price numeric,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_hours (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dow int NOT NULL CHECK (dow BETWEEN 0 AND 6),
  open_time time NOT NULL,
  close_time time NOT NULL,
  PRIMARY KEY (tenant_id, dow)
);

CREATE TABLE IF NOT EXISTS public.holidays (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  name text,
  PRIMARY KEY (tenant_id, day)
);

CREATE TABLE IF NOT EXISTS public.tenant_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','manager','staff')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','manager','staff')),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Create agent_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.agent_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  twilio_number text,
  forward_number text,
  after_hours_voicemail boolean DEFAULT true,
  greeting text,
  website_url text,
  ai_sms_autoreplies boolean DEFAULT false,
  agent_ws_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS t_brand_read ON tenant_branding;
CREATE POLICY t_brand_read ON tenant_branding
  FOR SELECT USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = tenant_branding.tenant_id AND tu.user_id = auth.uid()));
DROP POLICY IF EXISTS t_brand_write ON tenant_branding;
CREATE POLICY t_brand_write ON tenant_branding
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = tenant_branding.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));
DROP POLICY IF EXISTS t_brand_update ON tenant_branding;
CREATE POLICY t_brand_update ON tenant_branding
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = tenant_branding.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));

DROP POLICY IF EXISTS svc_read ON services;
CREATE POLICY svc_read ON services
  FOR SELECT USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = services.tenant_id AND tu.user_id = auth.uid()));
DROP POLICY IF EXISTS svc_write ON services;
CREATE POLICY svc_write ON services
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = services.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));
DROP POLICY IF EXISTS svc_update ON services;
CREATE POLICY svc_update ON services
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = services.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));

DROP POLICY IF EXISTS bh_read ON business_hours;
CREATE POLICY bh_read ON business_hours
  FOR SELECT USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = business_hours.tenant_id AND tu.user_id = auth.uid()));
DROP POLICY IF EXISTS bh_write ON business_hours;
CREATE POLICY bh_write ON business_hours
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = business_hours.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));
DROP POLICY IF EXISTS bh_update ON business_hours;
CREATE POLICY bh_update ON business_hours
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = business_hours.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));

DROP POLICY IF EXISTS hd_read ON holidays;
CREATE POLICY hd_read ON holidays
  FOR SELECT USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = holidays.tenant_id AND tu.user_id = auth.uid()));
DROP POLICY IF EXISTS hd_write ON holidays;
CREATE POLICY hd_write ON holidays
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = holidays.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));
DROP POLICY IF EXISTS hd_update ON holidays;
CREATE POLICY hd_update ON holidays
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = holidays.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));

DROP POLICY IF EXISTS tu_read ON tenant_users;
CREATE POLICY tu_read ON tenant_users 
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS tu_write ON tenant_users;
CREATE POLICY tu_write ON tenant_users 
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = tenant_users.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin')));
DROP POLICY IF EXISTS tu_update ON tenant_users;
CREATE POLICY tu_update ON tenant_users 
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = tenant_users.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin')));

DROP POLICY IF EXISTS inv_read ON invites;
CREATE POLICY inv_read ON invites 
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS inv_write ON invites;
CREATE POLICY inv_write ON invites 
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = invites.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin')));
DROP POLICY IF EXISTS inv_update ON invites;
CREATE POLICY inv_update ON invites 
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = invites.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin')));

DROP POLICY IF EXISTS agent_read ON agent_settings;
CREATE POLICY agent_read ON agent_settings
  FOR SELECT USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = agent_settings.tenant_id AND tu.user_id = auth.uid()));
DROP POLICY IF EXISTS agent_write ON agent_settings;
CREATE POLICY agent_write ON agent_settings
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = agent_settings.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));
DROP POLICY IF EXISTS agent_update ON agent_settings;
CREATE POLICY agent_update ON agent_settings
  FOR UPDATE USING (EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = agent_settings.tenant_id AND tu.user_id = auth.uid() AND tu.role IN ('owner','admin','manager')));