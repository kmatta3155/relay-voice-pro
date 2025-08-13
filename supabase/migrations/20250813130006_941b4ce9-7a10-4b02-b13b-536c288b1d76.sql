-- Add billing columns to tenants table
ALTER TABLE public.tenants 
ADD COLUMN subscription_status TEXT,
ADD COLUMN price_id TEXT, 
ADD COLUMN stripe_customer_id TEXT;