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
const functionsDomain = `${projectRef}.functions.supabase.co`;

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

    // Check agent status
    const { data: agentData } = await supabase
      .from('ai_agents')
      .select('mode, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .maybeSingle();
    if (!agentData || agentData.mode !== 'live') {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. We're currently unavailable. Please try again later.</Say><Hangup/></Response>`;
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // Look up business name (optional)
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();
    const businessName = tenantData?.name || 'this business';

    // Log call
    await supabase.from('calls').insert({
      tenant_id: tenantId,
      from: from,
      to: to,
      at: new Date().toISOString(),
      outcome: 'incoming',
    });

    const streamUrl = `wss://${functionsDomain}/functions/v1/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`;
    const xmlUrl    = xmlEscape(streamUrl);

const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlUrl}">
      <Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>
      <Parameter name="businessName" value="${xmlEscape(businessName)}"/>
      <Parameter name="phoneNumber" value="${xmlEscape(from || '')}"/>
    </Stream>
  </Connect>
</Response>`;
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
  } catch (err) {
    console.error('router error:', err);
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say><Hangup/></Response>`;
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }
});