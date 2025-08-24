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
  private chunks: string[] = []
  private totalDuration = 0
  
  append(audioBase64: string) {
    this.chunks.push(audioBase64)
    this.totalDuration += 20 // Assuming 20ms chunks
  }
  
  getFullAudio(): string {
    return this.chunks.join('')
  }
  
  clear() {
    this.chunks = []
    this.totalDuration = 0
  }
  
  getDuration(): number {
    return this.totalDuration
  }
}

// Function to transcribe audio using OpenAI Whisper
async function transcribeAudio(audioBase64: string): Promise<string | null> {
  try {
    const binaryString = atob(audioBase64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    
    const formData = new FormData()
    const blob = new Blob([bytes], { type: 'audio/wav' })
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

// Function to convert text to speech using OpenAI TTS
async function textToSpeech(text: string): Promise<string | null> {
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
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    return base64Audio
  } catch (error) {
    console.error('Error converting text to speech:', error)
    return null
  }
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
          
          // Send TwiML event to confirm the outbound audio path
          const twimlResponse = {
            event: 'start',
            start: {
              streamSid: streamSid
            },
            sequenceNumber: '1'
          }
          
          socket.send(JSON.stringify(twimlResponse))
          console.log('🎤 Sent start confirmation to Twilio')
          
          // Send initial greeting
          if (tenantId) {
            const greeting = await generateReceptionistResponse(tenantId, "Hello, please introduce yourself and ask how you can help.")
            const audioBase64 = await textToSpeech(greeting)
            
            if (audioBase64 && streamSid) {
              const mediaMessage = {
                event: 'media',
                streamSid: streamSid,
                media: {
                  payload: audioBase64
                }
              }
              socket.send(JSON.stringify(mediaMessage))
              console.log('🎤 Sent greeting to caller:', greeting)
            }
          }
          
        } else if (data.event === 'media') {
          // Accumulate audio data
          if (data.media?.payload) {
            audioBuffer.append(data.media.payload)
            console.log('🎵 Audio data accumulated (total duration:', audioBuffer.getDuration(), 'ms)')
            
            // Process accumulated audio when we have enough (e.g., 2 seconds)
            if (audioBuffer.getDuration() >= 2000) {
              const fullAudio = audioBuffer.getFullAudio()
              audioBuffer.clear()
              
              console.log('🎙️ Processing accumulated audio for transcription')
              const transcription = await transcribeAudio(fullAudio)
              
              if (transcription && transcription.trim() && tenantId) {
                console.log('📝 Transcribed:', transcription)
                
                // Generate AI response
                const aiResponse = await generateReceptionistResponse(tenantId, transcription)
                console.log('🤖 AI Response:', aiResponse)
                
                // Convert to speech and send back
                const audioBase64 = await textToSpeech(aiResponse)
                
                if (audioBase64 && streamSid) {
                  const mediaMessage = {
                    event: 'media',
                    streamSid: streamSid,
                    media: {
                      payload: audioBase64
                    }
                  }
                  socket.send(JSON.stringify(mediaMessage))
                  console.log('🎤 Sent AI response to caller')
                }
              }
            }
          }
          
        } else if (data.event === 'stop') {
          console.log('⏹️ Media stream stopped')
          
          // Send final goodbye if we have a streamSid
          if (streamSid && tenantId) {
            const goodbye = "Thank you for calling. Have a great day!"
            const audioBase64 = await textToSpeech(goodbye)
            
            if (audioBase64) {
              const mediaMessage = {
                event: 'media',
                streamSid: streamSid,
                media: {
                  payload: audioBase64
                }
              }
              socket.send(JSON.stringify(mediaMessage))
              console.log('🎤 Sent goodbye to caller')
            }
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