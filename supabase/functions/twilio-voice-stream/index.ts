import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('=== TWILIO VOICE STREAM HANDLER ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Extract parameters from URL (optional)
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const callSid = url.searchParams.get('call_sid')

  console.log('Parameters (may be missing pre-upgrade):', { tenantId, callSid })

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = req.headers.get("upgrade")
  const connectionHeader = req.headers.get("connection")
  
  console.log('Connection headers:', { 
    upgrade: upgradeHeader, 
    connection: connectionHeader 
  })

  if (upgradeHeader?.toLowerCase() !== "websocket") {
    console.log('Not a WebSocket upgrade request')
    return new Response("Expected WebSocket upgrade", { status: 426 })
  }

  try {
    console.log('Upgrading to WebSocket...')
    const requestedProtocols = req.headers.get("sec-websocket-protocol")?.split(",").map(p => p.trim()) || []
    // Echo back exactly what Twilio requested (first subprotocol) per RFC6455
    const chosenProtocol = requestedProtocols.length > 0 ? requestedProtocols[0] : undefined
    console.log('Requested subprotocols from client:', requestedProtocols, 'Chosen:', chosenProtocol)
    const { socket, response } = Deno.upgradeWebSocket(req, {
      protocol: chosenProtocol,
    })

    socket.onopen = () => {
      console.log('✅ WebSocket connection established successfully!')
      console.log('Ready to receive Twilio media stream data')
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('📨 Received from Twilio:', data.event || data.type || 'unknown')
        
        if (data.event === 'connected') {
          console.log('🔗 Twilio WebSocket connected!')
        } else if (data.event === 'start') {
          console.log('▶️ Media stream started:', {
            streamSid: data.start?.streamSid,
            callSid: data.start?.callSid,
            tracks: data.start?.tracks,
            mediaFormat: data.start?.mediaFormat
          })
        } else if (data.event === 'media') {
          // Log first few media packets then reduce verbosity
          console.log('🎵 Audio data received (seq:', data.sequenceNumber + ')')
        } else if (data.event === 'stop') {
          console.log('⏹️ Media stream stopped')
        }
      } catch (err) {
        console.error('❌ Error parsing Twilio message:', err)
        console.log('Raw message:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔌 WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
    }

    console.log('✅ WebSocket upgrade successful, returning response')
    return response

  } catch (error) {
    console.error('❌ Failed to upgrade WebSocket:', error)
    return new Response(`WebSocket upgrade failed: ${error.message}`, { 
      status: 500,
      headers: corsHeaders 
    })
  }
})