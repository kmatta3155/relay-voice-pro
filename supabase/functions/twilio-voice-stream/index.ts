import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get the trained AI agent for this tenant
  let agentConfig = null;
  if (tenantId) {
    try {
      const { data: agent } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'ready')
        .eq('mode', 'live')
        .single();

      if (agent) {
        agentConfig = agent;
        console.log('✅ Found live AI agent:', agent.name, 'Voice:', agent.voice_provider, agent.voice_id);
      } else {
        console.log('⚠️ No live AI agent found for tenant:', tenantId);
      }
    } catch (error) {
      console.error('❌ Error fetching agent config:', error);
    }
  }

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
    // Echo back exactly what Twilio requested (first subprotocol) per RFC6455
    const chosenProtocol = requestedProtocols.length > 0 ? requestedProtocols[0] : undefined
    console.log('Requested subprotocols from client:', requestedProtocols, 'Chosen:', chosenProtocol)
    const { socket, response } = Deno.upgradeWebSocket(req, {
      protocol: chosenProtocol,
    })

    // Initialize OpenAI WebSocket connection if we have an agent
    let openAISocket = null;
    let audioBuffer = [];
    let mediaStreamSid = null;

    const enableAI = false; // Temporary: disable AI bridge to stabilize calls
    if (enableAI && agentConfig) {
      console.log('🤖 Initializing OpenAI Realtime API connection...');
      
      const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openAIApiKey) {
        console.error('❌ OPENAI_API_KEY not set');
      } else {
        try {
          openAISocket = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
            headers: {
              "Authorization": `Bearer ${openAIApiKey}`,
              "OpenAI-Beta": "realtime=v1"
            }
          });

          openAISocket.onopen = () => {
            console.log('🔗 OpenAI WebSocket connected');
            
            // Send session configuration
            openAISocket.send(JSON.stringify({
              type: "session.update",
              session: {
                modalities: ["text", "audio"],
                instructions: agentConfig.system_prompt,
                voice: agentConfig.voice_id || "alloy",
                input_audio_format: "pcm16",
                output_audio_format: "pcm16",
                input_audio_transcription: {
                  model: "whisper-1"
                },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 1000
                },
                temperature: 0.8
              }
            }));
          };

          openAISocket.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('🤖 OpenAI event:', data.type);
              
              if (data.type === 'session.created') {
                console.log('✅ OpenAI session created');
              } else if (data.type === 'response.audio.delta') {
                // Convert base64 PCM to μ-law for Twilio
                const audioData = data.delta;
                if (mediaStreamSid && socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({
                    event: 'media',
                    streamSid: mediaStreamSid,
                    media: {
                      payload: audioData
                    }
                  }));
                }
              } else if (data.type === 'response.audio_transcript.delta') {
                console.log('🗣️ AI speaking:', data.delta);
              }
            } catch (err) {
              console.error('❌ Error parsing OpenAI message:', err);
            }
          };

          openAISocket.onerror = (error) => {
            console.error('❌ OpenAI WebSocket error:', error);
          };

          openAISocket.onclose = (event) => {
            console.log('🔌 OpenAI WebSocket closed:', event.code, event.reason);
          };
        } catch (error) {
          console.error('❌ Failed to initialize OpenAI connection:', error);
        }
      }
    }

    socket.onopen = () => {
      console.log('✅ Twilio WebSocket connection established successfully!')
      if (agentConfig) {
        console.log('🤖 AI Agent ready:', agentConfig.name)
      } else {
        console.log('⚠️ No AI agent - will only log events')
      }
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.event === 'connected') {
          console.log('🔗 Twilio WebSocket connected!')
        } else if (data.event === 'start') {
          console.log('▶️ Media stream started:', {
            streamSid: data.start?.streamSid,
            callSid: data.start?.callSid,
            tracks: data.start?.tracks,
            mediaFormat: data.start?.mediaFormat
          })
          mediaStreamSid = data.start?.streamSid;
          
          // Send initial greeting if we have an agent
          if (agentConfig && openAISocket && openAISocket.readyState === WebSocket.OPEN) {
            const greeting = agentConfig.overrides?.firstMessage || `Hello! I'm ${agentConfig.name}. How can I help you today?`;
            openAISocket.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'input_text', text: greeting }]
              }
            }));
            openAISocket.send(JSON.stringify({ type: 'response.create' }));
          }
        } else if (data.event === 'media') {
          // Forward audio to OpenAI if connected
          if (openAISocket && openAISocket.readyState === WebSocket.OPEN) {
            // Convert μ-law to PCM16 and send to OpenAI
            openAISocket.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: data.media.payload // Twilio sends base64 μ-law, need conversion
            }));
          }
        } else if (data.event === 'stop') {
          console.log('⏹️ Media stream stopped')
          if (openAISocket) {
            openAISocket.close();
          }
        }
      } catch (err) {
        console.error('❌ Error parsing Twilio message:', err)
        console.log('Raw message:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔌 Twilio WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
      if (openAISocket) {
        openAISocket.close();
      }
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