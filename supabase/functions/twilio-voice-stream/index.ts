import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"
import "https://deno.land/x/xhr@0.1.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Audio buffer to accumulate incoming audio
class AudioBuffer {
  private chunks: Uint8Array[] = []
  private totalSamples = 0
  
  append(audioBase64: string) {
    // Decode base64 to get μ-law encoded bytes
    const binaryString = atob(audioBase64)
    const mulawBytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      mulawBytes[i] = binaryString.charCodeAt(i)
    }
    
    this.chunks.push(mulawBytes)
    this.totalSamples += mulawBytes.length
  }
  
  getWavAudio(): Uint8Array {
    // Combine all μ-law chunks
    const allMulawBytes = new Uint8Array(this.totalSamples)
    let offset = 0
    for (const chunk of this.chunks) {
      allMulawBytes.set(chunk, offset)
      offset += chunk.length
    }
    
    // Convert μ-law to 16-bit PCM
    const pcmData = this.mulawToPcm(allMulawBytes)
    
    // Create WAV file with proper headers
    return this.createWavFile(pcmData)
  }
  
  private mulawToPcm(mulawData: Uint8Array): Int16Array {
    const pcmData = new Int16Array(mulawData.length)
    
    // μ-law to linear conversion table
    const mulawTable = new Int16Array([
      -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
      -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
      -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
      -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
      -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
      -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
      -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
      -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
      -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
      -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
      -876, -844, -812, -780, -748, -716, -684, -652,
      -620, -588, -556, -524, -492, -460, -428, -396,
      -372, -356, -340, -324, -308, -292, -276, -260,
      -244, -228, -212, -196, -180, -164, -148, -132,
      -120, -112, -104, -96, -88, -80, -72, -64,
      -56, -48, -40, -32, -24, -16, -8, 0,
      32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
      23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
      15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
      11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
      7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
      5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
      3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
      2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
      1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
      1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
      876, 844, 812, 780, 748, 716, 684, 652,
      620, 588, 556, 524, 492, 460, 428, 396,
      372, 356, 340, 324, 308, 292, 276, 260,
      244, 228, 212, 196, 180, 164, 148, 132,
      120, 112, 104, 96, 88, 80, 72, 64,
      56, 48, 40, 32, 24, 16, 8, 0
    ])
    
    for (let i = 0; i < mulawData.length; i++) {
      pcmData[i] = mulawTable[mulawData[i]]
    }
    
    return pcmData
  }
  
  private createWavFile(pcmData: Int16Array): Uint8Array {
    const sampleRate = 8000 // Twilio uses 8kHz
    const numChannels = 1
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const dataSize = pcmData.length * 2
    const fileSize = 36 + dataSize
    
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }
    
    writeString(0, 'RIFF')
    view.setUint32(4, fileSize, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // PCM format
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)
    
    // PCM data
    const pcmBytes = new Uint8Array(buffer, 44)
    for (let i = 0; i < pcmData.length; i++) {
      const sample = pcmData[i]
      pcmBytes[i * 2] = sample & 0xFF
      pcmBytes[i * 2 + 1] = (sample >> 8) & 0xFF
    }
    
    return new Uint8Array(buffer)
  }
  
  clear() {
    this.chunks = []
    this.totalSamples = 0
  }
  
  getDuration(): number {
    // Twilio sends 8kHz μ-law, so samples = ms * 8
    return this.totalSamples / 8
  }
}

// Function to transcribe audio using OpenAI Whisper
async function transcribeAudio(wavBytes: Uint8Array): Promise<string | null> {
  try {
    const formData = new FormData()
    const blob = new Blob([wavBytes], { type: 'audio/wav' })
    formData.append('file', blob, 'audio.wav')
    formData.append('model', 'whisper-1')
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    })
    
    if (!response.ok) {
      console.error('Transcription error:', await response.text())
      return null
    }
    
    const result = await response.json()
    return result.text
  } catch (error) {
    console.error('Error transcribing audio:', error)
    return null
  }
}

