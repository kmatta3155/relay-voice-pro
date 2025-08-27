import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

// Version for tracking deployments
const VERSION = 'convai-stream@2025-08-27-01'

// Standard G.711 μ-law encoding
function pcmToMulaw(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  
  let sign = 0
  if (sample < 0) {
    sign = 0x80
    sample = -sample
  }
  if (sample > CLIP) sample = CLIP
  
  sample = sample + BIAS
  
  let exponent = 7
  let expMask = 0x4000
  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--
    expMask >>= 1
  }
  
  const mantissaShift = (exponent === 0) ? 4 : (exponent + 3)
  const mantissa = (sample >> mantissaShift) & 0x0f
  
  return (~(sign | (exponent << 4) | mantissa)) & 0xff
}

function mulawToPcm(mu: number): number {
  mu = (~mu) & 0xff
  const sign = mu & 0x80
  const exponent = (mu >> 4) & 0x07
  const mantissa = mu & 0x0f
  const sample = ((mantissa << 3) + 0x84) << (exponent + 3)
  return sign ? (0x84 - sample) : (sample - 0x84)
}

// Convert Twilio μ-law 8kHz to PCM16 16kHz for ElevenLabs agent
function convertMulawToPcm16(mulawData: Uint8Array): Uint8Array {
  // Step 1: Convert μ-law to PCM16 at 8kHz
  const pcm8k = new Int16Array(mulawData.length)
  for (let i = 0; i < mulawData.length; i++) {
    pcm8k[i] = mulawToPcm(mulawData[i])
  }
  
  // Step 2: Upsample from 8kHz to 16kHz (2:1 interpolation)
  const pcm16k = new Int16Array(pcm8k.length * 2)
  for (let i = 0; i < pcm8k.length; i++) {
    const sample = pcm8k[i]
    pcm16k[i * 2] = sample
    // Linear interpolation for smoother upsampling
    pcm16k[i * 2 + 1] = i < pcm8k.length - 1 ? 
      Math.round((sample + pcm8k[i + 1]) / 2) : sample
  }
  
  // Step 3: Convert to bytes (little-endian)
  const bytes = new Uint8Array(pcm16k.length * 2)
  for (let i = 0; i < pcm16k.length; i++) {
    const sample = pcm16k[i]
    bytes[i * 2] = sample & 0xff
    bytes[i * 2 + 1] = (sample >> 8) & 0xff
  }
  
  return bytes
}

// Outbound audio queue for strict 20ms pacing
const twilioOutboundQueue: Uint8Array[] = []
let twilioIsSending = false

async function sendAudioToTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  // Add all chunks to queue
  for (const chunk of chunks) {
    twilioOutboundQueue.push(chunk)
  }
  
  // Start sender loop if not already running
  if (!twilioIsSending && socket.readyState === WebSocket.OPEN) {
    twilioIsSending = true
    console.log(`📦 Starting outbound queue with ${twilioOutboundQueue.length} chunks`)
    
    try {
      while (twilioOutboundQueue.length > 0 && socket.readyState === WebSocket.OPEN) {
        const chunk = twilioOutboundQueue.shift()!
        
        if (chunk.length !== 160) {
          console.warn(`⚠️ Chunk size mismatch: ${chunk.length} bytes (expected 160)`)
        }
        
        // Binary-safe base64 encoding
        let binary = ''
        for (let j = 0; j < chunk.length; j++) {
          binary += String.fromCharCode(chunk[j])
        }
        const base64Payload = btoa(binary)
        
        // Twilio-compliant outbound message with track specification
        const message = {
          event: 'media',
          streamSid,
          media: { 
            payload: base64Payload,
            track: 'outbound'
          }
        }
        
        socket.send(JSON.stringify(message))
        
        // Precise 20ms pacing for 8kHz μ-law
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    } catch (e) {
      console.error('❌ Error in outbound queue:', e)
    } finally {
      twilioIsSending = false
      console.log('✅ Outbound queue completed')
    }
  }
}

// Wait until the outbound queue fully drains
async function waitForQueueDrain(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now()
  while (twilioIsSending || twilioOutboundQueue.length > 0) {
    if (Date.now() - start > timeoutMs) {
      console.warn(`⏳ Queue drain timeout after ${timeoutMs}ms (remaining: ${twilioOutboundQueue.length})`)
      return false
    }
    await new Promise(r => setTimeout(r, 25))
  }
  console.log('🟢 Outbound queue fully drained')
  return true
}

