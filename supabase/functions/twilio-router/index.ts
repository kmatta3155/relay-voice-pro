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
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;')
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

  const from = (form?.get('From') as string) || search.get('From') || search.get('from') || ''
  const to = (form?.get('To') as string) || search.get('To') || search.get('to') || ''
  const phoneNumber = search.get('phoneNumber') || from || ''
  let tenantId = (search.get('tenantId') || (form?.get('tenantId') as string) || '').trim()
  let businessName = (search.get('businessName') || (form?.get('businessName') as string) || 'this business').trim()
  let voiceId = (search.get('voiceId') || (form?.get('voiceId') as string) || '').trim()
  let greeting = ''

  // Resolve tenant + business by the called number if missing
  try {
    if ((!tenantId || businessName === 'this business') && to) {
      const SB_URL = Deno.env.get('SUPABASE_URL')
      const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (SB_URL && SB_KEY) {
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
          const { data: t } = await sb
            .from('tenants')
            .select('name')
            .eq('id', agent.tenant_id)
            .maybeSingle()
          if (t?.name) businessName = t.name
        }
      }
    }
  } catch (e) {
    console.warn('[twilio-router] tenant lookup failed', e)
  }

  // Allow overriding the Stream URL via env. Otherwise derive from this request's host.
  const streamUrlEnv = Deno.env.get('TWILIO_STREAM_URL')
  const host = url.host
  const wsUrl = streamUrlEnv || `wss://${host}/twilio-voice-stream`

  const twiml = xml`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" track="inbound_track">
      ${phoneNumber ? `<Parameter name="phoneNumber" value="${phoneNumber.replace(/"/g, '')}"/>` : ''}
      ${to ? `<Parameter name="toNumber" value="${to.replace(/"/g, '')}"/>` : ''}
      ${tenantId ? `<Parameter name="tenantId" value="${tenantId.replace(/"/g, '')}"/>` : ''}
      ${businessName ? `<Parameter name="businessName" value="${businessName.replace(/"/g, '')}"/>` : ''}
      ${voiceId ? `<Parameter name="voiceId" value="${voiceId.replace(/"/g, '')}"/>` : ''}
    </Stream>
  </Connect>
</Response>`

  const headers = new Headers({ 'Content-Type': 'text/xml; charset=utf-8' })
  // Twilio does not require CORS, but these don't hurt on browsers/tools
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
  return new Response(twiml, { headers })
})
