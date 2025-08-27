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

// Version banner for debugging deployments
const VERSION = 'twilio-voice-stream@2025-08-26-01'

// Audio buffer to accumulate incoming audio
class AudioBuffer {
  private chunks: Uint8Array[] = []
  private lastProcessTime = Date.now()
  private lastChunkTime = 0
  
  addChunk(audioData: Uint8Array) {
    this.chunks.push(audioData)
    this.lastChunkTime = Date.now()
  }
  
  size(): number {
    return this.chunks.length
  }
  
  shouldProcess(): boolean {
    const now = Date.now()
    const timeElapsed = now - this.lastProcessTime >= 500
    const silenceElapsed = this.chunks.length > 0 && now - this.lastChunkTime >= 500
    const haveMinChunks = this.chunks.length >= 12
    return (haveMinChunks && timeElapsed) || silenceElapsed
  }
  
  getAndClear(): Uint8Array {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    
    this.chunks = []
    this.lastProcessTime = Date.now()
    return combined
  }
}

// Standard G.711 μ-law encoding (proper implementation)
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
  
  // Find the exponent and mantissa
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

// CRITICAL FIX: ElevenLabs Conversational AI outputs 16kHz PCM16 to Twilio 8kHz μ-law
function processElevenLabsAudioToMulaw(audioData: Uint8Array): Uint8Array[] {
  console.log(`🎧 Processing ${audioData.length} bytes from ElevenLabs`)
  
  // CRITICAL CORRECTION: ElevenLabs Conversational AI outputs PCM16 at 16kHz (not 24kHz!)
  const pcm16Samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2)
  console.log(`🎵 Got ${pcm16Samples.length} PCM16 samples at 16kHz`)
  
  // Validate minimum samples
  if (pcm16Samples.length < 2) {
    console.warn(`⚠️ Insufficient samples for 16kHz→8kHz conversion: ${pcm16Samples.length}`)
    return []
  }
  
  // Step 1: Apply proper anti-aliasing filter for 16kHz→8kHz (2:1 decimation)
  // Low-pass filter with 3.4kHz cutoff (below 4kHz Nyquist for 8kHz output)
  const filteredSamples = new Float32Array(pcm16Samples.length)
  
  // Simple but effective low-pass filter for 2:1 decimation
  // Coefficients for 3.4kHz cutoff at 16kHz sample rate
  const a = 0.25 // Higher cutoff frequency for 16kHz input
  filteredSamples[0] = pcm16Samples[0]
  
  for (let i = 1; i < pcm16Samples.length; i++) {
    // IIR low-pass filter
    filteredSamples[i] = a * pcm16Samples[i] + (1 - a) * filteredSamples[i - 1]
  }
  
  // Step 2: Downsample from 16kHz to 8kHz (2:1 ratio)
  const targetLen = Math.floor(filteredSamples.length / 2)
  const pcm8kSamples = new Int16Array(targetLen)
  
  for (let i = 0; i < targetLen; i++) {
    const idx = i * 2
    // Take every 2nd sample from filtered data (proper 2:1 decimation)
    const sample = Math.round(filteredSamples[idx])
    // Clamp to 16-bit signed integer range
    pcm8kSamples[i] = Math.max(-32768, Math.min(32767, sample))
  }
  
  console.log(`🎵 Properly downsampled to ${pcm8kSamples.length} samples at 8kHz`)
  
  // Step 3: Convert to μ-law in exact 160-sample chunks (20ms @ 8kHz)
  const chunks: Uint8Array[] = []
  const samplesPerChunk = 160
  
  for (let i = 0; i < pcm8kSamples.length; i += samplesPerChunk) {
    const chunk = new Uint8Array(samplesPerChunk)
    
    for (let j = 0; j < samplesPerChunk; j++) {
      const sampleIndex = i + j
      if (sampleIndex < pcm8kSamples.length) {
        chunk[j] = pcmToMulaw(pcm8kSamples[sampleIndex])
      } else {
        // Pad with μ-law digital silence (0xFF)
        chunk[j] = 0xFF
      }
    }
    
    chunks.push(chunk)
  }
  
  console.log(`📦 Created ${chunks.length} clean μ-law chunks (160 bytes each)`)
  return chunks
}

