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

  // Resolve tenant + business by the called number if possible (fast lookups)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (to && (SB_URL && SB_KEY)) {
      const sb = createClient(SB_URL, SB_KEY)
      const { data: agent } = await sb
        .from('agent_settings')
        .select('tenant_id,greeting,elevenlabs_voice_id')
        .eq('twilio_number', to)
        .maybeSingle()
      if (agent?.tenant_id) {
        if (!tenantId) tenantId = agent.tenant_id
        if (!voiceId && agent.elevenlabs_voice_id) voiceId = agent.elevenlabs_voice_id as string
        if (!greeting && (agent as any).greeting) greeting = String((agent as any).greeting)
        try {
          const { data: t } = await sb
            .from('tenants')
            .select('name')
            .eq('id', agent.tenant_id)
            .maybeSingle()
          if (t?.name) businessName = t.name
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[twilio-router] tenant lookup failed', e)
  }


  // Get the WebSocket URL for the twilio-voice-stream function
  // Allow overriding via environment variable, otherwise derive from request host
  const streamUrlEnv = Deno.env.get('TWILIO_STREAM_URL')
  const host = url.host
  const wsUrl = streamUrlEnv || `wss://${host}/twilio-voice-stream`

  // Build clean TwiML response with proper Stream element
  const twiml = xml`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${xmlEscape(wsUrl)}" track="both_tracks">
      ${phoneNumber ? xml`<Parameter name="phoneNumber" value="${xmlEscape(phoneNumber)}"/>` : ''}
      ${from ? xml`<Parameter name="from" value="${xmlEscape(from)}"/>` : ''}
      ${to ? xml`<Parameter name="to" value="${xmlEscape(to)}"/>` : ''}
      ${tenantId ? xml`<Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>` : ''}
      ${businessName ? xml`<Parameter name="businessName" value="${xmlEscape(businessName)}"/>` : ''}
      ${voiceId ? xml`<Parameter name="voiceId" value="${xmlEscape(voiceId)}"/>` : ''}
      ${greeting ? xml`<Parameter name="greeting" value="${xmlEscape(greeting)}"/>` : ''}
    </Stream>
  </Start>
  <Say voice="alice">Please hold while I connect you...</Say>
</Response>`

  const headers = new Headers({ 'Content-Type': 'text/xml; charset=utf-8' })
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
  return new Response(twiml, { headers })
})