// Generate reliable TTS greeting with direct ulaw_8000 format
async function sendReliableGreeting(streamSid: string, socket: WebSocket, businessName: string) {
  try {
    console.log('🎯 Generating reliable TTS greeting...')
    const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!elevenLabsKey) {
      console.error('❌ ELEVENLABS_API_KEY missing for greeting')
      return
    }
    
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') || '9BWtsMINqrJLrRacOk9x'
    const text = `Hello! Thank you for calling ${businessName}. How can I help you today?`
    
    console.log('🗣️ Requesting ulaw_8000 format directly from ElevenLabs TTS...')
    console.log(`📝 Text: "${text}"`)
    
    // Request ulaw_8000 directly to avoid conversion issues
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        'Content-Type': 'application/json',
        'Accept': 'application/octet-stream'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        output_format: 'ulaw_8000'  // Direct μ-law 8kHz output
      })
    })
    
    console.log(`📡 TTS response status: ${resp.status}`)
    if (!resp.ok) {
      const err = await resp.text()
      console.error('❌ TTS greeting failed:', resp.status, err)
      return
    }
    
    const audioBuffer = await resp.arrayBuffer()
    const ulawBytes = new Uint8Array(audioBuffer)
    console.log(`🎼 Received ${ulawBytes.length} μ-law bytes directly`)
    
    // Chunk into 160-byte frames for Twilio
    const chunks: Uint8Array[] = []
    for (let i = 0; i < ulawBytes.length; i += 160) {
      const chunk = new Uint8Array(160)
      const len = Math.min(160, ulawBytes.length - i)
      chunk.set(ulawBytes.subarray(i, i + len), 0)
      // Pad with μ-law silence if needed
      if (len < 160) {
        for (let j = len; j < 160; j++) chunk[j] = 0xff
      }
      chunks.push(chunk)
    }
    
    console.log(`📦 Created ${chunks.length} greeting chunks`)
    await sendAudioToTwilio(chunks, streamSid, socket)
    console.log('✅ Reliable greeting sent to Twilio')
    
  } catch (e) {
    console.error('❌ Error in reliable greeting:', e)
  }
}

// Get signed URL for ElevenLabs Conversational AI
async function getSignedConvAIUrl(agentId: string, apiKey: string): Promise<string | null> {
  try {
    console.log('🔗 Requesting signed URL for ConvAI agent...')
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      }
    )
    
    if (!response.ok) {
      const error = await response.text()
      console.error('❌ Failed to get signed URL:', response.status, error)
      return null
    }
    
    const data = await response.json()
    console.log('✅ Got signed URL for ConvAI')
    return data.signed_url
  } catch (e) {
    console.error('❌ Error getting signed URL:', e)
    return null
  }
}

