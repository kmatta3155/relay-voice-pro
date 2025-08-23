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
    console.log('Incoming Twilio call webhook');
    
    // Parse form data from Twilio
    const formData = await req.formData()
    const callSid = formData.get('CallSid')
    const from = formData.get('From')
    const to = formData.get('To')
    
    console.log('Call details:', { callSid, from, to })

    // Get tenant_id from query params or lookup by phone number
    const url = new URL(req.url)
    let tenantId = url.searchParams.get('tenant_id')
    
    if (!tenantId && to) {
      // Look up tenant by phone number
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      
      const { data } = await supabase
        .from('agent_settings')
        .select('tenant_id')
        .eq('twilio_number', to)
        .single()
      
      tenantId = data?.tenant_id
    }

    if (!tenantId) {
      console.error('No tenant found for phone number:', to)
      // Return fallback TwiML
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling. This number is not currently configured. Goodbye.</Say>
  <Hangup />
</Response>`
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    // Check if AI agent is in live mode
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: agentData, error: agentError } = await supabase
      .from('ai_agents')
      .select('mode, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .single()

    if (agentError || !agentData) {
      console.log('No ready agent found or agent error:', agentError)
      console.log('Agent lookup for tenant:', tenantId)
      // If no agent in live mode, just hang up politely
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling. We're currently unavailable. Please try again later.</Say>
  <Hangup />
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
  <Say voice="alice">Thank you for calling. We're currently unavailable. Please try again later.</Say>
  <Hangup />
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

    // Connect to AI receptionist (agent is ready and in live mode)
    const streamUrl = `wss://gnqqktmslswgjtvxfvdo.functions.supabase.co/functions/v1/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello! Thank you for calling. Please hold while I connect you.</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`

    console.log('Generated TwiML:', twiml)

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' }
    })

  } catch (error) {
    console.error('Twilio router error:', error)
    
    // Return error TwiML
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