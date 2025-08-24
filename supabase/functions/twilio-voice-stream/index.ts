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
        const data = JSON.parse(event.data)
        const evt = data.event
        if (!evt) return
        console.log('📨 Event from Twilio:', evt)

        if (evt === 'connected') {
          console.log('🔌 Twilio connected')
        }

        if (evt === 'start') {
          streamSid = data.start?.streamSid || data.streamSid
          console.log('▶️ Stream started. streamSid=', streamSid)

          // Send a simple mark event to acknowledge the stream is ready
          socket.send(JSON.stringify({ 
            event: 'mark', 
            streamSid, 
            mark: { name: 'stream_ready' } 
          }))
          console.log('✅ Stream ready, awaiting caller input')
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
