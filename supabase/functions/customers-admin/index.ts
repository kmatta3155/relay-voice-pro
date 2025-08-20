import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ListCmd = { action: 'list' };
type DetailsCmd = { action: 'details'; customerId: string };
type DeleteCmd = { action: 'delete'; tenantId: string };

type Cmd = ListCmd | DetailsCmd | DeleteCmd;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client tied to the caller for auth check
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  // Privileged client for admin operations
  const sb = createClient(url, service);

  try {
    const body = (await req.json()) as Cmd;

    // Verify site admin
    const { data: userRes } = await authClient.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) throw new Error('Unauthorized');

    const { data: profile } = await authClient
      .from('profiles')
      .select('is_site_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.is_site_admin) throw new Error('Admin only');

    if (body.action === 'list') {
      const { data, error } = await sb
        .from('tenants')
        .select('id, name, slug, created_at, subscription_status, stripe_customer_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, tenants: data }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    if (body.action === 'details') {
      const tid = body.tenantId;
      const [agent, branding, hours, services] = await Promise.all([
        sb.from('agent_settings').select('*').eq('tenant_id', tid).maybeSingle(),
        sb.from('tenant_branding').select('*').eq('tenant_id', tid).maybeSingle(),
        sb.from('business_hours').select('dow, open_time, close_time').eq('tenant_id', tid).order('dow'),
        sb.from('services').select('id, name, duration_minutes, price, active').eq('tenant_id', tid).order('name'),
      ]);

      if (agent.error) throw agent.error;
      if (branding.error) throw branding.error;
      if (hours.error) throw hours.error;
      if (services.error) throw services.error;

      return new Response(
        JSON.stringify({
          ok: true,
          agent: agent.data,
          branding: branding.data,
          hours: hours.data,
          services: services.data,
        }),
        { headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }

    if (body.action === 'delete') {
      const tid = body.tenantId;
      // Delete dependent data first (best-effort)
      const tables = [
        'appointments',
        'automations',
        'messages',
        'threads',
        'conversations',
        'calls',
        'services',
        'business_hours',
        'holidays',
        'subscriptions',
        'agent_settings',
        'tenant_branding',
        'business_quick_answers',
        'unresolved_questions',
        'knowledge_chunks',
        'knowledge_sources',
        'invites',
        'tenant_users',
        'memberships',
        'leads',
        'logs',
      ];

      for (const t of tables) {
        await sb.from(t).delete().eq('tenant_id', tid);
      }

      const { error: terr } = await sb.from('tenants').delete().eq('id', tid);
      if (terr) throw terr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('tenants-admin error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
