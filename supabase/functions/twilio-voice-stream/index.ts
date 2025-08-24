import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  if (req.method === 'OPTIONS') {
    console.log('✅ Handling OPTIONS request')
    return new Response('ok', { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    console.log('❌ Not a WebSocket upgrade request, upgrade header:', upgradeHeader)
    return new Response('Expected WebSocket', { status: 400 })
  }

  try {
    console.log('🔄 Upgrading to WebSocket...')
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
        const data = JSON.parse(event.data)
        console.log('📨 Received:', data.event, data)

        if (data.event === 'connected') {
          console.log('🔌 Twilio connected')
        }

        if (data.event === 'start') {
          console.log('▶️ Stream started')
          streamSid = data.start?.streamSid || data.streamSid
          console.log('🆔 Stream SID:', streamSid)

          // Send a simple test message back to Twilio
          const testMessage = {
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: 'dGVzdA==' // base64 for 'test'
            }
          }
          socket.send(JSON.stringify(testMessage))
          console.log('📤 Sent test message')
        }

        if (data.event === 'media') {
          console.log('🎵 Received audio data, payload length:', data.media?.payload?.length || 0)
        }

        if (data.event === 'stop') {
          console.log('🛑 Stream stopped')
        }

      } catch (error) {
        console.error('❌ Error processing message:', error)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔒 WebSocket closed:', event.code, event.reason)
    }

    console.log('✅ WebSocket setup complete, returning response')
    return response

  } catch (error) {
    console.error('❌ Error setting up WebSocket:', error)
    return new Response('WebSocket upgrade failed', { status: 500 })
  }
})