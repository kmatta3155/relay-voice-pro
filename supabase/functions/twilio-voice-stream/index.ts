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
  
  addChunk(audioData: Uint8Array) {
    this.chunks.push(audioData)
  }
  
  shouldProcess(): boolean {
    // Process every 1.5 seconds or when we have enough data
    return Date.now() - this.lastProcessTime > 1500 && this.chunks.length > 0
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
    // Convert μ-law to WAV format for Whisper
    const wavData = createWavFromMulaw(audioData)
    
    const formData = new FormData()
    const blob = new Blob([wavData], { type: 'audio/wav' })
    formData.append('file', blob, 'audio.wav')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Whisper API failed: ${await response.text()}`)
    }

    const result = await response.json()
    return result.text || ''
  } catch (error) {
    console.error('❌ Error with Whisper:', error)
    return ''
  }
}

async function getAIResponse(text: string, tenantId: string): Promise<string> {
  try {
    // Get agent configuration
    const { data: agent } = await supabase
      .from('ai_agents')
      .select('system_prompt, model')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .single()

    if (!agent) {
      return "I'm sorry, I'm not available right now. Please try again later."
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: agent.model || 'gpt-4o',
        messages: [
          { role: 'system', content: agent.system_prompt || 'You are a helpful AI receptionist.' },
          { role: 'user', content: text }
        ],
        max_tokens: 150,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API failed: ${await response.text()}`)
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
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'alloy',
        response_format: 'wav',
      }),
    })

    if (!response.ok) {
      throw new Error(`TTS API failed: ${await response.text()}`)
    }

    const wavBytes = new Uint8Array(await response.arrayBuffer())
    return convertWavToMulawChunks(wavBytes)
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
  } else {
    resampledSamples = samples
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
  for (const chunk of chunks) {
    const payload = btoa(String.fromCharCode(...chunk))
    const mediaMessage = {
      event: 'media',
      streamSid: streamSid,
      media: { payload }
    }
    socket.send(JSON.stringify(mediaMessage))
    await new Promise(resolve => setTimeout(resolve, 20)) // 20ms pacing
  }
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED - NEW VERSION')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
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
        }

        if (evt === 'media') {
          if (data.media?.payload && streamSid && tenantId) {
            // Decode base64 audio payload
            const audioData = new Uint8Array(
              atob(data.media.payload)
                .split('')
                .map(char => char.charCodeAt(0))
            )
            
            audioBuffer.addChunk(audioData)
            console.log('🎤 Audio chunk received, buffer size:', audioBuffer.chunks.length)
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
