import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];

// Helper to escape XML attribute values
function xmlEscape(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const form = await req.formData();
    const to = form.get('To') as string;
    const from = form.get('From') as string;
    const callSid = form.get('CallSid') as string;

    const { data: tenant, error: tenantError } = await supabase
      .from('numbers')
      .select('tenant_id, tenants(name, id)')
      .eq('phone_number', to)
      .single();
    if (tenantError || !tenant) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not configured. Goodbye.</Say><Hangup/></Response>`;
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }
    const tenantId = tenant.tenant_id;
    const businessName = (tenant.tenants as { name: string })?.name || 'this business';

    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('status, mode')
      .eq('tenant_id', tenantId)
      .single();
    if (agentError) {
      console.error(`[ROUTER] Error fetching agent for tenant ${tenantId}:`, agentError);
    }

    await supabase.from('calls').insert({
      tenant_id: tenantId,
      from: from,
      to: to,
      at: new Date().toISOString(),
      outcome: 'incoming',
    });
    let twiml = '';
    if (Deno.env.get('DEBUG_FORCE_STREAM') === 'true' || (agentData && agentData.mode === 'live' && agentData.status === 'ready')) {
      const streamUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! You’re connected to ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Connect>
    <Stream url="${xmlEscape(streamUrl)}">
      <Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>
      <Parameter name="businessName" value="${xmlEscape(businessName)}"/>
      <Parameter name="phoneNumber" value="${xmlEscape(from || '')}"/>
    </Stream>
  </Connect>
</Response>`;
    } else {
      const intentUrl = `https://${projectRef}.supabase.co/functions/v1/handle-intent?tenant_id=${xmlEscape(tenantId)}&business_name=${encodeURIComponent(businessName)}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! I’m the AI receptionist for ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Gather input="speech" language="en-US" speechTimeout="auto" method="POST" action="${xmlEscape(intentUrl)}">
    <Say>I’m listening…</Say>
  </Gather>
</Response>`;
    }
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
  } catch (err) {
    console.error('[ROUTER] Top-level error:', err);
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an unexpected error occurred. Please try again later.</Say><Hangup/></Response>`;
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }
});