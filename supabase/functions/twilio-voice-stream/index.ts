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
  
  // ElevenLabs sends PCM16 at 16kHz - convert to samples
  const pcm16Samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2)
  console.log(`🎵 Got ${pcm16Samples.length} PCM16 samples`)
  
  // Downsample from 16kHz to 8kHz with simple low-pass (average pairs)
  const len = Math.floor(pcm16Samples.length / 2)
  const pcm8kSamples = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    const a = pcm16Samples[i * 2]
    const b = pcm16Samples[i * 2 + 1]
    // Box filter to reduce aliasing before decimation
    pcm8kSamples[i] = (a + b) / 2
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

// Send raw μ-law audio to Twilio (NO headers!)
async function sendAudioToTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  console.log(`➡️ Sending ${chunks.length} μ-law chunks to Twilio`)
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    
    // Send raw μ-law data (NO headers according to Twilio docs!)
    const message = {
      event: 'media',
      streamSid: streamSid,
      media: {
        payload: btoa(String.fromCharCode(...chunk))
      }
    }
    
    socket.send(JSON.stringify(message))
    console.log(`📤 Sent μ-law chunk ${i + 1}/${chunks.length} (${chunk.length} bytes)`)
    
    // 20ms delay for proper timing
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  
  console.log('✅ All μ-law chunks sent to Twilio')
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

serve(async (req) => {
  console.log('🎵 TWILIO VOICE STREAM - ELEVENLABS FIXED VERSION')
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected Websocket', { status: 426 })
  }

  const { socket, response } = Deno.upgradeWebSocket(req)
  const buffer = new AudioBuffer()
  let streamSid = ''
  let phoneNumber = ''
  let tenantId = ''
  let businessName = ''
  let elevenLabsWs: WebSocket | null = null

  socket.onopen = () => {
    console.log('🔌 WebSocket connected to Twilio')
  }

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('📥 Raw WebSocket message received:', JSON.stringify(data))
      console.log('📨 Parsed event type:', data.event)

      if (data.event === 'start') {
        console.log('🚀 Stream started')
        streamSid = data.streamSid
        phoneNumber = data.start?.customParameters?.phoneNumber || 'unknown'
        tenantId = data.start?.customParameters?.tenantId || ''
        businessName = data.start?.customParameters?.businessName || 'this business'
        
        console.log(`📞 Call details: Phone=${phoneNumber}, Tenant=${tenantId}, Business=${businessName}`)

        // Connect to ElevenLabs
        try {
          const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
          if (!elevenLabsKey) {
            console.error('❌ ELEVENLABS_API_KEY not found')
            return
          }

          const agentId = Deno.env.get('ELEVENLABS_AGENT_ID') || '4dv4ZFiVvCcdXFqlpVzY'
          console.log('🎵 Connecting to ElevenLabs agent:', agentId)
          
          // Correct ElevenLabs WebSocket URL with API key as query parameter
          const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}&xi-api-key=${elevenLabsKey}`
          elevenLabsWs = new WebSocket(wsUrl)

          elevenLabsWs.onopen = () => {
            console.log('✅ ElevenLabs WebSocket connected successfully')
            
            // Send conversation initiation with required type to trigger greeting
            const initMessage = {
              type: 'conversation_initiation_client_data',
              conversation_config_override: {
                agent: {
                  prompt: {
                    prompt: `You are a helpful receptionist for ${businessName}. Answer calls professionally and keep responses brief and natural.`
                  },
                  first_message: `Hello! Thank you for calling ${businessName}. How can I help you today?`,
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
            console.log('📤 Sent conversation config to ElevenLabs (init)')
          }

          elevenLabsWs.onmessage = async (message) => {
            try {
              if (typeof message.data === 'string') {
                const data = JSON.parse(message.data)
                console.log('🎵 ElevenLabs message type:', data.type)

                if (data.type === 'audio') {
                  console.log('🎵 Received audio from ElevenLabs, processing...')
                  const audioData = new Uint8Array(atob(data.audio_event.audio_base_64).split('').map(c => c.charCodeAt(0)))
                  
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
        
        // Send to ElevenLabs immediately
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          const base64Audio = btoa(String.fromCharCode(...audioData))
          elevenLabsWs.send(JSON.stringify({
            user_audio_chunk: base64Audio
          }))
        }

        // Process accumulated audio for Whisper if needed
        if (buffer.shouldProcess()) {
          const audioToProcess = buffer.getAndClear()
          console.log('🧠 Processing accumulated audio for Whisper:', audioToProcess.length, 'bytes')
          
          // Process with Whisper in background
          processAudioWithWhisper(audioToProcess).then(transcript => {
            if (transcript.trim()) {
              console.log('📝 Whisper transcript:', transcript)
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