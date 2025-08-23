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

    // Get agent settings and business hours
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const [settingsRes, hoursRes] = await Promise.all([
      supabase
        .from('agent_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('business_hours')
        .select('*')
        .eq('tenant_id', tenantId)
    ])

    const settings = settingsRes.data
    const businessHours = hoursRes.data || []

    // Check if we're in business hours
    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM format
    
    const todayHours = businessHours.find(h => h.dow === currentDay)
    const isBusinessHours = todayHours && 
      !todayHours.is_closed && 
      currentTime >= todayHours.open_time && 
      currentTime <= todayHours.close_time

    console.log('Business hours check:', { currentDay, currentTime, isBusinessHours, todayHours })

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

    // Generate appropriate TwiML response
    let twiml: string

    if (!isBusinessHours && settings?.after_hours_voicemail) {
      // After hours - voicemail
      const greeting = settings?.greeting || "Thank you for calling. We're currently closed."
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${greeting} Please leave a message after the tone.</Say>
  <Record 
    action="${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-voicemail?tenant_id=${tenantId}&call_sid=${callSid}"
    method="POST"
    maxLength="120"
    finishOnKey="#"
    playBeep="true"
  />
  <Say voice="alice">Thank you for your message. Goodbye.</Say>
  <Hangup />
</Response>`
    } else if (settings?.forward_number && !isBusinessHours) {
      // Forward to human number
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" callerId="${to}">
    <Number>${settings.forward_number}</Number>
  </Dial>
  <Say voice="alice">Sorry, no one is available to take your call. Please try again later.</Say>
  <Hangup />
</Response>`
    } else {
      // Connect to AI receptionist
      const greeting = settings?.greeting || "Hello! You've reached our AI receptionist. How can I help you today?"
      const streamUrl = `wss://${Deno.env.get('SUPABASE_URL')?.replace('https://', '')}/functions/v1/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`
      
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${greeting}</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`
    }

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