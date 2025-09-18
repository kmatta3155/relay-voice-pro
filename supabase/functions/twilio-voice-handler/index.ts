/*
 * Twilio Voice Webhook Handler
 * Returns TwiML to start WebSocket streaming to AI voice receptionist
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createHmac } from 'https://deno.land/std@0.168.0/crypto/hmac.ts'
import { encode } from 'https://deno.land/std@0.168.0/encoding/hex.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}

// XML escaping function to prevent injection
function escapeXml(str: string): string {
  if (!str) return str
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// Verify Twilio webhook signature
function verifyTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  // Create the signature data string
  const data = url + Object.keys(params).sort().map(key => key + params[key]).join('')
  
  // Create HMAC-SHA1
  const hmac = createHmac('sha1', new TextEncoder().encode(authToken))
  hmac.update(new TextEncoder().encode(data))
  const hash = hmac.digest()
  
  // Convert to base64
  const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(hash)))
  
  return expectedSignature === signature
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    
    // Parse parameters from both form data and URL params
    let callSid: string | null = null
    let from: string | null = null
    let to: string | null = null
    const params: Record<string, string> = {}
    
    if (req.method === 'POST') {
      const formData = await req.formData()
      callSid = formData.get('CallSid') as string
      from = formData.get('From') as string
      to = formData.get('To') as string
      
      // Build params object for signature verification
      for (const [key, value] of formData.entries()) {
        params[key] = value as string
      }
    } else {
      // GET request - read from URL params
      callSid = requestUrl.searchParams.get('CallSid')
      from = requestUrl.searchParams.get('From')
      to = requestUrl.searchParams.get('To')
      
      for (const [key, value] of requestUrl.searchParams.entries()) {
        params[key] = value
      }
    }
    
    // Verify Twilio signature - REQUIRED for security
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    if (!authToken) {
      console.error('[WEBHOOK] TWILIO_AUTH_TOKEN not configured - security risk!')
      return new Response('Server configuration error', { status: 500, headers: corsHeaders })
    }
    
    const signature = req.headers.get('X-Twilio-Signature')
    if (!signature || !verifyTwilioSignature(authToken, signature, req.url, params)) {
      console.error('[WEBHOOK] Invalid Twilio signature')
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }
    
    console.log(`[WEBHOOK] Incoming call: ${callSid}, From: ${from}, To: ${to}`)
    
    // Get configuration from URL params or defaults
    const businessName = requestUrl.searchParams.get('businessName') || 'our business'
    const tenantId = requestUrl.searchParams.get('tenantId') || undefined
    const voiceId = requestUrl.searchParams.get('voiceId') || undefined
    
    // Build correct WebSocket URL for Supabase Functions
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not configured')
    }
    
    // Convert https://xyz.supabase.co to wss://xyz.functions.supabase.co/twilio-voice-stream
    const host = new URL(supabaseUrl).host.replace('.supabase.co', '.functions.supabase.co')
    const wsUrl = `wss://${host}/twilio-voice-stream`
    
    // Generate TwiML response with proper XML escaping and bidirectional audio
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Please wait while we connect you to our AI assistant.</Say>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}" name="ai-voice-stream" track="both_tracks">
      <Parameter name="businessName" value="${escapeXml(businessName)}" />
      ${tenantId ? `<Parameter name="tenantId" value="${escapeXml(tenantId)}" />` : ''}
      ${voiceId ? `<Parameter name="voiceId" value="${escapeXml(voiceId)}" />` : ''}
      <Parameter name="callSid" value="${escapeXml(callSid || '')}" />
      <Parameter name="from" value="${escapeXml(from || '')}" />
      <Parameter name="to" value="${escapeXml(to || '')}" />
    </Stream>
  </Connect>
</Response>`

    console.log('[WEBHOOK] Generated TwiML:', twiml)
    
    return new Response(twiml, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    })

  } catch (error) {
    console.error('[WEBHOOK] Error:', error)
    
    // Return error TwiML
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We're sorry, but our AI assistant is currently unavailable. Please try again later.</Say>
  <Hangup />
</Response>`

    return new Response(errorTwiml, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    })
  }
})

console.log('Twilio Voice Webhook Handler started')