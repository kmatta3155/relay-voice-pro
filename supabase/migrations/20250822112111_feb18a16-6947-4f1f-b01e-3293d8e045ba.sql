-- Ensure idempotent unique indexes for upserts
CREATE UNIQUE INDEX IF NOT EXISTS services_tenant_name_unique
  ON public.services (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS business_hours_tenant_dow_unique
  ON public.business_hours (tenant_id, dow);