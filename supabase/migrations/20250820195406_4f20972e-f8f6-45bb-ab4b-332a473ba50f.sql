-- Rename all tenant-related tables and columns to customer
-- First, rename the main tables
ALTER TABLE tenants RENAME TO customers;
ALTER TABLE tenant_users RENAME TO customer_users;
ALTER TABLE tenant_members RENAME TO customer_members;
ALTER TABLE tenant_branding RENAME TO customer_branding;
ALTER TABLE tenant_invites RENAME TO customer_invites;

-- Rename tenant_id columns in all affected tables
ALTER TABLE customer_users RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_members RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_branding RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE customer_invites RENAME COLUMN tenant_id TO customer_id;

-- Rename tenant_id columns in other tables
ALTER TABLE profiles RENAME COLUMN active_tenant_id TO active_customer_id;
ALTER TABLE agent_settings RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE appointments RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE automations RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE business_hours RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE business_quick_answers RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE calls RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE conversations RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE holidays RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE invites RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE knowledge_chunks RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE knowledge_sources RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE leads RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE logs RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE memberships RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE messages RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE security_audit_log RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE services RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE subscriptions RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE threads RENAME COLUMN tenant_id TO customer_id;
ALTER TABLE unresolved_questions RENAME COLUMN tenant_id TO customer_id;