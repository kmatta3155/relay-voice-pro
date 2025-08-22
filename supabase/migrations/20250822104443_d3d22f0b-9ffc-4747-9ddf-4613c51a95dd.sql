
-- 1) Ensure we can upsert services by tenant and name
-- If duplicates exist, this will fail; if so, we’ll clean duplicates in a follow-up migration.
CREATE UNIQUE INDEX IF NOT EXISTS services_tenant_name_unique
  ON public.services (tenant_id, name);

-- 2) Ensure we don’t duplicate hours per day per tenant on repeated runs
CREATE UNIQUE INDEX IF NOT EXISTS business_hours_tenant_dow_unique
  ON public.business_hours (tenant_id, dow);
