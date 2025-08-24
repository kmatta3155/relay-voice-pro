import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  console.log('twilio-voice-stream: incoming request', req.method, req.url)
  const { headers } = req
  const upgradeHeader = headers.get("upgrade") || ""
  console.log('twilio-voice-stream: upgrade header =', upgradeHeader)

  if (upgradeHeader.toLowerCase() !== "websocket") {
    console.log('twilio-voice-stream: non-websocket request received')
    return new Response("Expected WebSocket connection", { status: 400 })
  }

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const callSid = url.searchParams.get('call_sid')

  if (!tenantId || !callSid) {
    console.error('twilio-voice-stream: missing params', { tenantId, callSid })
    return new Response("Missing required parameters", { status: 400 })
  }

  console.log('Starting voice stream for tenant:', tenantId, 'call:', callSid)

  const clientProtocols = headers.get('sec-websocket-protocol') || ''
  const requested = clientProtocols.split(',').map(p => p.trim())
  const selectedProtocol = requested.includes('audio') ? 'audio' : (requested[0] || undefined)
  console.log('twilio-voice-stream: requested protocols =', requested, 'selected =', selectedProtocol)

  const { socket, response } = Deno.upgradeWebSocket(req, { protocol: selectedProtocol })
  
  let openAISocket: WebSocket | null = null
  let conversationActive = false
  let audioBuffer: string[] = []
  let streamSid: string | null = null
  let agent: any = null
  let settings: any = null

  // Supabase client will be initialized after WebSocket upgrade to avoid handshake delays
  let supabase: any = null

  // Connect to OpenAI Realtime API
  const connectToOpenAI = () => {
    const openAIUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`
    openAISocket = new WebSocket(openAIUrl, [], {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    })

    openAISocket.onopen = () => {
      console.log('Connected to OpenAI Realtime API')
      conversationActive = true

      // Wait for session.created then configure session
      console.log('Connected to OpenAI, waiting for session.created')
    }

    openAISocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('OpenAI message:', data.type)

        switch (data.type) {
          case 'session.created':
            console.log('OpenAI session created')
            // Configure session after receiving session.created
            const sessionConfig = {
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions: agent.system_prompt || 'You are a helpful AI receptionist.',
                voice: 'alloy',
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                input_audio_transcription: {
                  model: 'whisper-1'
                },
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500
                },
                tools: [
                  {
                    type: 'function',
                    name: 'schedule_appointment',
                    description: 'Schedule an appointment for the caller',
                    parameters: {
                      type: 'object',
                      properties: {
                        service: { type: 'string' },
                        date: { type: 'string' },
                        time: { type: 'string' },
                        name: { type: 'string' },
                        phone: { type: 'string' }
                      },
                      required: ['service', 'date', 'time', 'name', 'phone']
                    }
                  }
                ],
                tool_choice: 'auto',
                max_response_output_tokens: 'inf'
              }
            }
            openAISocket!.send(JSON.stringify(sessionConfig))
            console.log('Session configuration sent')
            break

          case 'session.updated':
            console.log('OpenAI session updated')
            break

          case 'response.audio.delta':
            // Send mulaw audio directly to Twilio (OpenAI now outputs mulaw)
            if (socket.readyState === WebSocket.OPEN && streamSid) {
              socket.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: {
                  payload: data.delta
                }
              }))
            }
            break

          case 'response.function_call_arguments.done':
            handleFunctionCall(data)
            break

          case 'input_audio_buffer.speech_started':
            console.log('User started speaking')
            break

          case 'input_audio_buffer.speech_stopped':
            console.log('User stopped speaking')
            break

          case 'error':
            console.error('OpenAI error:', data.error)
            break
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error)
      }
    }

    openAISocket.onerror = (error) => {
      console.error('OpenAI WebSocket error:', error)
    }

    openAISocket.onclose = () => {
      console.log('OpenAI connection closed')
      conversationActive = false
    }
  }

  const handleFunctionCall = async (data: any) => {
    const { call_id, arguments: args } = data
    const parsedArgs = JSON.parse(args)

    console.log('Function call:', data.name, parsedArgs)

    switch (data.name) {
      case 'transfer_to_human':
        if (settings?.forward_number) {
          // End the AI conversation and transfer
          socket.send(JSON.stringify({
            event: 'clear',
          }))
          socket.send(JSON.stringify({
            event: 'media',
            media: {
              payload: btoa(String.fromCharCode(...new Uint8Array(
                await generateTransferAudio("Transferring you to a human representative. Please hold.")
              )))
            }
          }))
          
          setTimeout(() => {
            socket.close(1000, 'Transferring to human')
          }, 3000)
        }
        break

      case 'schedule_appointment':
        try {
          await supabase
            .from('appointments')
            .insert({
              tenant_id: tenantId,
              title: `${parsedArgs.service} - ${parsedArgs.name}`,
              customer: parsedArgs.name,
              start_at: new Date(`${parsedArgs.date} ${parsedArgs.time}`).toISOString(),
              end_at: new Date(new Date(`${parsedArgs.date} ${parsedArgs.time}`).getTime() + 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString()
            })

          // Send response back to OpenAI
          if (openAISocket && openAISocket.readyState === WebSocket.OPEN) {
            openAISocket.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id,
                output: JSON.stringify({ success: true, message: 'Appointment scheduled successfully' })
              }
            }))
          }
        } catch (error) {
          console.error('Error scheduling appointment:', error)
          if (openAISocket && openAISocket.readyState === WebSocket.OPEN) {
            openAISocket.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id,
                output: JSON.stringify({ success: false, message: 'Failed to schedule appointment' })
              }
            }))
          }
        }
        break
    }
  }

  const generateTransferAudio = async (text: string): Promise<ArrayBuffer> => {
    // Simple text-to-speech for transfer message
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
        response_format: 'mulaw',
      }),
    })
    return await response.arrayBuffer()
  }

  // Audio conversion functions
  const convertMulawToPCM16 = (mulawBase64: string): string => {
    // Decode base64 to get mulaw bytes
    const mulawBytes = Uint8Array.from(atob(mulawBase64), c => c.charCodeAt(0))
    
    // Convert mulaw to PCM16 (simplified conversion)
    const pcm16Data = new Int16Array(mulawBytes.length)
    for (let i = 0; i < mulawBytes.length; i++) {
      // Simplified mulaw to linear conversion
      let sample = mulawBytes[i]
      sample = ~sample
      let mantissa = (sample & 0x0F) << 3
      let exponent = (sample & 0x70) >> 4
      if (exponent > 0) mantissa += 0x84
      let linear = mantissa << (exponent + 3)
      if (sample & 0x80) linear = -linear
      pcm16Data[i] = Math.max(-32768, Math.min(32767, linear))
    }
    
    // Convert to base64
    const bytes = new Uint8Array(pcm16Data.buffer)
    return btoa(String.fromCharCode(...bytes))
  }

  const convertPCM16ToMulaw = (pcm16Base64: string): string => {
    // Decode base64 to get PCM16 bytes
    const pcm16Bytes = Uint8Array.from(atob(pcm16Base64), c => c.charCodeAt(0))
    const pcm16Data = new Int16Array(pcm16Bytes.buffer)
    
    // Convert PCM16 to mulaw
    const mulawData = new Uint8Array(pcm16Data.length)
    for (let i = 0; i < pcm16Data.length; i++) {
      let sample = pcm16Data[i]
      const sign = sample < 0 ? 0x80 : 0x00
      if (sample < 0) sample = -sample
      
      sample += 0x84
      let exponent = 7
      for (let exp = 0; exp < 8; exp++) {
        if (sample <= (0x84 << exp)) {
          exponent = exp
          break
        }
      }
      
      const mantissa = (sample >> (exponent + 3)) & 0x0F
      mulawData[i] = ~(sign | (exponent << 4) | mantissa)
    }
    
    return btoa(String.fromCharCode(...mulawData))
  }

  socket.onopen = async () => {
    console.log('Twilio stream connected')
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
      supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const agentRes = await supabase
        .from('ai_agents')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('mode', 'live')
        .eq('status', 'ready')
        .single()

      agent = agentRes.data

      const settingsRes = await supabase
        .from('agent_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()

      settings = settingsRes.data

      if (!agent) {
        console.error('No ready agent in live mode found for tenant:', tenantId)
        socket.close(1000, 'No agent available in live mode')
        return
      }

      connectToOpenAI()
    } catch (err) {
      console.error('Failed to initialize on socket open:', err)
      socket.close(1011, 'Initialization error')
    }
  }

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      
      switch (message.event) {
        case 'connected':
          console.log('Twilio stream established')
          break

        case 'start':
          console.log('Call started:', message.start)
          streamSid = message.start.streamSid
          break

        case 'media':
          // Send mulaw audio directly to OpenAI (it now accepts mulaw)
          if (openAISocket && openAISocket.readyState === WebSocket.OPEN && conversationActive) {
            openAISocket.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: message.media.payload
            }))
          }
          break

        case 'stop':
          console.log('Call ended')
          if (openAISocket) {
            openAISocket.close()
          }
          break
      }
    } catch (error) {
      console.error('Error processing Twilio message:', error)
    }
  }

  socket.onclose = () => {
    console.log('Twilio stream disconnected')
    if (openAISocket) {
      openAISocket.close()
    }
    
    // Update call record
    supabase
      .from('calls')
      .update({ 
        outcome: 'completed',
        duration: Math.floor((Date.now() - new Date().getTime()) / 1000)
      })
      .eq('from', callSid)
      .then(() => console.log('Call record updated'))
      .catch(err => console.error('Failed to update call record:', err))
  }

  return response
})