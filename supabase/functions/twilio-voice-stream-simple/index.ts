import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const FRAME_SIZE = 160

// Standard μ-law encoding
function pcmToMulaw(pcm: number): number {
  const MULAW_MAX = 0x1FFF
  const MULAW_BIAS = 132
  
  let sign = (pcm >> 8) & 0x80
  if (sign !== 0) pcm = -pcm
  if (pcm > MULAW_MAX) pcm = MULAW_MAX
  
  pcm += MULAW_BIAS
  let exponent = 7
  
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  
  const mantissa = (pcm >> (exponent + 3)) & 0x0F
  const mulaw = ~(sign | (exponent << 4) | mantissa)
  
  return mulaw & 0xFF
}

serve(async (req) => {
  const url = new URL(req.url)
  
  // Health check
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      version: 'simple-v3-no-continuous',
      timestamp: new Date().toISOString()
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
  
  // WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  console.log('[Simple] Connecting...')
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  let streamSid = ''
  
  socket.onopen = () => {
    console.log('[Simple] Connected')
  }
  
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data)
      console.log('[Simple] Event:', message.event)
      
      if (message.event === 'start') {
        streamSid = message.start?.streamSid || ''
        console.log('[Simple] StreamSid:', streamSid)
        
        // Test tone 1: 440Hz for 0.5 seconds
        console.log('[Simple] Sending 440Hz test tone')
        for (let frameIndex = 0; frameIndex < 25; frameIndex++) {
          const frame = new Uint8Array(160)
          for (let i = 0; i < 160; i++) {
            const time = (frameIndex * 160 + i) / 8000
            const amplitude = Math.sin(2 * Math.PI * 440 * time)
            const pcm16 = Math.floor(amplitude * 16384)
            frame[i] = pcmToMulaw(pcm16)
          }
          
          socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: btoa(String.fromCharCode(...frame))
            }
          }))
          
          // Pace at 20ms
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        // 100ms silence between tones
        console.log('[Simple] Silence gap')
        for (let i = 0; i < 5; i++) {
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
        
        // Test tone 2: 600Hz for 0.5 seconds
        console.log('[Simple] Sending 600Hz test tone')
        for (let frameIndex = 0; frameIndex < 25; frameIndex++) {
          const frame = new Uint8Array(160)
          for (let i = 0; i < 160; i++) {
            const time = (frameIndex * 160 + i) / 8000
            const amplitude = Math.sin(2 * Math.PI * 600 * time)
            const pcm16 = Math.floor(amplitude * 8192) // Lower amplitude
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
        
        console.log('[Simple] Test complete - NO MORE FRAMES')
        // DO NOT send any more frames after this - no continuous silence
      }
    } catch (error) {
      console.error('[Simple] Error:', error)
    }
  }
  
  socket.onclose = () => {
    console.log('[Simple] Closed')
  }
  
  return response
})