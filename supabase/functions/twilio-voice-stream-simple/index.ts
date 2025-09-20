import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  // Health check
  const url = new URL(req.url)
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      version: 'simple-v1',
      timestamp: new Date().toISOString()
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
  
  // WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  console.log('[WebSocket] Voice stream connecting...')
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  socket.onopen = () => {
    console.log('[WebSocket] Connected')
  }
  
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data)
      console.log('[WebSocket] Received:', message.event)
      
      if (message.event === 'start') {
        console.log('[WebSocket] Call started, sending greeting')
        // Send a simple greeting immediately
        socket.send(JSON.stringify({
          event: 'media',
          streamSid: message.start?.streamSid || '',
          sequenceNumber: '1',
          media: {
            payload: btoa('Hello test'),
            track: 'outbound'
          }
        }))
      }
    } catch (error) {
      console.error('[WebSocket] Error:', error)
    }
  }
  
  socket.onclose = () => {
    console.log('[WebSocket] Closed')
  }
  
  socket.onerror = (error) => {
    console.error('[WebSocket] Error:', error)
  }
  
  return response
})