// --- Container detection & helpers to prevent static ---
function detectAudioContainer(bytes: Uint8Array): 'wav' | 'mp3' | 'ogg' | 'raw' {
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    return 'wav'
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'mp3'
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'mp3'
  }
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'ogg'
  }
  return 'raw'
}

function stripWavHeader(bytes: Uint8Array): Uint8Array {
  // Try to locate the 'data' chunk and return its payload
  for (let i = 12; i < bytes.length - 8; i++) {
    if (bytes[i] === 0x64 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61) {
      const dataSize = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)
      const start = i + 8
      return bytes.subarray(start, Math.min(start + dataSize, bytes.length))
    }
  }
  // Fallback to typical 44-byte header
  return bytes.subarray(44)
}

function chunkMulawFrames(mulaw: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < mulaw.length; i += 160) {
    const frame = new Uint8Array(160)
    const len = Math.min(160, mulaw.length - i)
    frame.set(mulaw.subarray(i, i + len), 0)
    if (len < 160) {
      for (let j = len; j < 160; j++) frame[j] = 0xff // μ-law digital silence
    }
    chunks.push(frame)
  }
  return chunks
}

// Generate μ-law 8kHz sine tone chunks for diagnostics (20ms per chunk)
function generateMulawSineWaveChunks(durationMs: number, frequencyHz = 1000, amplitude = 10000): Uint8Array[] {
  const sampleRate = 8000;
  const totalSamples = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));
  const samplesPerChunk = 160; // 20ms @ 8kHz
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < totalSamples; i += samplesPerChunk) {
    const chunk = new Uint8Array(samplesPerChunk);
    for (let j = 0; j < samplesPerChunk; j++) {
      const t = (i + j) / sampleRate;
      const s = Math.sin(2 * Math.PI * frequencyHz * t);
      const pcm = Math.max(-32768, Math.min(32767, Math.round(s * amplitude)));
      chunk[j] = pcmToMulaw(pcm);
    }
    chunks.push(chunk);
  }
  return chunks;
}

// Outbound queue for strict 20ms pacing (prevents overlapping audio)
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
          console.warn(`⚠️ Chunk has incorrect size: ${chunk.length} bytes (expected 160)`)
        }
        
        // Binary-safe base64 encoding
        let binary = ''
        for (let j = 0; j < chunk.length; j++) {
          binary += String.fromCharCode(chunk[j])
        }
        const base64Payload = btoa(binary)
        
        // CRITICAL: Twilio-compliant outbound frame (payload only)
        const message = {
          event: 'media',
          streamSid,
          media: { payload: base64Payload }
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

// Simplified enqueue function (queue is now handled in sendAudioToTwilio)
async function enqueueTwilioChunks(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  await sendAudioToTwilio(chunks, streamSid, socket)
}

// Wait until the outbound queue fully drains (or timeout)
async function waitForQueueDrain(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now()
  while (twilioIsSending || twilioOutboundQueue.length > 0) {
    if (Date.now() - start > timeoutMs) {
      console.warn(`⏳ waitForQueueDrain timed out after ${timeoutMs}ms (remaining: ${twilioOutboundQueue.length})`)
      return false
    }
    await new Promise(r => setTimeout(r, 25))
  }
  console.log('🟢 Outbound queue fully drained')
  return true
}

// Create WAV from μ-law for Whisper
function createWavFromMulaw(mulawData: Uint8Array): Uint8Array {
  const pcmData = new Int16Array(mulawData.length)
  for (let i = 0; i < mulawData.length; i++) {
    pcmData[i] = mulawToPcm(mulawData[i])
  }

  const wavHeader = new ArrayBuffer(44)
  const view = new DataView(wavHeader)
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  const sampleRate = 8000
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcmData.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, pcmData.byteLength, true)

  const wavArray = new Uint8Array(wavHeader.byteLength + pcmData.byteLength)
  wavArray.set(new Uint8Array(wavHeader), 0)
  wavArray.set(new Uint8Array(pcmData.buffer), wavHeader.byteLength)
  
  return wavArray
}

