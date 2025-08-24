import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED - SIMPLE VERSION')
  console.log('Method:', req.method)
  console.log('URL:', req.url)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    console.log('❌ Not a WebSocket upgrade request')
    return new Response('Expected WebSocket', { status: 400 })
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(req)
    
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    const callSid = url.searchParams.get('call_sid')
    console.log('📋 Parameters:', { tenantId, callSid })

    let streamSid = ''
    let hasSpoken = false

    socket.onopen = () => {
      console.log('✅ WebSocket opened!')
    }

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('📨 Received event:', data.event)
        console.log('📨 Full data:', JSON.stringify(data, null, 2))

        if (data.event === 'connected') {
          console.log('🔌 Twilio connected to stream')
        }

        if (data.event === 'start') {
          streamSid = data.start?.streamSid
          console.log('▶️ Stream started with SID:', streamSid)
          
          if (!hasSpoken && streamSid) {
            hasSpoken = true
            
            // Try sending a simple TwiML Say command
            try {
              const sayMessage = {
                event: 'twiml',
                streamSid: streamSid,
                twiml: '<Say>Hello from your AI assistant!</Say>'
              }
              console.log('📤 Sending TwiML message:', JSON.stringify(sayMessage))
              socket.send(JSON.stringify(sayMessage))
              console.log('✅ TwiML message sent successfully')
            } catch (error) {
              console.error('❌ Error sending TwiML:', error)
            }

            // Also try a mark event to confirm communication
            try {
              const markMessage = {
                event: 'mark',
                streamSid: streamSid,
                mark: {
                  name: 'test_mark'
                }
              }
              console.log('📤 Sending mark message:', JSON.stringify(markMessage))
              socket.send(JSON.stringify(markMessage))
              console.log('✅ Mark message sent successfully')
            } catch (error) {
              console.error('❌ Error sending mark:', error)
            }
          }
        }

        if (data.event === 'media') {
          const payloadLength = data.media?.payload?.length || 0
          console.log('🎵 Received audio data, payload length:', payloadLength)
        }

        if (data.event === 'mark') {
          console.log('📍 Mark event received:', data.mark?.name)
        }

        if (data.event === 'stop') {
          console.log('🛑 Stream stopped')
        }

      } catch (error) {
        console.error('❌ Error processing message:', error)
        console.error('Raw data:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔒 WebSocket closed. Code:', event.code, 'Reason:', event.reason)
    }

    console.log('✅ WebSocket setup complete')
    return response

  } catch (error) {
    console.error('❌ Error setting up WebSocket:', error)
    return new Response('WebSocket upgrade failed', { status: 500 })
  }
})