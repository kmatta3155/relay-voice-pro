import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

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
// Public functions URL format: https://gnqqktmslswgjtvxfvdo.supabase.co/functions/v1/
const functionsBaseUrl = `https://${projectRef}.supabase.co/functions/v1`;

// Helper to escape XML attribute values
function xmlEscape(value: string): string {
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
  const contentType = req.headers.get('content-type') || '';
  let callSid: string | null = null;
  let from   : string | null = null;
  let to     : string | null = null;
  let agentData: any = null;

    // Parse Twilio parameters
    if (req.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      callSid = (formData.get('CallSid') as string) || null;
      from    = (formData.get('From') as string)   || null;
      to      = (formData.get('To') as string)     || null;
    } else {
      const urlParams = new URL(req.url).searchParams;
      callSid = urlParams.get('CallSid');
      from    = urlParams.get('From');
      to      = urlParams.get('To');
    }

    // Look up tenant_id by phone number if not provided
    const url        = new URL(req.url);
    let tenantId     = url.searchParams.get('tenant_id');
    if (!tenantId && to) {
      const { data } = await supabase
        .from('agent_settings')
        .select('tenant_id')
        .eq('twilio_number', to)
        .maybeSingle();
      tenantId = data?.tenant_id || null;
    }
    if (!tenantId) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. This number is not currently configured. Goodbye.</Say><Hangup/></Response>`;
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // Check agent status (with debug bypass)
    const debugForceStream = Deno.env.get('DEBUG_FORCE_STREAM') === 'true';
    if (!debugForceStream) {
      const agentRes = await supabase
        .from('ai_agents')
        .select('mode, status')
        .eq('tenant_id', tenantId)
        .eq('status', 'ready')
        .maybeSingle();
      agentData = agentRes.data;
      if (!agentData || agentData.mode !== 'live') {
        console.log(`[ROUTER] Agent not ready - status: ${agentData?.status}, mode: ${agentData?.mode}`);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. We're currently unavailable. Please try again later.</Say><Hangup/></Response>`;
        return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
      }
    } else {
      console.log('[DEBUG] Bypassing agent status check due to DEBUG_FORCE_STREAM=true');
    }

    // Look up business name (optional)
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();
    const businessName = tenantData?.name || 'this business';

    // Detailed call logging
    console.log(`[ROUTER] Incoming call - From: ${from}, To: ${to}, CallSid: ${callSid}, TenantId: ${tenantId}, Business: ${businessName}`);
    
    // Log call
    await supabase.from('calls').insert({
      tenant_id: tenantId,
      from: from,
      to: to,
      at: new Date().toISOString(),
      outcome: 'incoming',
    });

    // Generate TwiML with Say/Gather loop for reliable audio
    const streamBaseUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream`;
    const phoneNumber = to || '';
    let twiml = '';
    if (Deno.env.get('DEBUG_FORCE_STREAM') === 'true' || (agentData && agentData.mode === 'live' && agentData.status === 'ready')) {
      // Streaming mode: <Say> greeting, then <Connect><Stream> with valid XML escaping, no blank lines before <?xml
      const streamUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream?tenant_id=${xmlEscape(tenantId)}&call_sid=${xmlEscape(callSid)}`;
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
      // Fallback: <Say>/<Gather>
      const intentUrl = `https://${projectRef}.supabase.co/functions/v1/handle-intent?tenant_id=${xmlEscape(tenantId)}&business_name=${encodeURIComponent(businessName)}`;
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! I’m the AI receptionist for ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Gather input="speech" language="en-US" speechTimeout="auto" action="${xmlEscape(intentUrl)}" method="POST">
    <Say>I’m listening…</Say>
  </Gather>
</Response>`;
    }
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
  } catch (err) {
    console.error('router error:', err);
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say><Hangup/></Response>`;
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }
});