async function processAudioWithWhisper(audioData: Uint8Array): Promise<string> {
  try {
    console.log('👂 Processing audio with Whisper, data size:', audioData.length)
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('❌ OPENAI_API_KEY not found for Whisper')
      return ''
    }

    const wavData = createWavFromMulaw(audioData)
    console.log('🔄 Converted to WAV, size:', wavData.length)
    
    const formData = new FormData()
    const blob = new Blob([wavData], { type: 'audio/wav' })
    formData.append('file', blob, 'audio.wav')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')

    console.log('📤 Sending to Whisper API...')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: formData,
    })

    console.log('📥 Whisper response status:', response.status)
    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Whisper API failed:', response.status, errorText)
      throw new Error(`Whisper API failed: ${errorText}`)
    }

    const result = await response.json()
    console.log('✅ Whisper result:', result)
    return result.text || ''
  } catch (error) {
    console.error('❌ Error with Whisper:', error)
    return ''
  }
}

// Send an immediate fallback greeting via ElevenLabs TTS (PCM16 16k -> μ-law 8k)
async function sendImmediateGreeting(streamSid: string, socket: WebSocket, businessName: string) {
  try {
    console.log('🎯 Starting immediate greeting generation...')
    const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!elevenLabsKey) {
      console.error('❌ ELEVENLABS_API_KEY missing for TTS greeting')
      return
    }
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') || '9BWtsMINqrJLrRacOk9x' // Aria
    const text = `Hello! Thank you for calling ${businessName}. How can I help you today?`

    console.log('🗣️ Generating TTS greeting (PCM16 16k → μ-law 8k) with ElevenLabs...')
    console.log(`🎤 Voice ID: ${voiceId}`)
    console.log(`📝 Text: "${text}"`)
    
    // Use PCM16 16kHz format (proven to work) then convert to μ-law 8kHz
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
        output_format: 'pcm_16000' // Force PCM16 16kHz for reliable conversion
      })
    })

    console.log(`📡 ElevenLabs TTS response status: ${resp.status}`)
    if (!resp.ok) {
      const err = await resp.text()
      console.error('❌ TTS greeting failed:', resp.status, err)
      return
    }

    const audioBuffer = await resp.arrayBuffer()
    const pcm16kBytes = new Uint8Array(audioBuffer)
    console.log('🎼 TTS greeting PCM16 bytes received:', pcm16kBytes.length)
    
    // Use the proven processElevenLabsAudioToMulaw function for consistent results
    const chunks = processElevenLabsAudioToMulaw(pcm16kBytes)
    
    await enqueueTwilioChunks(chunks, streamSid, socket)
    console.log('✅ TTS greeting sent to Twilio via proven conversion pipeline')
  } catch (e) {
    console.error('❌ Error sending TTS greeting:', e)
  }
}

