import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const FRAME_SIZE = 160
const FRAME_DURATION_MS = 20

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
      version: 'minimal-v1',
      timestamp: new Date().toISOString()
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
  
  // WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  console.log('[Minimal] Connecting...')
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  let streamSid = ''
  
  socket.onopen = () => {
    console.log('[Minimal] Connected')
  }
  
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data)
      console.log('[Minimal] Event:', message.event)
      
      if (message.event === 'start') {
        streamSid = message.start?.streamSid || ''
        console.log('[Minimal] StreamSid:', streamSid)
        
        // Send test tone first
        console.log('[Minimal] Sending test tone')
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
          
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        // Silence
        for (let i = 0; i < 25; i++) {
          const frame = new Uint8Array(160)
          frame.fill(0xFF)
          
          socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: btoa(String.fromCharCode(...frame))
            }
          }))
          
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        
        // Try ElevenLabs with minimal processing
        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY') || ''
        
        console.log('[Minimal] Calling ElevenLabs API')
        const ttsResponse = await fetch('https://api.elevenlabs.io/v1/text-to-speech/Xb7hH8MSUJpSbSDYk0k2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': elevenLabsKey
          },
          body: JSON.stringify({
            text: 'Hello, this is a test',
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        })
        
        if (!ttsResponse.ok) {
          console.error('[Minimal] ElevenLabs error:', ttsResponse.status)
          return
        }
        
        // Get complete audio as ArrayBuffer
        const audioData = await ttsResponse.arrayBuffer()
        console.log(`[Minimal] Received ${audioData.byteLength} bytes from ElevenLabs`)
        
        // For now, just play more test tones to verify
        console.log('[Minimal] Playing verification tones instead of TTS')
        for (let freq = 500; freq <= 700; freq += 100) {
          for (let frameIndex = 0; frameIndex < 20; frameIndex++) {
            const frame = new Uint8Array(160)
            for (let i = 0; i < 160; i++) {
              const time = (frameIndex * 160 + i) / 8000
              const amplitude = Math.sin(2 * Math.PI * freq * time)
              const pcm16 = Math.floor(amplitude * 8192)
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
        }
        
        console.log('[Minimal] Complete')
      }
    } catch (error) {
      console.error('[Minimal] Error:', error)
    }
  }
  
  socket.onclose = () => {
    console.log('[Minimal] Closed')
  }
  
  return response
})