import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
      const callSid = formData.get('CallSid')
      const from = formData.get('From')
      const to = formData.get('To')
      const tenantId = new URL(req.url).searchParams.get('tenant_id')

      console.log('Incoming call:', { callSid, from, to, tenantId })

      // Generate TwiML response to connect call to AI receptionist
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! You've reached our AI receptionist. Please hold while we connect you.</Say>
  <Connect>
    <Stream url="wss://${functionsDomain}/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}" />
  </Connect>
</Response>`

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
</Response>`

    return new Response(errorTwiml, {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})