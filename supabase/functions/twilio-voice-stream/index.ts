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

// Convert ElevenLabs PCM16 to Twilio μ-law format
function processElevenLabsAudioToMulaw(audioData: Uint8Array): Uint8Array[] {
  console.log(`🎧 Processing ${audioData.length} bytes from ElevenLabs`)
  
  // ElevenLabs Conversational AI sends PCM16 at 24kHz - convert to samples
  const pcm16Samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2)
  console.log(`🎵 Got ${pcm16Samples.length} PCM16 samples at 24kHz`)
  
  // Downsample from 24kHz to 8kHz (3:1 ratio) with proper anti-aliasing
  const len = Math.floor(pcm16Samples.length / 3)
  const pcm8kSamples = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    // Take every 3rd sample and apply simple low-pass filter
    const i3 = i * 3
    if (i3 + 2 < pcm16Samples.length) {
      // Average 3 samples for anti-aliasing before decimation
      const s0 = pcm16Samples[i3]
      const s1 = pcm16Samples[i3 + 1] 
      const s2 = pcm16Samples[i3 + 2]
      pcm8kSamples[i] = Math.round((s0 + s1 + s2) / 3)
    } else {
      pcm8kSamples[i] = pcm16Samples[i3]
    }
  }
  
  console.log(`🎵 Downsampled to ${pcm8kSamples.length} samples at 8kHz`)
  
  // Convert to μ-law and chunk into 20ms frames (160 bytes each)
  const chunks: Uint8Array[] = []
  const samplesPerChunk = 160 // 20ms at 8kHz = 160 samples
  
  for (let i = 0; i < pcm8kSamples.length; i += samplesPerChunk) {
    const chunk = new Uint8Array(samplesPerChunk)
    
    for (let j = 0; j < samplesPerChunk; j++) {
      const sampleIndex = i + j
      if (sampleIndex < pcm8kSamples.length) {
        // Convert PCM16 to μ-law
        chunk[j] = pcmToMulaw(pcm8kSamples[sampleIndex])
      } else {
        // μ-law silence value
        chunk[j] = 0xFF
      }
    }
    
    chunks.push(chunk)
  }
  
  console.log(`📦 Created ${chunks.length} μ-law chunks (160 bytes each)`)
  return chunks
}

// Send raw μ-law audio to Twilio with better error handling and timing
async function sendAudioToTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  console.log(`➡️ Sending ${chunks.length} μ-law chunks to Twilio (streamSid: ${streamSid})`)
  console.log(`🔌 WebSocket readyState: ${socket.readyState}`)
  
  if (socket.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not open, cannot send audio')
    return
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    if (chunk.length !== 160) {
      console.warn(`⚠️ Chunk ${i + 1} has incorrect size: ${chunk.length} bytes (expected 160)`) 
    }

    let base64Payload: string
    try {
      base64Payload = btoa(String.fromCharCode(...chunk))
    } catch (e) {
      console.error(`❌ Failed to encode chunk ${i + 1} to base64:`, e)
      continue
    }

    const message = {
      event: 'media',
      streamSid,
      media: { payload: base64Payload }
    }

    try {
      socket.send(JSON.stringify(message))
      if (i === 0) {
        console.log(`🔍 First chunk sent successfully (${chunk.length} bytes)`) 
      }
    } catch (e) {
      console.error(`❌ Failed to send chunk ${i + 1}:`, e)
      break
    }

    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  console.log(`✅ Sent ${chunks.length} μ-law chunks to Twilio`)
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
        output_format: 'pcm_16000' // Use proven format
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
    
    // For TTS greeting (16kHz), create a separate processing function
    // Convert PCM16 16kHz to μ-law 8kHz (2:1 ratio)
    const pcm16Samples = new Int16Array(pcm16kBytes.buffer, pcm16kBytes.byteOffset, pcm16kBytes.length / 2)
    const len = Math.floor(pcm16Samples.length / 2)
    const pcm8kSamples = new Int16Array(len)
    for (let i = 0; i < len; i++) {
      const a = pcm16Samples[i * 2]
      const b = pcm16Samples[i * 2 + 1] || a
      pcm8kSamples[i] = Math.round((a + b) / 2)
    }
    
    // Convert to μ-law chunks
    const chunks: Uint8Array[] = []
    const samplesPerChunk = 160
    for (let i = 0; i < pcm8kSamples.length; i += samplesPerChunk) {
      const chunk = new Uint8Array(samplesPerChunk)
      for (let j = 0; j < samplesPerChunk; j++) {
        const sampleIndex = i + j
        if (sampleIndex < pcm8kSamples.length) {
          chunk[j] = pcmToMulaw(pcm8kSamples[sampleIndex])
        } else {
          chunk[j] = 0xFF
        }
      }
      chunks.push(chunk)
    }
    
    await sendAudioToTwilio(chunks, streamSid, socket)
    console.log('✅ TTS greeting sent to Twilio via proven conversion pipeline')
  } catch (e) {
    console.error('❌ Error sending TTS greeting:', e)
  }
}