// Function to generate AI response using knowledge base
async function generateReceptionistResponse(tenantId: string, question: string): Promise<string> {
  try {
    // Get tenant business info
    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('business_name, business_type')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenantData) {
      console.error('Error fetching tenant data:', tenantError)
      return "I'm sorry, I'm having trouble accessing information right now. Please try again later."
    }

    // Search knowledge base for relevant information
    const { data: knowledgeData, error: knowledgeError } = await supabase
      .rpc('search_knowledge_keywords', {
        p_tenant: tenantId,
        p_query: question,
        p_match_count: 3
      })

    if (knowledgeError) {
      console.error('Error searching knowledge base:', knowledgeError)
    }

    const knowledgeContext = knowledgeData?.map(item => item.content).join('\n') || ''

    // Generate response using OpenAI
    const systemPrompt = `You are a helpful AI receptionist for ${tenantData.business_name}, a ${tenantData.business_type}. 
    
Use this knowledge base information to answer questions:
${knowledgeContext}

Keep responses concise and friendly. If you don't have specific information, politely say so and offer to have someone call them back.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      console.error('OpenAI API error:', await response.text())
      return "I'm sorry, I'm having trouble processing your request right now. Please try again later."
    }

    const result = await response.json()
    return result.choices[0]?.message?.content || "I'm sorry, I didn't catch that. Could you repeat your question?"
  } catch (error) {
    console.error('Error generating response:', error)
    return "I'm sorry, I'm experiencing technical difficulties. Please try again later."
  }
}

// Function to convert text to speech and send as chunked μ-law to Twilio
async function sendTTSResponse(text: string, streamSid: string, socket: WebSocket): Promise<void> {
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
      console.error('TTS error:', await response.text())
      return
    }

    const arrayBuffer = await response.arrayBuffer()
    const wavBytes = new Uint8Array(arrayBuffer)
    
    // Convert WAV to μ-law and send in chunks
    await sendMulawChunks(wavBytes, streamSid, socket)
  } catch (error) {
    console.error('Error converting text to speech:', error)
  }
}

// Function to send μ-law audio in 20ms chunks to Twilio
async function sendMulawChunks(wavBytes: Uint8Array, streamSid: string, socket: WebSocket): Promise<void> {
  // Convert WAV to μ-law
  const mulawBytes = convertWavToMulaw(wavBytes)
  
  // Send in 20ms chunks (160 samples at 8kHz = 20ms)
  const CHUNK_SIZE = 160 // 20ms at 8kHz
  
  for (let i = 0; i < mulawBytes.length; i += CHUNK_SIZE) {
    const chunk = mulawBytes.slice(i, Math.min(i + CHUNK_SIZE, mulawBytes.length))
    const base64Chunk = btoa(String.fromCharCode(...chunk))
    
    const mediaMessage = {
      event: 'media',
      streamSid: streamSid,
      media: {
        payload: base64Chunk
      }
    }
    
    socket.send(JSON.stringify(mediaMessage))
    
    // Small delay between chunks to simulate real-time streaming
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  
  console.log(`🎤 Sent ${Math.ceil(mulawBytes.length / CHUNK_SIZE)} audio chunks to caller`)
}

// Function to convert WAV audio to μ-law format for Twilio
function convertWavToMulaw(wavBytes: Uint8Array): Uint8Array {
  // Parse WAV header to find data section
  const dataView = new DataView(wavBytes.buffer)
  let dataOffset = 44 // Standard WAV header size
  
  // Find 'data' chunk (in case of non-standard WAV)
  for (let i = 12; i < wavBytes.length - 4; i++) {
    if (wavBytes[i] === 0x64 && wavBytes[i+1] === 0x61 && 
        wavBytes[i+2] === 0x74 && wavBytes[i+3] === 0x61) { // 'data'
      dataOffset = i + 8
      break
    }
  }
  
  // Extract PCM data (16-bit samples)
  const pcmData: number[] = []
  for (let i = dataOffset; i < wavBytes.length; i += 2) {
    if (i + 1 < wavBytes.length) {
      const sample = dataView.getInt16(i, true) // little-endian
      pcmData.push(sample)
    }
  }
  
  // Convert 16-bit PCM to μ-law
  const mulawData = new Uint8Array(pcmData.length)
  for (let i = 0; i < pcmData.length; i++) {
    mulawData[i] = linearToMulaw(pcmData[i])
  }
  
  return mulawData
}

// Convert 16-bit linear PCM to μ-law
function linearToMulaw(pcm: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  
  let sign = 0
  let position = 0
  let lsb = 0
  
  if (pcm < 0) {
    pcm = BIAS - pcm
    sign = 0x80
  } else {
    pcm += BIAS
  }
  
  if (pcm > CLIP) pcm = CLIP
  
  if (pcm >= 256) {
    let exponent = 1
    for (let exp_lut = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768]; 
         exponent < 8; exponent++) {
      if (pcm < exp_lut[exponent - 1]) break
    }
    position = (exponent << 4) | ((pcm >> (exponent + 3)) & 0x0F)
  } else {
    position = pcm >> 4
  }
  
  lsb = (position ^ 0x55) | sign
  return lsb & 0xFF
}

serve(async (req) => {
  console.log('=== TWILIO VOICE STREAM HANDLER ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Extract parameters from URL
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const callSid = url.searchParams.get('call_sid')

  console.log('Parameters:', { tenantId, callSid })

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = req.headers.get("upgrade")
  const connectionHeader = req.headers.get("connection")
  
  console.log('Connection headers:', { 
    upgrade: upgradeHeader, 
    connection: connectionHeader 
  })

  if (upgradeHeader?.toLowerCase() !== "websocket") {
    console.log('Not a WebSocket upgrade request')
    return new Response("Expected WebSocket upgrade", { status: 426 })
  }

  try {
    console.log('Upgrading to WebSocket...')
    const requestedProtocols = req.headers.get("sec-websocket-protocol")?.split(",").map(p => p.trim()) || []
    const chosenProtocol = requestedProtocols.length > 0 ? requestedProtocols[0] : undefined
    console.log('Requested subprotocols from client:', requestedProtocols, 'Chosen:', chosenProtocol)
    
    const { socket, response } = Deno.upgradeWebSocket(req, {
      protocol: chosenProtocol,
    })

    const audioBuffer = new AudioBuffer()
    let streamSid: string | null = null
    let conversationStartTime = Date.now()
    let messageCount = 0
    const MAX_CONVERSATION_TIME = 5 * 60 * 1000 // 5 minutes
    const MAX_MESSAGES = 20

    socket.onopen = () => {
      console.log('✅ WebSocket connection established successfully!')
      console.log('Ready to receive Twilio media stream data')
    }

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('📨 Received from Twilio:', data.event || data.type || 'unknown')
        
        if (data.event === 'connected') {
          console.log('🔗 Twilio WebSocket connected!')
          
        } else if (data.event === 'start') {
          console.log('▶️ Media stream started:', {
            streamSid: data.start?.streamSid,
            callSid: data.start?.callSid,
            tracks: data.start?.tracks,
            mediaFormat: data.start?.mediaFormat
          })
          
          streamSid = data.start?.streamSid
          
          // Send mark event instead of invalid TwiML
          const markEvent = {
            event: 'mark',
            streamSid: streamSid,
            mark: {
              name: 'connection_established'
            }
          }
          socket.send(JSON.stringify(markEvent))
          console.log('📍 Sent mark event to confirm connection')
          
          // Send initial greeting
          if (tenantId && streamSid) {
            const greeting = await generateReceptionistResponse(tenantId, "Hello, please introduce yourself and ask how you can help.")
            await sendTTSResponse(greeting, streamSid, socket)
            console.log('🎤 Sent greeting to caller:', greeting)
          }
          
        } else if (data.event === 'media') {
          // Accumulate audio data
          if (data.media?.payload) {
            audioBuffer.append(data.media.payload)
            console.log('🎵 Audio data accumulated (total duration:', audioBuffer.getDuration(), 'ms)')
            
            // Process accumulated audio when we have enough (e.g., 2 seconds)
            if (audioBuffer.getDuration() >= 2000) {
              const wavAudio = audioBuffer.getWavAudio()
              audioBuffer.clear()
              
              console.log('🎙️ Processing accumulated audio for transcription')
              const transcription = await transcribeAudio(wavAudio)
              
              if (transcription && transcription.trim() && tenantId) {
                console.log('📝 Transcribed:', transcription)
                
                // Check conversation limits
                const elapsedTime = Date.now() - conversationStartTime
                messageCount++
                
                if (elapsedTime > MAX_CONVERSATION_TIME) {
                  console.log('⏰ Conversation timeout reached')
                  const timeoutMessage = "I'm sorry, but our conversation time limit has been reached. Thank you for calling!"
                  await sendTTSResponse(timeoutMessage, streamSid, socket)
                  console.log('🎤 Sent timeout message to caller')
                  socket.close()
                  return
                }
                
                if (messageCount > MAX_MESSAGES) {
                  console.log('💬 Message limit reached')
                  const limitMessage = "I've reached my conversation limit for this call. Let me transfer you to a human representative. Thank you!"
                  await sendTTSResponse(limitMessage, streamSid, socket)
                  console.log('🎤 Sent message limit notification to caller')
                  socket.close()
                  return
                }
                
                // Generate AI response
                const aiResponse = await generateReceptionistResponse(tenantId, transcription)
                console.log('🤖 AI Response:', aiResponse)
                
                // Convert to speech and send back as chunked μ-law
                await sendTTSResponse(aiResponse, streamSid, socket)
                console.log('🎤 Sent AI response to caller')
              }
            }
          }
          
        } else if (data.event === 'stop') {
          console.log('⏹️ Media stream stopped')
          
          // Send final goodbye if we have a streamSid
          if (streamSid && tenantId) {
            const goodbye = "Thank you for calling. Have a great day!"
            await sendTTSResponse(goodbye, streamSid, socket)
            console.log('🎤 Sent goodbye to caller')
          }
        }
      } catch (err) {
        console.error('❌ Error processing Twilio message:', err)
        console.log('Raw message:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔌 WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
    }

    console.log('✅ WebSocket upgrade successful, returning response')
    return response

  } catch (error) {
    console.error('❌ Failed to upgrade WebSocket:', error)
    return new Response(`WebSocket upgrade failed: ${error.message}`, { 
      status: 500,
      headers: corsHeaders 
    })
  }
})