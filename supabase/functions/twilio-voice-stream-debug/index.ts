import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = { 
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Simple test tone generation for debugging
function generateTestTone(frameIndex: number): Uint8Array {
  const frame = new Uint8Array(160) // μ-law frame size
  
  for (let i = 0; i < 160; i++) {
    const time = (frameIndex * 160 + i) / 8000
    const amplitude = Math.sin(2 * Math.PI * 440 * time) // 440Hz tone
    const pcm16 = Math.floor(amplitude * 16384)
    frame[i] = pcmToMulaw(pcm16)
  }
  
  return frame
}

function pcmToMulaw(sample: number): number {
  const sign = (sample >> 8) & 0x80
  if (sign) sample = -sample
  if (sample > 32635) sample = 32635
  
  let exponent = 7
  let expMask = 0x4000
  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--
    expMask >>= 1
  }
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F
  return ~(sign | (exponent << 4) | mantissa)
}

class SimpleVoiceSession {
  private ws: WebSocket
  private frameCount = 0
  private streamSid = ''
  
  constructor(websocket: WebSocket) {
    this.ws = websocket
    this.setupHandlers()
  }
  
  private setupHandlers() {
    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('Received message:', message.event)
        
        switch (message.event) {
          case 'start':
            this.streamSid = message.start.streamSid
            console.log('Stream started:', this.streamSid)
            
            // Send warmup silence
            for (let i = 0; i < 10; i++) {
              await this.sendFrame(new Uint8Array(160).fill(0xFF))
            }
            
            // Send test tone
            for (let i = 0; i < 100; i++) {
              const frame = generateTestTone(i)
              await this.sendFrame(frame)
            }
            break
            
          case 'media':
            // Just log received audio
            break
            
          case 'stop':
            console.log('Stream stopped')
            this.ws.close()
            break
        }
      } catch (error) {
        console.error('Message handling error:', error)
      }
    }
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
    
    this.ws.onclose = () => {
      console.log('WebSocket closed')
    }
  }
  
  private async sendFrame(frame: Uint8Array) {
    const payload = btoa(String.fromCharCode(...frame))
    
    const message = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        track: 'outbound',
        payload: payload
      }
    }
    
    this.ws.send(JSON.stringify(message))
    
    // 20ms pacing
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

serve(async (req) => {
  try {
    // Handle CORS
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    
    // Health check (no auth required)
    const url = new URL(req.url)
    if (url.searchParams.get('health') === '1') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        version: 'debug-v1',
        timestamp: new Date().toISOString()
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }
    
    // Handle WebSocket upgrade
    if (req.headers.get('upgrade') !== 'websocket') {
      console.log('Non-WebSocket request received')
      return new Response('Expected WebSocket', { status: 400 })
    }
    
    console.log('🎙️ Starting debug voice session')
    
    const { socket, response } = Deno.upgradeWebSocket(req)
    
    socket.onopen = () => {
      console.log('✅ Debug WebSocket connection established')
      new SimpleVoiceSession(socket)
    }
    
    socket.onerror = (error) => {
      console.error('❌ WebSocket error in main handler:', error)
    }
    
    return response
    
  } catch (error) {
    console.error('🚨 Function error:', error)
    return new Response(`Function error: ${error.message}`, { 
      status: 500,
      headers: corsHeaders 
    })
  }
})