serve(async (req) => {
  console.log(`🎵 TWILIO VOICE STREAM - ${VERSION}`)
  console.log('📍 Request received, checking WebSocket upgrade...')
  const debugTone = (Deno.env.get('TWILIO_DEBUG_TONE') || '').toLowerCase() === 'true'
  const echoMode = (Deno.env.get('TWILIO_ECHO') || '').toLowerCase() === 'true'
  console.log(`🧪 Debug tone mode: ${debugTone} | Echo mode: ${echoMode}`)
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected Websocket', { status: 426 })
  }
  const protocols = req.headers.get('sec-websocket-protocol') || ''
  const protocol = protocols ? protocols.split(',')[0].trim() : undefined
  const { socket, response } = Deno.upgradeWebSocket(req, protocol ? { protocol } : {})
  const buffer = new AudioBuffer()
  let streamSid = ''
  let phoneNumber = ''
  let tenantId = ''
  let businessName = ''
  let elevenLabsWs: WebSocket | null = null
  let elevenLabsConnected = false
  // Track expected ConvAI output encoding for correct processing
  let convaiOutputEncoding: 'pcm_16000' | 'ulaw_8000' = 'pcm_16000'
  let convaiOutputSampleRate = 16000
  socket.onopen = () => {
    console.log('🔌 WebSocket connected to Twilio')
  }

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('📨 Parsed event type:', data.event)

      if (data.event === 'start') {
        console.log('🚀 Stream started - initializing ElevenLabs connection')
        streamSid = data.streamSid
        phoneNumber = data.start?.customParameters?.phoneNumber || 'unknown'
        tenantId = data.start?.customParameters?.tenantId || ''
        businessName = data.start?.customParameters?.businessName || 'this business'
        
        console.log(`📞 Call details: Phone=${phoneNumber}, Tenant=${tenantId}, Business=${businessName}`)
        console.log('🔑 Checking environment variables...')
        
        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
        const agentId = Deno.env.get('ELEVENLABS_AGENT_ID')
        const openaiKey = Deno.env.get('OPENAI_API_KEY')
        
        console.log(`🔑 ElevenLabs Key present: ${!!elevenLabsKey}`)
        console.log(`🤖 Agent ID present: ${!!agentId}`)
        console.log(`🧠 OpenAI Key present: ${!!openaiKey}`)
        
        if (!elevenLabsKey) {
          console.error('❌ ELEVENLABS_API_KEY not found - cannot connect to ElevenLabs')
          return
        }
        if (!agentId) {
          console.error('❌ ELEVENLABS_AGENT_ID not set - cannot use ConvAI; sending greeting only')
          await sendImmediateGreeting(streamSid, socket, businessName)
          return
        }
        // Diagnostic: play a known-good tone directly to Twilio and skip agent connection
        if (debugTone) {
          console.log('🧪 Debug tone mode enabled - sending 3s 1kHz tone to Twilio and skipping agent.')
          const toneChunks = generateMulawSineWaveChunks(3000, 1000)
          await enqueueTwilioChunks(toneChunks, streamSid, socket)
          console.log('✅ Debug tone sent. Awaiting stop event.')
          return
        }

        // Optional: Greeting-only mode to isolate Twilio playback
        const greetingOnly = (Deno.env.get('TWILIO_GREETING_ONLY') || 'false').toLowerCase() === 'true'
        if (greetingOnly) {
          console.log('🧪 Greeting-only mode enabled - sending greeting and skipping agent.')
          await sendImmediateGreeting(streamSid, socket, businessName)
          return
        }
        // Check if we should use agent audio or fallback to HTTP TTS only
        const useAgentAudio = (Deno.env.get('TWILIO_USE_AGENT_AUDIO') || 'true').toLowerCase() === 'true'
        if (!useAgentAudio) {
          console.log('🔄 Agent audio disabled - using HTTP TTS fallback only')
          await sendImmediateGreeting(streamSid, socket, businessName)
          return
        }

        // Send immediate greeting while ElevenLabs streaming connects
        await sendImmediateGreeting(streamSid, socket, businessName)
        // Ensure no overlap: wait for greeting queue to drain before streaming
        await waitForQueueDrain(5000)

        console.log('🔗 Connecting to ElevenLabs Streaming API for direct μ-law passthrough...')
        try {
          const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL' // Sarah
          const streamingUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`
          
          console.log(`🔗 Connecting to: ${streamingUrl}`)
          
          elevenLabsWs = new WebSocket(streamingUrl, {
            headers: {
              'xi-api-key': elevenLabsKey,
            }
          })

          elevenLabsWs.onopen = () => {
            console.log('✅ ElevenLabs Streaming API connected successfully')
            elevenLabsConnected = true
            
            // Send initial configuration for streaming mode
            const config = {
              text: " ", // Empty initial text to start the stream
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true
              },
              generation_config: {
                chunk_length_schedule: [120, 160, 250, 290]
              }
            }
            
            elevenLabsWs!.send(JSON.stringify(config))
            convaiOutputEncoding = 'ulaw_8000'
            convaiOutputSampleRate = 8000
            console.log('📤 Sent streaming config to ElevenLabs: μ-law 8kHz direct output')
            
            // Greeting is already handled via immediate TTS; streaming will handle replies
            console.log('ℹ️ Greeting handled via immediate TTS; streaming will handle replies.')
          }

          elevenLabsWs.onmessage = async (message) => {
            try {
              if (typeof message.data === 'string') {
                const data = JSON.parse(message.data)
                console.log('🎵 ElevenLabs streaming message type:', data.type || 'unknown')

                if (data.audio) {
                  // Direct μ-law audio from ElevenLabs streaming API
                  const audioBase64 = data.audio
                  console.log(`🔊 Received μ-law audio chunk: ${audioBase64.length} base64 chars`)
                  
                  // Decode base64 to μ-law bytes
                  const binaryString = atob(audioBase64)
                  const audioBytes = new Uint8Array(binaryString.length)
                  for (let i = 0; i < binaryString.length; i++) {
                    audioBytes[i] = binaryString.charCodeAt(i)
                  }
                  
                  // Convert to 160-byte chunks for Twilio
                  const chunks = chunkMulawFrames(audioBytes)
                  console.log(`🎯 Direct μ-law passthrough: ${chunks.length} chunks (${audioBytes.length} bytes)`)
                  await enqueueTwilioChunks(chunks, streamSid, socket)
                } else if (data.type === 'response') {
                  console.log('🎤 ElevenLabs response:', data.response)
                } else if (data.type === 'end') {
                  console.log('✅ ElevenLabs stream ended')
                } else {
                  console.log('📋 Other ElevenLabs streaming event:', JSON.stringify(data))
                }
              } else {
                // Handle binary audio data
                console.log(`🔊 Received binary μ-law audio: ${message.data.byteLength} bytes`)
                const audioBytes = new Uint8Array(message.data)
                const chunks = chunkMulawFrames(audioBytes)
                await enqueueTwilioChunks(chunks, streamSid, socket)
              }
            } catch (error) {
              console.error('❌ Error processing ElevenLabs streaming message:', error)
            }
          }

          elevenLabsWs.onerror = (error) => {
            console.error('❌ ElevenLabs WebSocket error:', error)
          }

          elevenLabsWs.onclose = (event) => {
            console.log('🔌 ElevenLabs WebSocket closed:', event.code, event.reason)
            elevenLabsConnected = false
          }

        } catch (error) {
          console.error('❌ Error connecting to ElevenLabs:', error)
        }

      } else if (data.event === 'media') {
        const audioPayload = data.media.payload
        const audioData = new Uint8Array(
          atob(audioPayload)
            .split('')
            .map(char => char.charCodeAt(0))
        )
        
        console.log('🎤 Audio chunk received, buffer size:', data.media.chunk, 'audioData:', audioData.length, 'bytes')

        // Echo diagnostic: send inbound mulaw frame back out immediately
        if (echoMode) {
          const echoChunks = chunkMulawFrames(audioData)
          await enqueueTwilioChunks(echoChunks, streamSid, socket)
          return
        }
        
        buffer.addChunk(audioData)
        
        // For ElevenLabs streaming API, we use Whisper to convert speech to text
        // then send the text to ElevenLabs for response generation
        if (buffer.shouldProcess()) {
          const audioToProcess = buffer.getAndClear()
          console.log('🧠 Processing accumulated audio with Whisper:', audioToProcess.length, 'bytes')
          
          // Process with Whisper and send transcript to ElevenLabs
          processAudioWithWhisper(audioToProcess).then(transcript => {
            if (transcript.trim() && elevenLabsConnected && elevenLabsWs?.readyState === WebSocket.OPEN) {
              console.log('📝 Whisper transcript:', transcript)
              
              // Send transcript to ElevenLabs for response generation
              elevenLabsWs!.send(JSON.stringify({
                text: `Customer said: "${transcript}". Please respond appropriately as a ${businessName} receptionist.`,
                try_trigger_generation: true
              }))
              console.log('📤 Sent transcript to ElevenLabs for response')
            }
          }).catch(err => {
            console.error('❌ Whisper processing error:', err)
          })
        }

      } else if (data.event === 'stop') {
        console.log('🛑 Stream stopped')
        if (elevenLabsWs) {
          elevenLabsWs.close()
          elevenLabsWs = null
        }
      }
    } catch (error) {
      console.error('❌ Error processing message:', error)
    }
  }

  socket.onclose = () => {
    console.log('🔌 WebSocket disconnected')
    if (elevenLabsWs) {
      elevenLabsWs.close()
      elevenLabsWs = null
    }
  }

  socket.onerror = (error) => {
    console.error('❌ WebSocket error:', error)
  }

  return response
})