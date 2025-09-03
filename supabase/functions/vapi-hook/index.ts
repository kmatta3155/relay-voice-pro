import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vapi-secret',
}

async function generateReply(text: string, businessName: string): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-4o-mini'
  if (!openaiKey) return "I'm sorry, I can't respond right now."
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `You are a helpful AI receptionist for ${businessName || 'the business'}. Keep replies concise and friendly.` },
          { role: 'user', content: text || 'Say hello' }
        ]
      })
    })
    if (!resp.ok) {
      console.error('[VAPI_HOOK][OPENAI] Error:', await resp.text())
      return "Thanks for calling. Could you please repeat that?"
    }
    const data = await resp.json()
    return (data.choices?.[0]?.message?.content || '').trim() || 'Okay.'
  } catch (e) {
    console.error('[VAPI_HOOK] OpenAI error:', e)
    return 'Okay.'
  }
}

function pick<T = unknown>(obj: any, paths: string[]): T | undefined {
  for (const p of paths) {
    const segs = p.split('.')
    let cur: any = obj
    let ok = true
    for (const s of segs) {
      if (cur && s in cur) cur = cur[s]
      else { ok = false; break }
    }
    if (ok && (typeof cur === 'string' || typeof cur === 'number')) return cur as T
  }
  return undefined
}

// Supabase (for tenant routing by Twilio number)
const SB_URL = Deno.env.get('SUPABASE_URL')
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const sb = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null as any

type TenantRow = {
  tenant_id: string
  business_name?: string | null
  twilio_number?: string | null
  elevenlabs_voice_id?: string | null
}

async function fetchTenantByToNumber(toNumber: string): Promise<TenantRow | null> {
  if (!sb || !toNumber) return null
  try {
    const { data, error } = await sb
      .from('agent_settings')
      .select('tenant_id,business_name,twilio_number,elevenlabs_voice_id')
      .eq('twilio_number', toNumber)
      .limit(1)
      .maybeSingle()
    if (error) { console.warn('[VAPI_HOOK] SB error:', error.message); return null }
    return data as TenantRow | null
  } catch (e) {
    console.warn('[VAPI_HOOK] SB exception:', e)
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const secretRequired = Deno.env.get('VAPI_WEBHOOK_SECRET')
  if (secretRequired) {
    const provided = req.headers.get('x-vapi-secret') || req.headers.get('X-Vapi-Secret')
    if (!provided || provided !== secretRequired) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }
  }

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
    }

    const contentType = req.headers.get('content-type') || ''
    let body: any
    if (contentType.includes('application/json')) {
      body = await req.json()
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      body = Object.fromEntries(form.entries())
    } else {
      // Try json as fallback
      try { body = await req.json() } catch { body = {} }
    }

    // Flexible extraction based on common Vapi shapes
    const transcript: string = (pick<string>(body, [
      'transcript',
      'text',
      'input.transcript',
      'input.text',
      'data.transcript',
      'data.text',
      'message',
    ]) || '').toString()

    // Resolve tenant by callee/"to" number or assistant metadata if available
    const toNumber: string = (pick<string>(body, [
      'to',
      'call.to',
      'data.to',
      'callee',
      'destination',
      'phone.to',
      'twilio.to'
    ]) || '').toString()

    let businessName: string = (pick<string>(body, [
      'metadata.businessName',
      'context.businessName',
      'businessName',
    ]) || 'this business').toString()

    let voiceIdOverride: string | undefined
    let tenantRow: TenantRow | null = null
    if (toNumber) {
      tenantRow = await fetchTenantByToNumber(toNumber)
      if (tenantRow?.business_name) businessName = tenantRow.business_name
      if (tenantRow?.elevenlabs_voice_id) voiceIdOverride = tenantRow.elevenlabs_voice_id
    }

    const reply = await generateReply(transcript, businessName)

    const res: Record<string, unknown> = { text: reply }
    if (voiceIdOverride) res.voice_id = voiceIdOverride
    return new Response(JSON.stringify(res), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('[VAPI_HOOK] Error:', e)
    return new Response(JSON.stringify({ text: "I'm sorry, something went wrong." }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
