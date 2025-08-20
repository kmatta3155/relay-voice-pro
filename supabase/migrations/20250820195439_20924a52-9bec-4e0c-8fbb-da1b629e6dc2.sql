-- Check if tables exist and rename only what hasn't been renamed yet
DO $$
BEGIN
    -- Rename main tables if they still exist with old names
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' AND table_schema = 'public') THEN
        ALTER TABLE tenants RENAME TO customers;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_users' AND table_schema = 'public') THEN
        ALTER TABLE tenant_users RENAME TO customer_users;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_members' AND table_schema = 'public') THEN
        ALTER TABLE tenant_members RENAME TO customer_members;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_branding' AND table_schema = 'public') THEN
        ALTER TABLE tenant_branding RENAME TO customer_branding;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_invites' AND table_schema = 'public') THEN
        ALTER TABLE tenant_invites RENAME TO customer_invites;
    END IF;

    -- Rename columns if they still have old names
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_users' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE customer_users RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_members' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE customer_members RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_branding' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE customer_branding RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_invites' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE customer_invites RENAME COLUMN tenant_id TO customer_id;
    END IF;

    -- Rename tenant_id columns in other tables
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'active_tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE profiles RENAME COLUMN active_tenant_id TO active_customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_settings' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE agent_settings RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE appointments RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'automations' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE automations RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'business_hours' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE business_hours RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'business_quick_answers' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE business_quick_answers RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE calls RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE conversations RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'holidays' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE holidays RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invites' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE invites RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_chunks' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE knowledge_chunks RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE knowledge_sources RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE leads RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'logs' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE logs RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memberships' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE memberships RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE messages RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_audit_log' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE security_audit_log RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE services RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE subscriptions RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'threads' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE threads RENAME COLUMN tenant_id TO customer_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'unresolved_questions' AND column_name = 'tenant_id' AND table_schema = 'public') THEN
        ALTER TABLE unresolved_questions RENAME COLUMN tenant_id TO customer_id;
    END IF;

END $$;