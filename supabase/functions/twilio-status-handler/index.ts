/*
 * Twilio Status Webhook Handler
 * Receives call status updates for monitoring and analytics
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'
import { createHmac } from 'https://deno.land/std@0.168.0/crypto/hmac.ts'
import { encode } from 'https://deno.land/std@0.168.0/encoding/hex.ts'

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: corsHeaders })
  }

  try {
    // Parse form data from Twilio
    const formData = await req.formData()
    const params: Record<string, string> = {}
    
    // Build params object for signature verification
    for (const [key, value] of formData.entries()) {
      params[key] = value as string
    }
    
    // Verify Twilio signature - REQUIRED for security
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    if (!authToken) {
      console.error('[STATUS] TWILIO_AUTH_TOKEN not configured - security risk!')
      return new Response('Server configuration error', { status: 500, headers: corsHeaders })
    }
    
    const signature = req.headers.get('X-Twilio-Signature')
    if (!signature || !verifyTwilioSignature(authToken, signature, req.url, params)) {
      console.error('[STATUS] Invalid Twilio signature')
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }
    
    const callSid = formData.get('CallSid')
    const callStatus = formData.get('CallStatus')
    const from = formData.get('From')
    const to = formData.get('To')
    const duration = formData.get('CallDuration')
    const timestamp = formData.get('Timestamp')
    
    console.log(`[STATUS] Call ${callSid} status: ${callStatus}`)
    console.log(`[STATUS] From: ${from}, To: ${to}, Duration: ${duration}s`)
    
    // Store call status in database if available
    if (supabase && callSid) {
      try {
        const callData = {
          call_sid: callSid,
          status: callStatus,
          from_number: from,
          to_number: to,
          duration_seconds: duration ? parseInt(duration as string) : null,
          timestamp: timestamp || new Date().toISOString(),
          created_at: new Date().toISOString()
        }
        
        // Try to insert or update call record
        const { error } = await supabase
          .from('calls')
          .upsert(callData, {
            onConflict: 'call_sid'
          })
        
        if (error) {
          console.error('[STATUS] Database error:', error)
        } else {
          console.log('[STATUS] Call record updated in database')
        }
        
      } catch (dbError) {
        console.error('[STATUS] Database connection error:', dbError)
      }
    }
    
    // Return success response
    return new Response('OK', {
      status: 200,
      headers: corsHeaders
    })

  } catch (error) {
    console.error('[STATUS] Error processing status webhook:', error)
    
    return new Response('Error', {
      status: 500,
      headers: corsHeaders
    })
  }
})

console.log('Twilio Status Webhook Handler started')