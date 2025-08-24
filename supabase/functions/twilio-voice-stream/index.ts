import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('=== TWILIO VOICE STREAM START ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get("upgrade") || ""
  if (upgrade.toLowerCase() !== "websocket") {
    console.log('Not a WebSocket request, upgrade header:', upgrade)
    return new Response("Expected WebSocket", { status: 400 })
  }

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const callSid = url.searchParams.get('call_sid')

  console.log('Tenant ID:', tenantId)
  console.log('Call SID:', callSid)

  if (!tenantId || !callSid) {
    console.log('Missing required parameters')
    return new Response("Missing tenant_id or call_sid", { status: 400 })
  }

  console.log('Upgrading to WebSocket...')
  const { socket, response } = Deno.upgradeWebSocket(req)

  socket.onopen = () => {
    console.log('WebSocket opened successfully!')
  }

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('Received from Twilio:', data.event || data.type || 'unknown')
      
      if (data.event === 'connected') {
        console.log('Twilio connected!')
      } else if (data.event === 'start') {
        console.log('Call started with streamSid:', data.start?.streamSid)
      } else if (data.event === 'media') {
        console.log('Received audio data')
      } else if (data.event === 'stop') {
        console.log('Call stopped')
      }
    } catch (err) {
      console.error('Error parsing message:', err)
    }
  }

  socket.onerror = (error) => {
    console.error('WebSocket error:', error)
  }

  socket.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason)
  }

  console.log('Returning WebSocket response')
  return response
})