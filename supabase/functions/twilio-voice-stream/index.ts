import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  const { headers } = req
  const upgradeHeader = headers.get("upgrade") || ""

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 })
  }

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  const callSid = url.searchParams.get('call_sid')

  if (!tenantId || !callSid) {
    return new Response("Missing required parameters", { status: 400 })
  }

  console.log('Starting voice stream for tenant:', tenantId, 'call:', callSid)

  const { socket, response } = Deno.upgradeWebSocket(req)
  
  let openAISocket: WebSocket | null = null
  let conversationActive = false
  let audioBuffer: string[] = []

  // Get AI agent configuration
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('mode', 'live')
    .eq('status', 'ready')
    .single()

  const { data: settings } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()

  if (!agent) {
    console.error('No ready agent in live mode found for tenant:', tenantId)
    socket.close(1000, 'No agent available in live mode')
    return response
  }

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

      // Configure session after connection
      setTimeout(() => {
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: agent.system_prompt || 'You are a helpful AI receptionist.',
            voice: 'alloy',
            input_audio_format: 'mulaw',
            output_audio_format: 'mulaw',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000
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
            temperature: 0.8,
            max_response_output_tokens: 'inf'
          }
        }
        
        openAISocket!.send(JSON.stringify(sessionConfig))
        console.log('Session configured')
      }, 100)
    }

    openAISocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('OpenAI message:', data.type)

        switch (data.type) {
          case 'session.created':
            console.log('OpenAI session created')
            break

          case 'session.updated':
            console.log('OpenAI session updated')
            break

          case 'response.audio.delta':
            // Send audio back to Twilio
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                event: 'media',
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

  socket.onopen = () => {
    console.log('Twilio stream connected')
    connectToOpenAI()
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
          break

        case 'media':
          // Forward audio to OpenAI
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