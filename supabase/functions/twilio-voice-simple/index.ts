import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

      // Just answer with a simple message for now - no streaming
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello! Thank you for calling our AI receptionist. This is a test call. We are working on connecting you to our AI system. Please try again in a few minutes. Goodbye!</Say>
  <Hangup />
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
  <Say voice="alice">Sorry, we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup />
</Response>`

    return new Response(errorTwiml, {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})