serve(async (req) => {
  console.log('🎵 TWILIO VOICE STREAM - FIXED VERSION 5.1 - STATIC ELIMINATED')
  console.log('📍 Request received, checking WebSocket upgrade...')
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected Websocket', { status: 426 })
  }
  const protocols = req.headers.get('sec-websocket-protocol') || undefined
  const { socket, response } = Deno.upgradeWebSocket(req, protocols ? { protocol: protocols } : {})
  const buffer = new AudioBuffer()
  let streamSid = ''
  let phoneNumber = ''
  let tenantId = ''
  let businessName = ''
  let elevenLabsWs: WebSocket | null = null
  let elevenLabsConnected = false

  socket.onopen = () => {
    console.log('🔌 WebSocket connected to Twilio')
  }

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('📥 Raw WebSocket message received:', JSON.stringify(data))
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
        const agentId = Deno.env.get('ELEVENLABS_AGENT_ID') || '4dv4ZFiVvCcdXFqlpVzY'
        
        console.log(`🔑 ElevenLabs Key present: ${!!elevenLabsKey}`)
        console.log(`🤖 Agent ID: ${agentId}`)

        if (!elevenLabsKey) {
          console.error('❌ ELEVENLABS_API_KEY not found - cannot connect to ElevenLabs')
          return
        }
        // Send immediate μ-law greeting while agent connects (no agent first_message to avoid overlap)
        await sendImmediateGreeting(streamSid, socket, businessName)

        console.log('🔗 Getting signed URL from ElevenLabs...')
        try {
          const urlResp = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
            method: 'GET',
            headers: { 'xi-api-key': elevenLabsKey }
          })
          
          console.log(`📡 ElevenLabs API response status: ${urlResp.status}`)
          
          if (!urlResp.ok) {
            const errorText = await urlResp.text()
            console.error(`❌ Failed to get signed URL: ${urlResp.status} - ${errorText}`)
            return
          }
          
          const urlData = await urlResp.json()
          console.log('✅ Signed URL obtained successfully')
          
          const signedUrl = urlData.signed_url
          console.log(`🔗 Connecting to ElevenLabs WebSocket: ${signedUrl.substring(0, 50)}...`)
          
          elevenLabsWs = new WebSocket(signedUrl)

          elevenLabsWs.onopen = () => {
            console.log('✅ ElevenLabs WebSocket connected successfully')
            elevenLabsConnected = true
            
            // Send conversation initiation with required type to trigger greeting
            const initMessage = {
              type: 'conversation_initiation_client_data',
              conversation_config_override: {
                agent: {
                  prompt: {
                    prompt: `You are a helpful receptionist for ${businessName}. Answer calls professionally and keep responses brief and natural.`
                  },
                  language: 'en'
                },
                conversation_config: {
                  turn_detection: {
                    type: 'server_vad'
                  }
                }
              }
            }
            
            elevenLabsWs!.send(JSON.stringify(initMessage))
            console.log('📤 Sent conversation config to ElevenLabs (init, no first_message)')
          }

          elevenLabsWs.onmessage = async (message) => {
            try {
              if (typeof message.data === 'string') {
                const data = JSON.parse(message.data)
                console.log('🎵 ElevenLabs message type:', data.type)

                if (data.type === 'audio') {
                  console.log('🎵 Received audio from ElevenLabs, processing...')
                  console.log(`📊 Audio data length: ${data.audio_event?.audio_base_64?.length || 0}`)
                  
                  const audioData = new Uint8Array(atob(data.audio_event.audio_base_64).split('').map(c => c.charCodeAt(0)))
                  console.log(`🎧 Decoded audio bytes: ${audioData.length}`)
                  console.log(`🔍 First 8 bytes (hex): ${Array.from(audioData.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
                  
                  // Process and send to Twilio - NO WAV HEADERS, raw μ-law only
                  const processedChunks = processElevenLabsAudioToMulaw(audioData)
                  await sendAudioToTwilio(processedChunks, streamSid, socket)
                  
                  console.log(`📤 Sent ${processedChunks.length} μ-law chunks to Twilio`)
                } else if (data.type === 'user_transcript') {
                  console.log('📝 User transcript:', data.user_transcription_event.user_transcript)
                } else if (data.type === 'agent_response') {
                  console.log('🤖 Agent response:', data.agent_response_event.agent_response)
                } else if (data.type === 'conversation_initiation_metadata') {
                  console.log('🎯 Conversation initiated successfully')
                } else {
                  console.log('📋 Other ElevenLabs event:', JSON.stringify(data))
                }
              }
            } catch (error) {
              console.error('❌ Error processing ElevenLabs message:', error)
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
        
        console.log('🎤 Audio chunk received, buffer size:', data.media.chunk)
        console.log('🔍 Audio chunk size:', audioData.length, 'bytes')
        
        buffer.addChunk(audioData)
        
        // Send to ElevenLabs immediately (convert Twilio μ-law 8k -> PCM16 16k)
        if (elevenLabsConnected && elevenLabsWs?.readyState === WebSocket.OPEN) {
          // μ-law 8k to PCM16 8k
          const pcm8k = new Int16Array(audioData.length)
          for (let i = 0; i < audioData.length; i++) {
            pcm8k[i] = mulawToPcm(audioData[i])
          }
          // Upsample to 16k (linear)
          const pcm16k = new Int16Array(pcm8k.length * 2)
          for (let i = 0; i < pcm8k.length; i++) {
            const s0 = pcm8k[i]
            const s1 = i < pcm8k.length - 1 ? pcm8k[i + 1] : s0
            pcm16k[i * 2] = s0
            pcm16k[i * 2 + 1] = (s0 + s1) >> 1
          }
          // Int16 -> bytes (LE) -> base64
          const bytes = new Uint8Array(pcm16k.length * 2)
          let o = 0
          for (let i = 0; i < pcm16k.length; i++) {
            const s = pcm16k[i]
            bytes[o++] = s & 0xff
            bytes[o++] = (s >> 8) & 0xff
          }
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64Audio = btoa(binary)
          elevenLabsWs.send(JSON.stringify({
            type: 'user_audio_chunk',
            audio: base64Audio
          }))
        }

        // Skip Whisper processing when ElevenLabs is handling the conversation
        // Only use Whisper as fallback if ElevenLabs connection fails
        if (!elevenLabsConnected) {
          if (buffer.shouldProcess()) {
            const audioToProcess = buffer.getAndClear()
            console.log('🧠 Processing accumulated audio for Whisper (ElevenLabs fallback):', audioToProcess.length, 'bytes')
            
            // Process with Whisper in background
            processAudioWithWhisper(audioToProcess).then(transcript => {
              if (transcript.trim()) {
                console.log('📝 Whisper transcript:', transcript)
              }
            }).catch(err => {
              console.error('❌ Whisper processing error:', err)
            })
          }
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