import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Derive project ref and functions domain from environment
const supabaseUrl = Deno.env.get('SUPABASE_URL')! // e.g. https://abcd1234.supabase.co
const projectRef = new URL(supabaseUrl).hostname.split('.')[0] // abcd1234
const functionsDomain = `${projectRef}.functions.supabase.co`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('=== TWILIO ROUTER DEBUG START ===');
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    // Parse Twilio params from POST form or GET query
    const contentType = req.headers.get('content-type') || ''
    console.log('Content-Type:', contentType);
    
    let callSid: string | null = null
    let from: string | null = null
    let to: string | null = null

    if (req.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      console.log('FormData entries:', Array.from(formData.entries()));
      callSid = (formData.get('CallSid') as string) || null
      from = (formData.get('From') as string) || null
      to = (formData.get('To') as string) || null
    } else {
      const urlParams = new URL(req.url).searchParams
      console.log('URL params:', Object.fromEntries(urlParams.entries()));
      callSid = urlParams.get('CallSid')
      from = urlParams.get('From')
      to = urlParams.get('To')
    }
    
    console.log('Parsed call details:', { callSid, from, to })

    // Get tenant_id from query params or lookup by phone number
    const url = new URL(req.url)
    let tenantId = url.searchParams.get('tenant_id')
    console.log('Initial tenant_id from params:', tenantId);
    
    if (!tenantId && to) {
      console.log('Looking up tenant by phone number:', to);
      // Look up tenant by phone number
      const { data, error } = await supabase
        .from('agent_settings')
        .select('tenant_id')
        .eq('twilio_number', to)
        .maybeSingle()
      
      console.log('Agent settings lookup result:', { data, error });
      
      if (error) {
        console.error('Error looking up tenant by phone number:', error)
      }
      
      tenantId = data?.tenant_id
      console.log('Found tenant_id:', tenantId);
    }

    if (!tenantId) {
      console.error('=== NO TENANT FOUND ===');
      console.error('Phone number searched:', to);
      console.error('Returning fallback TwiML');
      // Return proper fallback TwiML with Response root
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. This number is not currently configured. Goodbye.</Say>
  <Hangup/>
</Response>`
      console.log('Fallback TwiML:', twiml);
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    console.log('Found tenant_id:', tenantId, 'Looking up agent...');

    // Check if AI agent is in live mode
    const { data: agentData, error: agentError } = await supabase
      .from('ai_agents')
      .select('mode, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .maybeSingle()

    console.log('Agent lookup result:', { agentData, agentError });

    if (agentError || !agentData) {
      console.log('No ready agent found or agent error:', agentError)
      console.log('Agent lookup for tenant:', tenantId)
      // If no agent in live mode, just hang up politely
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. We're currently unavailable. Please try again later.</Say>
  <Hangup/>
</Response>`
      
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    console.log('Agent found:', agentData)

    // Only proceed if agent is in live mode
    if (agentData.mode !== 'live') {
      console.log('Agent is in simulation mode, not handling live calls. Mode:', agentData.mode)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. We're currently unavailable. Please try again later.</Say>
  <Hangup/>
</Response>`
      
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    console.log('Proceeding with live agent connection. Agent mode:', agentData.mode)

    // Log the call
    await supabase
      .from('calls')
      .insert({
        tenant_id: tenantId,
        from: from,
        to: to,
        at: new Date().toISOString(),
        outcome: 'incoming'
      })

    // Derive stream URL using functions/v1 path
    const streamUrl = `wss://${functionsDomain}/functions/v1/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`
    console.log('Stream URL:', streamUrl);

    // Build streaming TwiML that connects the call to the WebSocket stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to your AI receptionist.</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`

    console.log('=== STREAMING TwiML ===');
    console.log('TwiML length:', twiml.length);
    console.log('TwiML content:', twiml);
    console.log('=== END DEBUG ===');

    // Return the TwiML
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })

  } catch (error) {
    console.error('Twilio router error:', error)
    
    // Return error TwiML
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`

    return new Response(errorTwiml, {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})