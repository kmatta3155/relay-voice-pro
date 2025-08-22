-- Add missing columns to services table
ALTER TABLE public.services 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add missing column to business_hours table  
ALTER TABLE public.business_hours
ADD COLUMN IF NOT EXISTS is_closed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_services_tenant_name ON public.services(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_business_hours_tenant_dow ON public.business_hours(tenant_id, dow);