serve(async (req) => {
  console.log(`🎵 TWILIO CONVERSATIONAL AI STREAM - ${VERSION}`)
  console.log('📍 Checking WebSocket upgrade...')
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected Websocket', { status: 426 })
  }
  
  const protocolHeader = req.headers.get('sec-websocket-protocol') || ''
  const protocols = protocolHeader.split(',').map(p => p.trim()).filter(Boolean)
  const { socket, response } = Deno.upgradeWebSocket(
    req,
    protocols.length ? { protocol: protocols[0] } : {}
  )
  
  let streamSid = ''
  let phoneNumber = ''
  let tenantId = ''
  let businessName = ''
  let elevenLabsWs: WebSocket | null = null
  let elevenLabsConnected = false
  let conversationStarted = false
  
  socket.onopen = () => {
    console.log('🔌 WebSocket connected to Twilio')
  }
  
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('📨 Twilio event:', data.event)
      
      if (data.event === 'start') {
        console.log('🚀 Stream started - initializing ConvAI connection')
        streamSid = data.streamSid
        phoneNumber = data.start?.customParameters?.phoneNumber || 'unknown'
        tenantId = data.start?.customParameters?.tenantId || ''
        businessName = data.start?.customParameters?.businessName || 'this business'
        
        console.log(`📞 Call: Phone=${phoneNumber}, Tenant=${tenantId}, Business=${businessName}`)
        
        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
        const agentId = Deno.env.get('ELEVENLABS_AGENT_ID')
        
        console.log(`🔑 ElevenLabs Key: ${!!elevenLabsKey}, Agent ID: ${!!agentId}`)
        
        if (!elevenLabsKey || !agentId) {
          console.error('❌ Missing ElevenLabs credentials')
          return
        }
        
        // Step 1: Send immediate reliable greeting
        console.log('🎤 Sending immediate greeting...')
        await sendReliableGreeting(streamSid, socket, businessName)
        
        // Step 2: Wait for greeting to complete
        await waitForQueueDrain(10000)
        
        // Step 3: Connect to ElevenLabs Conversational AI
        console.log('🤖 Connecting to ElevenLabs Conversational AI...')
        const signedUrl = await getSignedConvAIUrl(agentId, elevenLabsKey)
        
        if (!signedUrl) {
          console.error('❌ Failed to get ConvAI signed URL')
          return
        }
        
        try {
          elevenLabsWs = new WebSocket(signedUrl)
          
          elevenLabsWs.onopen = () => {
            console.log('✅ ConvAI WebSocket connected')
            elevenLabsConnected = true
            
            // Configure conversation for ulaw_8000 output
            if (elevenLabsWs) {
              elevenLabsWs.send(JSON.stringify({
                type: 'conversation_initiation_metadata',
                conversation_config_override: {
                  audio_output: {
                    format: 'ulaw_8000',
                    output_format: 'ulaw_8000'
                  }
                }
              }))
              console.log('📤 Sent ConvAI config for ulaw_8000 output')
            }
          }
          
          elevenLabsWs.onmessage = async (convaiEvent) => {
            try {
              const convaiData = JSON.parse(convaiEvent.data)
              
              if (convaiData.type === 'audio') {
                // Agent audio response - should be ulaw_8000 format
                const audioBase64 = convaiData.audio_event?.audio_base_64
                if (audioBase64) {
                  console.log(`🎵 Received ConvAI audio: ${audioBase64.length} base64 chars`)
                  
                  // Decode from base64
                  const binaryString = atob(audioBase64)
                  const ulawBytes = new Uint8Array(binaryString.length)
                  for (let i = 0; i < binaryString.length; i++) {
                    ulawBytes[i] = binaryString.charCodeAt(i)
                  }
                  
                  // Chunk and send to Twilio
                  const chunks: Uint8Array[] = []
                  for (let i = 0; i < ulawBytes.length; i += 160) {
                    const chunk = new Uint8Array(160)
                    const len = Math.min(160, ulawBytes.length - i)
                    chunk.set(ulawBytes.subarray(i, i + len), 0)
                    if (len < 160) {
                      for (let j = len; j < 160; j++) chunk[j] = 0xff
                    }
                    chunks.push(chunk)
                  }
                  
                  await sendAudioToTwilio(chunks, streamSid, socket)
                  console.log(`📦 Forwarded ${chunks.length} ConvAI audio chunks to Twilio`)
                }
              } else if (convaiData.type === 'conversation_started') {
                console.log('✅ ConvAI conversation started')
                conversationStarted = true
              } else {
                console.log(`📋 ConvAI event: ${convaiData.type}`)
              }
            } catch (parseError) {
              console.error('❌ Error parsing ConvAI message:', parseError)
            }
          }
          
          elevenLabsWs.onerror = (error) => {
            console.error('❌ ConvAI WebSocket error:', error)
            elevenLabsConnected = false
          }
          
          elevenLabsWs.onclose = (event) => {
            console.log(`🔌 ConvAI WebSocket closed: ${event.code} ${event.reason}`)
            elevenLabsConnected = false
          }
          
        } catch (wsError) {
          console.error('❌ Failed to create ConvAI WebSocket:', wsError)
        }
      }
      
      else if (data.event === 'media' && data.media?.payload) {
        // Incoming audio from caller - forward to ConvAI agent
        if (elevenLabsConnected && conversationStarted && elevenLabsWs) {
          try {
            // Decode μ-law audio from Twilio
            const binaryString = atob(data.media.payload)
            const mulawBytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              mulawBytes[i] = binaryString.charCodeAt(i)
            }
            
            // Convert μ-law 8kHz to PCM16 16kHz for ConvAI
            const pcm16Bytes = convertMulawToPcm16(mulawBytes)
            
            // Encode to base64 and send to ConvAI
            let binary = ''
            for (let i = 0; i < pcm16Bytes.length; i++) {
              binary += String.fromCharCode(pcm16Bytes[i])
            }
            const audioBase64 = btoa(binary)
            
            elevenLabsWs.send(JSON.stringify({
              type: 'user_audio_chunk',
              chunk: audioBase64
            }))
            
            // Log occasionally to avoid spam
            if (Math.random() < 0.01) {
              console.log(`🎤 Forwarded ${mulawBytes.length}→${pcm16Bytes.length} bytes to ConvAI`)
            }
          } catch (audioError) {
            console.error('❌ Error forwarding audio to ConvAI:', audioError)
          }
        }
      }
      
      else if (data.event === 'stop') {
        console.log('🛑 Stream stopped')
        if (elevenLabsWs) {
          elevenLabsWs.close()
          elevenLabsWs = null
        }
        elevenLabsConnected = false
        conversationStarted = false
      }
      
    } catch (error) {
      console.error('❌ Error processing Twilio event:', error)
    }
  }
  
  socket.onerror = (error) => {
    console.error('❌ Twilio WebSocket error:', error)
  }
  
  socket.onclose = (event) => {
    console.log(`🔌 Twilio WebSocket closed: ${event.code} ${event.reason}`)
    if (elevenLabsWs) {
      elevenLabsWs.close()
      elevenLabsWs = null
    }
    elevenLabsConnected = false
    conversationStarted = false
  }
  
  return response
})