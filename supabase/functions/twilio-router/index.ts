import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function xml(strings: TemplateStringsArray, ...values: unknown[]) {
  let out = ''
  for (let i = 0; i < strings.length; i++) out += strings[i] + (values[i] ?? '')
  return out
}

function xmlEscape(s: string){
  return s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\"/g,'&quot;')
    .replace(/'/g,'&apos;')
}

function normalizePhone(input: string): string {
  if (!input) return ''
  // Handle SIP / tel URIs
  const sip = input.match(/sip:([^@;]+)/i)
  if (sip) input = sip[1]
  const tel = input.match(/tel:([^?]+)/i)
  if (tel) input = tel[1]
  // Keep digits, allow leading +
  let s = input.trim().replace(/[^\d+]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (!s.startsWith('+')) {
    const digits = s.replace(/\D/g, '')
    if (digits.length === 10) s = '+1' + digits
    else if (digits.length > 0) s = '+' + digits
  }
  return s
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const search = url.searchParams

  // Parse Twilio form body if present
  let form: FormData | null = null
  try {
    if (req.method === 'POST') {
      form = await req.formData()
    }
  } catch {}

  const fromRaw = (form?.get('From') as string) || search.get('From') || search.get('from') || ''
  const toRaw = (form?.get('To') as string) || search.get('To') || search.get('to') || ''
  const from = normalizePhone(fromRaw)
  const to = normalizePhone(toRaw)
  const phoneNumber = search.get('phoneNumber') || from || ''
  let tenantId = (search.get('tenantId') || (form?.get('tenantId') as string) || '').trim()
  let businessName = (search.get('businessName') || (form?.get('businessName') as string) || 'this business').trim()
  let voiceId = (search.get('voiceId') || (form?.get('voiceId') as string) || '').trim()
  let greeting = ''

  // LOG: Initial request parameters
  console.log('[twilio-router] Processing request', {
    method: req.method,
    fromRaw,
    toRaw,
    from,
    to,
    phoneNumber,
    initialTenantId: tenantId,
    initialBusinessName: businessName,
    initialVoiceId: voiceId
  })

  // Resolve tenant + business by the called number if possible (fast lookups)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    console.log('[twilio-router] Environment check', {
      hasSupabaseUrl: !!SB_URL,
      hasSupabaseKey: !!SB_KEY,
      toNumber: to,
      canPerformLookup: !!(to && SB_URL && SB_KEY)
    })
    
    if (to && (SB_URL && SB_KEY)) {
      const sb = createClient(SB_URL, SB_KEY)
      
      console.log('[twilio-router] Querying agent_settings', {
        table: 'agent_settings',
        lookupField: 'twilio_number',
        lookupValue: to,
        selectFields: 'tenant_id,greeting'
      })
      
      const { data: agent, error: agentError } = await sb
        .from('agent_settings')
        .select('tenant_id,greeting')
        .eq('twilio_number', to)
        .maybeSingle()
      
      console.log('[twilio-router] Agent lookup result', {
        agent,
        agentError,
        hasAgent: !!agent,
        agentTenantId: agent?.tenant_id
      })
      
      if (agent?.tenant_id) {
        if (!tenantId) tenantId = agent.tenant_id
        if (!greeting && (agent as any).greeting) greeting = String((agent as any).greeting)
        
        console.log('[twilio-router] Updated from agent_settings', {
          tenantId,
          voiceId,
          greeting: greeting?.substring(0, 50) + '...'
        })
        
        try {
          console.log('[twilio-router] Querying tenants table', {
            table: 'tenants',
            lookupField: 'id',
            lookupValue: agent.tenant_id
          })
          
          const { data: t, error: tenantError } = await sb
            .from('tenants')
            .select('name')
            .eq('id', agent.tenant_id)
            .maybeSingle()
          
          console.log('[twilio-router] Tenant lookup result', {
            tenant: t,
            tenantError,
            tenantName: t?.name
          })
          
          if (t?.name) businessName = t.name
        } catch (tenantLookupError) {
          console.error('[twilio-router] Tenant lookup error', tenantLookupError)
        }
      } else {
        console.warn('[twilio-router] No agent found or agent has no tenant_id', {
          agentFound: !!agent,
          agentData: agent
        })
      }
    } else {
      console.warn('[twilio-router] Cannot perform lookup - missing requirements', {
        hasToNumber: !!to,
        hasSupabaseUrl: !!SB_URL,
        hasSupabaseKey: !!SB_KEY
      })
      // CRITICAL FIX: Clear any potentially wrong cached values if DB lookup fails
      tenantId = ''
      businessName = 'this business'
      greeting = ''
    }
  } catch (e) {
    console.error('[twilio-router] tenant lookup failed', {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined
    })
  }


  // Get the WebSocket URL for the twilio-voice-stream function
  // Allow overriding via environment variable, otherwise derive from request host
  const streamUrlEnv = Deno.env.get('TWILIO_STREAM_URL')
  const host = url.host
  // Production AI voice system with ElevenLabs TTS and business-specific agents
  const wsUrl = streamUrlEnv || `wss://${host}/functions/v1/twilio-voice-stream`

  // LOG: Final parameters being passed to stream
  console.log('[twilio-router] Final stream parameters', {
    wsUrl,
    phoneNumber,
    from,
    to,
    tenantId,
    businessName,
    voiceId,
    greeting: greeting ? greeting.substring(0, 50) + '...' : 'none',
    hasParameters: {
      phoneNumber: !!phoneNumber,
      from: !!from,
      to: !!to,
      tenantId: !!tenantId,
      businessName: !!businessName,
      voiceId: !!voiceId,
      greeting: !!greeting
    }
  })

  // Build clean TwiML response with proper Stream element
  // Note: Greeting is handled in WebSocket, so no <Say> element needed
  const twiml = xml`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(wsUrl)}">
      ${phoneNumber ? xml`<Parameter name="phoneNumber" value="${xmlEscape(phoneNumber)}"/>` : ''}
      ${from ? xml`<Parameter name="from" value="${xmlEscape(from)}"/>` : ''}
      ${to ? xml`<Parameter name="to" value="${xmlEscape(to)}"/>` : ''}
      ${tenantId ? xml`<Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>` : ''}
      ${businessName ? xml`<Parameter name="businessName" value="${xmlEscape(businessName)}"/>` : ''}
      ${voiceId ? xml`<Parameter name="voiceId" value="${xmlEscape(voiceId)}"/>` : ''}
      ${greeting ? xml`<Parameter name="greeting" value="${xmlEscape(greeting)}"/>` : ''}
    </Stream>
  </Connect>
</Response>`
  
  console.log('[twilio-router] Generated TwiML response', {
    twimlLength: twiml.length,
    twimlPreview: twiml.substring(0, 200) + '...'
  })

  const headers = new Headers({ 'Content-Type': 'text/xml; charset=utf-8' })
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
  return new Response(twiml, { headers })
})
