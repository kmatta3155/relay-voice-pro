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
    // Handle incoming call webhook from Twilio
    if (req.method === 'POST') {
      const formData = await req.formData()
      const callSid = formData.get('CallSid') as string
      const from = formData.get('From') as string
      const to = formData.get('To') as string
      const tenantId = new URL(req.url).searchParams.get('tenant_id')

      console.log('Incoming call:', { callSid, from, to, tenantId })

      // Look up tenant by phone number if not provided
      let resolvedTenantId = tenantId
      if (!resolvedTenantId && to) {
        const { data } = await supabase
          .from('agent_settings')
          .select('tenant_id')
          .eq('twilio_number', to)
          .maybeSingle()
        
        resolvedTenantId = data?.tenant_id
      }

      if (!resolvedTenantId) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. This number is not currently configured. Goodbye.</Say>
  <Hangup/>
</Response>`;
        return new Response(twiml, {
          headers: { 'Content-Type': 'text/xml' }
        })
      }

      // Check if AI agent is ready
      const { data: agentData } = await supabase
        .from('ai_agents')
        .select('mode, status')
        .eq('tenant_id', resolvedTenantId)
        .eq('status', 'ready')
        .maybeSingle()

      if (!agentData || agentData.mode !== 'live') {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. We're currently unavailable. Please try again later.</Say>
  <Hangup/>
</Response>`;
        return new Response(twiml, {
          headers: { 'Content-Type': 'text/xml' }
        })
      }

      // Derive stream URL using functions/v1 path
      const streamUrl = `wss://${functionsDomain}/functions/v1/twilio-voice-stream?tenant_id=${resolvedTenantId}&call_sid=${callSid}`

      // Build the TwiML response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! You've reached our AI receptionist. Please hold while we connect you.</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    // Handle status callbacks and other GET requests
    return new Response(JSON.stringify({ status: 'Voice webhook ready' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Twilio voice webhook error:', error)
    
    // Return TwiML error response
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`;

    return new Response(errorTwiml, {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})