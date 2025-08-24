import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED - NEW VERSION')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(req)

    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    const callSid = url.searchParams.get('call_sid')
    console.log('📋 Parameters:', { tenantId, callSid })

    let streamSid = ''

    socket.onopen = () => {
      console.log('✅ WebSocket opened successfully!')
    }

    socket.onmessage = async (event) => {
      try {
        console.log('📥 Raw WebSocket message received:', event.data)
        const data = JSON.parse(event.data)
        const evt = data.event
        console.log('📨 Parsed event type:', evt)
        console.log('📊 Full event data:', JSON.stringify(data, null, 2))
        
        if (!evt) {
          console.log('⚠️ No event type found in message')
          return
        }

        if (evt === 'connected') {
          console.log('🔌 Twilio connected')
        }

        if (evt === 'start') {
          streamSid = data.start?.streamSid
          console.log('▶️ Stream started. streamSid=', streamSid)
          console.log('✅ Stream ready, awaiting caller audio')
        }

        if (evt === 'media') {
          // We receive caller μ-law audio here as base64 in data.media.payload
          // For now, just acknowledge with a mark to keep the stream alive during testing
          if (data.media?.payload) {
            // no-op
          }
        }

        if (evt === 'stop') {
          console.log('🛑 Stream stopped')
        }
      } catch (err) {
        console.error('❌ Error handling message:', err)
        console.error('Raw:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔒 WebSocket closed:', event.code, event.reason)
    }

    return response
  } catch (error) {
    console.error('❌ Error setting up WebSocket:', error)
    return new Response('WebSocket upgrade failed', { status: 500 })
  }
})
