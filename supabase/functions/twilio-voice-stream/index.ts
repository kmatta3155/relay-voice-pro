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
    // Real-world fix:
    // - Lower the cadence to feel more responsive (~500ms)
    // - Also flush on "silence" (no new chunks) for 500ms
    // - Avoid processing when there's truly nothing buffered
    const now = Date.now()
    const timeElapsed = now - this.lastProcessTime >= 500
    const silenceElapsed = this.chunks.length > 0 && now - this.lastChunkTime >= 500
    const haveMinChunks = this.chunks.length >= 12 // ~240ms at 20ms/chunk
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

// Audio processing functions
async function processAudioWithWhisper(audioData: Uint8Array): Promise<string> {
  try {
    console.log('👂 Processing audio with Whisper, data size:', audioData.length)
    
    // Check if OpenAI API key is available
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('❌ OPENAI_API_KEY not found for Whisper')
      return ''
    }

    // Convert μ-law to WAV format for Whisper
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

async function getAIResponse(text: string, tenantId?: string): Promise<string> {
  try {
    console.log('🤖 Getting AI response for tenant:', tenantId)
    
    // Check if OpenAI API key is available
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('❌ OPENAI_API_KEY not found in environment')
      return "I'm sorry, I'm not properly configured right now. Please try again later."
    }

    // Defaults if we can't load a tenant-specific agent
    let systemPrompt = 'You are a helpful AI receptionist. The caller has already been greeted. Answer their questions directly and naturally. Be concise, friendly, and helpful.'
    let model = 'gpt-4o'

    if (tenantId) {
      // Try to get agent configuration
      console.log('📋 Fetching agent configuration...')
      const { data: agent, error } = await supabase
        .from('ai_agents')
        .select('system_prompt, model')
        .eq('tenant_id', tenantId)
        .eq('status', 'ready')
        .maybeSingle()

      console.log('🔍 Agent query result:', { agent, error })
      if (agent) {
        systemPrompt = agent.system_prompt || systemPrompt
        model = agent.model || model
      } else if (error) {
        console.warn('⚠️ Falling back to default agent due to lookup error:', error)
      } else {
        console.warn('⚠️ No tenant agent found. Using defaults.')
      }
    } else {
      console.warn('⚠️ No tenantId provided. Using default agent configuration.')
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 150,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API failed: ${errorText}`)
    }

    const result = await response.json()
    return result.choices[0]?.message?.content || "I'm sorry, I couldn't process that."
  } catch (error) {
    console.error('❌ Error with AI response:', error)
    return "I'm sorry, I'm having trouble understanding you. Please try again."
  }
}

async function generateTTSAudio(text: string): Promise<Uint8Array[]> {
  try {
    console.log('🔊 Generating TTS for text:', text.substring(0, 100) + '...')
    
    // Check if OpenAI API key is available
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('❌ OPENAI_API_KEY not found for TTS')
      return []
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd', // Use HD model for better quality
        input: text,
        voice: 'alloy', // Consistent voice
        response_format: 'wav',
        speed: 1.0 // Normal speed for consistency
      }),
    })

    console.log('📥 TTS response status:', response.status)
    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ TTS API failed:', response.status, errorText)
      throw new Error(`TTS API failed: ${errorText}`)
    }

    const wavBytes = new Uint8Array(await response.arrayBuffer())
    console.log('🔄 Converting WAV to μ-law chunks, WAV size:', wavBytes.length)
    const chunks = convertWavToMulawChunks(wavBytes)
    console.log('✅ Generated', chunks.length, 'audio chunks for Twilio')
    return chunks
  } catch (error) {
    console.error('❌ Error with TTS:', error)
    return []
  }
}

// Audio format conversion functions
function createWavFromMulaw(mulawData: Uint8Array): Uint8Array {
  // Convert μ-law to 16-bit PCM
  const pcmData = new Int16Array(mulawData.length)
  for (let i = 0; i < mulawData.length; i++) {
    pcmData[i] = mulawToPcm(mulawData[i])
  }

  // Create WAV header
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

function convertWavToMulawChunks(wavBytes: Uint8Array): Uint8Array[] {
  // Parse WAV header to get sample rate
  const dataView = new DataView(wavBytes.buffer)
  const sampleRate = dataView.getUint32(24, true) // Sample rate at byte 24
  const dataOffset = 44 // Standard WAV header size
  
  // Extract PCM data
  const pcmStart = dataOffset
  const pcmLength = wavBytes.length - pcmStart
  const samples = new Int16Array(wavBytes.buffer, pcmStart, pcmLength / 2)
  
  console.log(`📊 Original audio: ${samples.length} samples at ${sampleRate}Hz`)
  
  // Resample to 8kHz if needed
  let resampledSamples: Int16Array
  if (sampleRate !== 8000) {
    const ratio = sampleRate / 8000
    const newLength = Math.floor(samples.length / ratio)
    resampledSamples = new Int16Array(newLength)
    
    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.floor(i * ratio)
      resampledSamples[i] = samples[srcIndex]
    }
    console.log(`🔄 Resampled to 8kHz: ${resampledSamples.length} samples`)
  } else {
    resampledSamples = samples
  }
  
  // Normalize audio levels - find max amplitude
  let maxAmplitude = 0
  for (let i = 0; i < resampledSamples.length; i++) {
    maxAmplitude = Math.max(maxAmplitude, Math.abs(resampledSamples[i]))
  }
  
  // Apply gain if audio is too quiet (but don't over-amplify)
  const targetAmplitude = 16000 // Target ~50% of max 16-bit range
  if (maxAmplitude > 0 && maxAmplitude < targetAmplitude) {
    const gain = Math.min(2.0, targetAmplitude / maxAmplitude)
    console.log(`🔊 Applying gain: ${gain.toFixed(2)}x (max was ${maxAmplitude})`)
    for (let i = 0; i < resampledSamples.length; i++) {
      resampledSamples[i] = Math.round(resampledSamples[i] * gain)
    }
  } else {
    console.log(`📈 Audio levels OK: max amplitude ${maxAmplitude}`)
  }
  
  // Convert to μ-law
  const mulaw = new Uint8Array(resampledSamples.length)
  for (let i = 0; i < resampledSamples.length; i++) {
    mulaw[i] = pcmToMulaw(resampledSamples[i])
  }

  // Split into 20ms chunks (160 samples at 8kHz)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < mulaw.length; i += 160) {
    chunks.push(mulaw.subarray(i, Math.min(i + 160, mulaw.length)))
  }
  
  console.log(`✅ Created ${chunks.length} μ-law chunks`)
  return chunks
}

function mulawToPcm(mulaw: number): number {
  mulaw = ~mulaw
  const sign = (mulaw & 0x80) ? -1 : 1
  const exponent = (mulaw >> 4) & 0x07
  const mantissa = mulaw & 0x0F
  let sample = mantissa << (exponent + 3)
  if (exponent > 0) sample += (1 << (exponent + 7))
  return sign * (sample - 132)
}

function pcmToMulaw(pcm: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  let sign = 0
  if (pcm < 0) { sign = 0x80; pcm = -pcm }
  pcm += BIAS
  if (pcm > CLIP) pcm = CLIP
  let exponent = 7
  for (let expLut = 0x4000; (pcm & ~expLut) === 0 && exponent > 0; expLut >>= 1) exponent--
  const mantissa = (pcm >> (exponent + 3)) & 0x0F
  return (~(sign | (exponent << 4) | mantissa)) & 0xFF
}

async function sendAudioToTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  console.log(`📡 Preparing to send ${chunks.length} μ-law chunks to Twilio`)
  let idx = 0
  for (const chunk of chunks) {
    const payload = btoa(String.fromCharCode(...chunk))
    const mediaMessage = {
      event: 'media',
      streamSid: streamSid,
      media: { payload }
    }
    socket.send(JSON.stringify(mediaMessage))
    if (idx % 10 === 0) {
      console.log(`➡️ Sent chunk ${idx + 1}/${chunks.length} (size=${chunk.length} bytes)`) 
    }
    idx++
    // Pace to ~20ms per 160-sample chunk at 8kHz
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  console.log('✅ Finished sending audio to Twilio')
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED - NEW VERSION')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  
  // Validate environment on startup
  const requiredEnvVars = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName))
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars)
  } else {
    console.log('✅ All required environment variables present')
  }
  
  console.log('Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(req)

    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    const callSid = url.searchParams.get('call_sid')
    console.log('📋 Parameters:', { tenantId, callSid })

    let streamSid = ''
    const audioBuffer = new AudioBuffer()

    socket.onopen = () => {
      console.log('✅ WebSocket opened successfully!')
    }

    socket.onmessage = async (event) => {
      try {
        console.log('📥 Raw WebSocket message received:', event.data)
        const data = JSON.parse(event.data)
        const evt = data.event
        console.log('📨 Parsed event type:', evt)
        
        if (!evt) {
          console.log('⚠️ No event type found in message')
          return
        }

        if (evt === 'connected') {
          console.log('🔌 Twilio connected')
        }

        if (evt === 'start') {
          streamSid = data.start?.streamSid
          console.log('▶️ Stream started. streamSid=', streamSid)
          console.log('✅ Stream ready, awaiting caller audio')
          
          // Send a test greeting to confirm the pipeline works
          if (streamSid && tenantId) {
            console.log('🧪 Sending test greeting on stream start...')
            try {
              const testGreeting = "Hello! I can hear you. How can I help you today?"
              const greetingAudio = await generateTTSAudio(testGreeting)
              if (greetingAudio.length > 0) {
                await sendAudioToTwilio(greetingAudio, streamSid, socket)
                console.log('✅ Test greeting sent successfully')
              }
            } catch (error) {
              console.error('❌ Failed to send test greeting:', error)
            }
          }
        }

        if (evt === 'media') {
          if (data.media?.payload && streamSid) {
            // Decode base64 audio payload
            const audioData = new Uint8Array(
              atob(data.media.payload)
                .split('')
                .map(char => char.charCodeAt(0))
            )
            
            audioBuffer.addChunk(audioData)
            console.log('🎤 Audio chunk received, buffer size:', audioBuffer.size())
            console.log('🔍 Audio chunk size:', audioData.length, 'bytes')
            
            // Process accumulated audio when we have enough
            if (audioBuffer.shouldProcess()) {
              console.log('🔄 Processing accumulated audio...')
              const combinedAudio = audioBuffer.getAndClear()
              
              // Process audio through AI pipeline
              try {
                // 1. Speech to Text
                console.log('👂 Converting speech to text...')
                const transcription = await processAudioWithWhisper(combinedAudio)
                console.log('📝 Transcription:', transcription)
                
                if (transcription.trim()) {
                  // 2. AI Processing
                  console.log('🤖 Getting AI response...')
                  const aiResponse = await getAIResponse(transcription, tenantId)
                  console.log('💬 AI Response:', aiResponse)
                  
                  // 3. Text to Speech
                  console.log('🔊 Converting text to speech...')
                  const audioChunks = await generateTTSAudio(aiResponse)
                  console.log('🎵 Generated audio chunks:', audioChunks.length)
                  
                  // 4. Send back to Twilio
                  if (audioChunks.length > 0) {
                    console.log('📤 Sending audio response to caller...')
                    await sendAudioToTwilio(audioChunks, streamSid, socket)
                    console.log('✅ Audio response sent successfully')
                  }
                }
              } catch (processingError) {
                console.error('❌ Error in AI processing pipeline:', processingError)
                
                // Send error response to caller
                const errorMessage = "I'm sorry, I'm having trouble processing your request. Please try again."
                const errorAudio = await generateTTSAudio(errorMessage)
                if (errorAudio.length > 0) {
                  await sendAudioToTwilio(errorAudio, streamSid, socket)
                }
              }
            }
          }
        }

        if (evt === 'stop') {
          console.log('🛑 Stream stopped')
          try {
            // Flush any remaining buffered audio on stop
            if (audioBuffer.size() > 0) {
              console.log('🧹 Flushing remaining buffered audio on stop...')
              const combinedAudio = audioBuffer.getAndClear()
              const transcription = await processAudioWithWhisper(combinedAudio)
              if (transcription.trim()) {
                const aiResponse = await getAIResponse(transcription, tenantId || undefined)
                const audioChunks = await generateTTSAudio(aiResponse)
                if (audioChunks.length > 0) {
                  await sendAudioToTwilio(audioChunks, streamSid, socket)
                }
              }
            }
          } catch (e) {
            console.error('❌ Error flushing on stop:', e)
          }
        }
      } catch (err) {
        console.error('❌ Error handling message:', err)
        console.error('Raw:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔒 WebSocket closed:', event.code, event.reason)
    }

    return response
  } catch (error) {
    console.error('❌ Error setting up WebSocket:', error)
    return new Response('WebSocket upgrade failed', { status: 500 })
  }
})
