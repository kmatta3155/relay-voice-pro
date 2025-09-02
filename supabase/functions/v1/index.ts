import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function xml(strings: TemplateStringsArray, ...values: unknown[]) {
  let out = ''
  for (let i = 0; i < strings.length; i++) out += strings[i] + (values[i] ?? '')
  return out
}

serve(async (req) => {
  // Basic CORS
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const pathname = url.pathname || ''

  // Only handle /v1/twilio-router here; otherwise 404 to avoid confusion
  if (!pathname.endsWith('/twilio-router')) {
    return new Response('Not Found', { status: 404 })
  }

  // Parse Twilio form body if present
  let form: FormData | null = null
  try { if (req.method === 'POST') form = await req.formData() } catch {}

  const search = url.searchParams
  const from = (form?.get('From') as string) || search.get('From') || search.get('from') || ''
  const phoneNumber = search.get('phoneNumber') || from || ''
  const tenantId = (search.get('tenantId') || (form?.get('tenantId') as string) || '').trim()
  const businessName = (search.get('businessName') || (form?.get('businessName') as string) || 'this business').trim()

  // Build WS URL (default to top-level twilio-voice-stream function)
  const streamUrlEnv = Deno.env.get('TWILIO_STREAM_URL')
  const host = url.host
  const wsUrl = streamUrlEnv || `wss://${host}/twilio-voice-stream`

  const twiml = xml`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" track="inbound_track">
      ${phoneNumber ? `<Parameter name="phoneNumber" value="${phoneNumber.replace(/"/g, '')}"/>` : ''}
      ${tenantId ? `<Parameter name="tenantId" value="${tenantId.replace(/"/g, '')}"/>` : ''}
      ${businessName ? `<Parameter name="businessName" value="${businessName.replace(/"/g, '')}"/>` : ''}
    </Stream>
  </Connect>
</Response>`

  const headers = new Headers({ 'Content-Type': 'text/xml; charset=utf-8' })
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
  return new Response(twiml, { headers })
})

