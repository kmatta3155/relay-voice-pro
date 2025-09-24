/*
 * Minimal Twilio Voice Stream - Test Tone Generator
 * Sends a 440Hz test tone to verify audio pipeline
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Audio constants
const SAMPLE_RATE = 8000
const FRAME_SIZE = 160 // μ-law: 160 bytes per 20ms at 8kHz

// μ-law encoding function
function pcmToMulaw(pcm16: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  
  // Get sign bit
  let sign = 0
  if (pcm16 < 0) {
    sign = 0x80
    pcm16 = -pcm16
  }
  
  // Clip if necessary
  if (pcm16 > CLIP) {
    pcm16 = CLIP
  }
  
  // Add bias
  pcm16 += BIAS
  
  // Find exponent and mantissa
  let exponent = 7
  let mask = 0x4000
  
  while ((pcm16 & mask) === 0 && exponent > 0) {
    exponent--
    mask >>= 1
  }
  
  // Extract mantissa (4 bits)
  const mantissa = (pcm16 >> (exponent + 3)) & 0x0F
  
  // Combine and invert
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xFF
  
  return mulaw
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { 
      status: 405,
      headers: corsHeaders 
    })
  }
  
  // Upgrade to WebSocket
  const upgrade = req.headers.get('upgrade')
  if (!upgrade || upgrade !== 'websocket') {
    return new Response('Expected websocket', { 
      status: 426,
      headers: corsHeaders 
    })
  }
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  // Session state
  let streamSid: string = ''
  let isConnected = false
  
  // Send a single frame helper
  async function sendFrame(frame: Uint8Array) {
    if (!streamSid || socket.readyState !== 1) {
      return
    }
    
    const payload = btoa(String.fromCharCode(...frame))
    const message = {
      event: 'media',
      streamSid: streamSid,
      media: { payload: payload }
    }
    
    socket.send(JSON.stringify(message))
    await new Promise(resolve => setTimeout(resolve, 20)) // Pace at 20ms
  }
  
  // Send test tone
  async function sendTestTone() {
    console.log('Sending test tone')
    
    // Send 10 silence frames first to prime the buffer
    for (let i = 0; i < 10; i++) {
      const silence = new Uint8Array(160).fill(0xFF) // μ-law silence
      await sendFrame(silence)
    }
    
    // Then send 2 seconds of 440Hz tone
    let globalSampleIndex = 0
    for (let frameNum = 0; frameNum < 100; frameNum++) { // 100 frames = 2 seconds
      const frame = new Uint8Array(160)
      
      for (let i = 0; i < 160; i++) {
        const t = globalSampleIndex / SAMPLE_RATE
        const amplitude = Math.sin(2 * Math.PI * 440 * t)
        const pcm16 = Math.floor(amplitude * 16384)
        frame[i] = pcmToMulaw(pcm16)
        globalSampleIndex++
      }
      
      await sendFrame(frame)
    }
    
    // Send a few more silence frames at the end
    for (let i = 0; i < 5; i++) {
      const silence = new Uint8Array(160).fill(0xFF)
      await sendFrame(silence)
    }
    
    console.log('Test tone complete')
  }
  
  // WebSocket handlers
  socket.onopen = () => {
    console.log('WebSocket connected')
    isConnected = true
  }
  
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data)
      
      switch (message.event) {
        case 'connected':
          console.log('Connected to Twilio')
          // Just wait for start event
          break
          
        case 'start':
          // Capture streamSid and send test tone
          streamSid = message.start?.streamSid || ''
          console.log('Start received, streamSid:', streamSid)
          
          if (streamSid) {
            // Send test tone immediately after start
            await sendTestTone()
          } else {
            console.error('No streamSid in start event')
          }
          break
          
        case 'media':
          // Ignore inbound audio for now
          break
          
        case 'stop':
          console.log('Call ended')
          socket.close()
          break
          
        default:
          console.log('Unknown event:', message.event)
      }
    } catch (error) {
      console.error('Error processing message:', error)
    }
  }
  
  socket.onclose = () => {
    console.log('WebSocket closed')
    isConnected = false
  }
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error)
  }
  
  return response
})