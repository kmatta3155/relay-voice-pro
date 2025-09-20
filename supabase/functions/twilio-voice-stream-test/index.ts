import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// μ-law encoding table
const MULAW_TABLE = [
  0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
]

function pcmToMulaw(pcm: number): number {
  const BIAS = 0x84
  const MAX = 32635
  
  let sign = (pcm >> 8) & 0x80
  if (sign) pcm = -pcm
  if (pcm > MAX) pcm = MAX
  
  pcm = pcm + BIAS
  const exponent = MULAW_TABLE[(pcm >> 7) & 0xFF]
  const mantissa = (pcm >> (exponent + 3)) & 0x0F
  const mulaw = ~(sign | (exponent << 4) | mantissa)
  
  return mulaw & 0xFF
}

serve(async (req) => {
  // Health check
  const url = new URL(req.url)
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      version: 'test-v1',
      timestamp: new Date().toISOString()
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
  
  // WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  console.log('[TEST] Voice stream connecting...')
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  let streamSid = ''
  
  socket.onopen = () => {
    console.log('[TEST] Connected')
  }
  
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data)
      console.log('[TEST] Event:', message.event)
      
      if (message.event === 'start') {
        streamSid = message.start?.streamSid || ''
        console.log('[TEST] StreamSid:', streamSid)
        
        // TEST 1: Send 1 second of pure silence (0xFF)
        console.log('[TEST] Sending 1 second of silence...')
        for (let i = 0; i < 50; i++) { // 50 frames = 1 second
          const frame = new Uint8Array(160)
          frame.fill(0xFF) // μ-law silence
          
          socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: btoa(String.fromCharCode(...frame))
            }
          }))
          
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        // TEST 2: Send simple tone (different from 400Hz)
        console.log('[TEST] Sending 600Hz tone...')
        for (let frameIndex = 0; frameIndex < 50; frameIndex++) { // 1 second
          const frame = new Uint8Array(160)
          
          for (let i = 0; i < 160; i++) {
            const time = (frameIndex * 160 + i) / 8000
            const amplitude = Math.sin(2 * Math.PI * 600 * time)
            const pcm16 = Math.floor(amplitude * 8000) // Lower amplitude
            frame[i] = pcmToMulaw(pcm16)
          }
          
          socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: btoa(String.fromCharCode(...frame))
            }
          }))
          
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        // TEST 3: Send alternating pattern (should sound like buzzing)
        console.log('[TEST] Sending alternating pattern...')
        for (let frameIndex = 0; frameIndex < 50; frameIndex++) {
          const frame = new Uint8Array(160)
          
          // Create alternating high/low pattern
          for (let i = 0; i < 160; i++) {
            frame[i] = (i % 2 === 0) ? 0x00 : 0xFF
          }
          
          socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: btoa(String.fromCharCode(...frame))
            }
          }))
          
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        console.log('[TEST] All tests complete')
      }
    } catch (error) {
      console.error('[TEST] Error:', error)
    }
  }
  
  socket.onclose = () => {
    console.log('[TEST] Closed')
  }
  
  return response
})