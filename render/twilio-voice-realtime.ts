/*
 * OpenAI Realtime API Bridge for Twilio Voice Calls - Render.com Deployment
 * 
 * This is a standalone version of the Supabase Edge Function, deployed to Render.com
 * to bypass the 6-minute WebSocket limit.
 * 
 * Architecture: Twilio Media Streams (μ-law 8kHz) ↔ OpenAI Realtime API (PCM16 24kHz)
 * 
 * Key Features:
 * - No time limits (unlike Supabase's 400s limit)
 * - Bidirectional audio streaming with codec conversion
 * - OpenAI server_vad (no custom VAD needed)
 * - RAG tool integration for knowledge base search via Supabase
 * - Tenant-specific agent configuration
 */

const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message: string, data?: any) => console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '')
}

// Environment setup
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
// Service role key supports both names (SUPABASE_* prefix blocked in Supabase Edge Functions)
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const PORT = parseInt(Deno.env.get('PORT') || '8000')

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  logger.error('Missing required environment variables', {
    hasSupabaseUrl: !!SUPABASE_URL,
    hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
    hasOpenAIKey: !!OPENAI_API_KEY
  })
  Deno.exit(1)
}

// Audio constants
const TWILIO_SAMPLE_RATE = 8000
const OPENAI_SAMPLE_RATE = 24000
const FRAME_SIZE_MULAW = 160
const FRAME_SIZE_PCM16_8K = 320

// ========== AUDIO CODEC CONVERSION ==========

function mulawToPcm(mulaw: number): number {
  mulaw = (~mulaw) & 0xff
  const sign = mulaw & 0x80
  const exponent = (mulaw >> 4) & 0x07
  const mantissa = mulaw & 0x0f
  const sample = ((mantissa | 0x10) << (exponent + 3)) - 0x84
  return sign ? -sample : sample
}

function pcmToMulaw(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  let sign = 0
  
  if (sample < 0) {
    sign = 0x80
    sample = -sample
  }
  
  if (sample > CLIP) sample = CLIP
  sample += BIAS
  
  let exponent = 7
  let mantissa = 0x4000
  for (let i = 0; i < 7; i++) {
    if (sample <= mantissa) {
      exponent = i
      break
    }
    mantissa >>= 1
  }
  
  mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function resample8kTo24k(pcm8k: Int16Array): Int16Array {
  const ratio = 3
  const pcm24k = new Int16Array(pcm8k.length * ratio)
  for (let i = 0; i < pcm8k.length; i++) {
    const value = pcm8k[i]
    pcm24k[i * ratio] = value
    pcm24k[i * ratio + 1] = value
    pcm24k[i * ratio + 2] = value
  }
  return pcm24k
}

function resample24kTo8k(pcm24k: Int16Array): Int16Array {
  const ratio = 3
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / ratio))
  for (let i = 0; i < pcm8k.length; i++) {
    pcm8k[i] = pcm24k[i * ratio]
  }
  return pcm8k
}

// ========== WEBSOCKET BRIDGE CLASS ==========

class TwilioOpenAIBridge {
  private twilioWs: WebSocket
  private openaiWs!: WebSocket
  private tenantId: string
  private streamSid = ''
  private callSid = ''
  private isClosed = false
  private outboundSeq = 0
  
  // Custom parameters from Twilio (fallback if database fails)
  private greeting = ''
  private businessName = ''
  private customInstructions = ''
  
  // Keepalive and session management
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null
  private sessionStartTime: number = 0
  private readonly KEEPALIVE_INTERVAL_MS = 30000
  private readonly SESSION_REFRESH_MS = 25 * 60 * 1000

  constructor(twilioWs: WebSocket, tenantId: string) {
    this.twilioWs = twilioWs
    this.tenantId = tenantId
    
    this.twilioWs.onopen = () => {
      logger.info('Twilio WebSocket connected', { tenantId: this.tenantId })
    }
    
    this.twilioWs.onmessage = (event) => {
      this.handleTwilioMessage(event.data)
    }
    
    this.twilioWs.onerror = (error) => {
      logger.error('Twilio WebSocket error', { error })
      this.cleanup()
    }
    
    this.twilioWs.onclose = () => {
      logger.info('Twilio WebSocket closed')
      this.cleanup()
    }
  }

  private async initOpenAI() {
    try {
      // Fetch tenant configuration from Supabase
      const agentConfig = await this.fetchAgentConfig()
      
      logger.info('Initializing OpenAI connection', {
        tenantId: this.tenantId,
        hasConfig: !!agentConfig
      })

      // Connect to OpenAI Realtime API with required subprotocols
      this.openaiWs = new WebSocket(
        'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
        ['realtime', `openai-insecure-api-key.${OPENAI_API_KEY}`, 'openai-beta.realtime-v1']
      )

      this.openaiWs.onopen = () => {
        logger.info('OpenAI WebSocket connected successfully')
        this.sessionStartTime = Date.now()
        this.startKeepalive()
        this.configureSession(agentConfig)
      }

      this.openaiWs.onmessage = (event) => {
        this.handleOpenAIMessage(event.data)
      }

      this.openaiWs.onerror = (error) => {
        logger.error('OpenAI WebSocket error', { error })
        this.cleanup()
      }

      this.openaiWs.onclose = () => {
        logger.info('OpenAI WebSocket closed')
        this.cleanup()
      }
    } catch (error) {
      logger.error('Failed to initialize OpenAI', { error })
      this.cleanup()
    }
  }

  private async fetchAgentConfig() {
    try {
      logger.info('Fetching agent config from Supabase', {
        tenantId: this.tenantId,
        supabaseUrl: SUPABASE_URL,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY
      })

      const url = `${SUPABASE_URL}/rest/v1/tenants?id=eq.${this.tenantId}&select=voice_settings`
      const response = await fetch(url, {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      logger.info('Supabase fetch response', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Supabase fetch failed', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        })
        throw new Error(`Failed to fetch tenant config: ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()
      logger.info('Agent config fetched successfully', {
        hasData: !!data,
        dataLength: data?.length,
        hasVoiceSettings: !!data[0]?.voice_settings
      })

      return data[0]?.voice_settings || {}
    } catch (error) {
      logger.error('Error fetching agent config', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        tenantId: this.tenantId
      })
      return {}
    }
  }

  private configureSession(config: any) {
    // Use custom instructions from parameters if database config is empty
    const instructions = config?.instructions || this.customInstructions || 
      `You are a helpful AI receptionist for ${this.businessName || 'this business'}. Be professional, friendly, and helpful.`
    
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        voice: config?.voice || 'alloy',
        instructions,
        temperature: config?.temperature || 0.8,
        max_response_output_tokens: 4096,
        tools: [
          {
            type: 'function',
            name: 'search_knowledge',
            description: 'Search the knowledge base for information',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The search query' }
              },
              required: ['query']
            }
          }
        ]
      }
    }

    this.openaiWs.send(JSON.stringify(sessionConfig))
    logger.info('OpenAI session configured', {
      voice: sessionConfig.session.voice,
      hasCustomInstructions: !!config?.instructions,
      instructionsLength: instructions.length
    })

    // CRITICAL FIX: Send greeting to make AI speak first
    if (this.greeting) {
      logger.info('Sending initial greeting', { greeting: this.greeting.substring(0, 50) + '...' })
      
      // Wait a moment for session.updated, then send greeting
      setTimeout(() => {
        const greetingMessage = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Please say: "${this.greeting}"`
              }
            ]
          }
        }
        
        // Explicitly request audio output in the response
        const createResponse = {
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions: `Say exactly: "${this.greeting}"`
          }
        }
        
        this.openaiWs.send(JSON.stringify(greetingMessage))
        this.openaiWs.send(JSON.stringify(createResponse))
        
        logger.info('Greeting message sent to OpenAI with audio modality')
      }, 500)
    } else {
      logger.warn('No greeting provided - AI will wait for user to speak first')
    }
  }

  private handleTwilioMessage(data: string) {
    try {
      const message = JSON.parse(data)

      switch (message.event) {
        case 'start':
          this.streamSid = message.start.streamSid
          this.callSid = message.start.callSid
          const customParams = message.start.customParameters || {}
          
          // Log ALL received parameters for debugging
          logger.info('Twilio start event received', {
            streamSid: this.streamSid,
            callSid: this.callSid,
            customParametersReceived: customParams,
            tenantIdBeforeCheck: this.tenantId
          })
          
          // Support both naming conventions (router sends tenantId, but allow tenant_id too)
          const customTenantId = customParams.tenant_id || customParams.tenantId || customParams.TENANT_ID || ''
          if (customTenantId) {
            this.tenantId = customTenantId.trim()
            logger.info('Tenant ID updated from customParameters', {
              source: 'customParameters',
              tenantId: this.tenantId
            })
          } else if (this.tenantId) {
            logger.info('Using tenant ID from URL query parameter', {
              source: 'url',
              tenantId: this.tenantId
            })
          } else {
            logger.error('CRITICAL: No tenant ID available from any source!', {
              urlTenantId: this.tenantId,
              customParams
            })
          }

          // Store custom parameters as fallback
          this.greeting = (customParams.greeting || '').trim()
          this.businessName = (customParams.businessName || '').trim()
          this.customInstructions = (customParams.instructions || '').trim()
          
          logger.info('Twilio stream started - Final state', {
            streamSid: this.streamSid,
            callSid: this.callSid,
            tenantId: this.tenantId,
            hasTenantId: !!this.tenantId,
            hasGreeting: !!this.greeting,
            hasBusinessName: !!this.businessName,
            greeting: this.greeting ? this.greeting.substring(0, 50) + '...' : 'none'
          })
          
          this.initOpenAI()
          break

        case 'media':
          if (this.openaiWs?.readyState === WebSocket.OPEN) {
            const mulawData = Uint8Array.from(atob(message.media.payload), c => c.charCodeAt(0))
            const pcm8k = new Int16Array(mulawData.length)
            for (let i = 0; i < mulawData.length; i++) {
              pcm8k[i] = mulawToPcm(mulawData[i])
            }
            const pcm24k = resample8kTo24k(pcm8k)
            const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcm24k.buffer)))
            
            this.openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: base64Audio
            }))
          }
          break

        case 'stop':
          logger.info('Twilio stream stopped', { streamSid: this.streamSid })
          this.cleanup()
          break
      }
    } catch (error) {
      logger.error('Error handling Twilio message', { error })
    }
  }

  private async handleOpenAIMessage(data: string) {
    try {
      const message = JSON.parse(data)

      // Log ALL events for debugging
      if (!['response.audio_transcript.delta', 'input_audio_buffer.speech_started'].includes(message.type)) {
        logger.info(`OpenAI event: ${message.type}`, { 
          hasAudio: !!message.delta || !!message.audio,
          keys: Object.keys(message)
        })
      }

      // CRITICAL DEBUG: Log when we get audio delta
      if (message.type === 'response.audio.delta') {
        logger.info('🎵 AUDIO DELTA RECEIVED', {
          hasDelta: !!message.delta,
          deltaLength: message.delta?.length,
          twilioOpen: this.twilioWs?.readyState === WebSocket.OPEN,
          streamSid: this.streamSid
        })
      }

      switch (message.type) {
        case 'session.created':
        case 'session.updated':
          logger.info(`OpenAI ${message.type}`)
          break

        case 'response.audio.delta':
        case 'response.audio_delta':  // Try both event names
          logger.info('📢 AUDIO CASE MATCHED!', {
            hasDelta: !!message.delta,
            twilioOpen: this.twilioWs?.readyState === WebSocket.OPEN
          })
          
          if (this.twilioWs?.readyState === WebSocket.OPEN && message.delta) {
            try {
              // CRITICAL FIX: Properly decode base64 PCM16 audio
              // Step 1: Decode base64 to raw bytes
              const audioBytes = Uint8Array.from(atob(message.delta), c => c.charCodeAt(0))
              
              // Step 2: Interpret bytes as 16-bit PCM samples (little-endian)
              const pcm24k = new Int16Array(audioBytes.buffer)
              
              // Step 3: Resample from 24kHz to 8kHz
              const pcm8k = resample24kTo8k(pcm24k)
              
              // Step 4: Convert PCM16 to μ-law
              const mulaw = new Uint8Array(pcm8k.length)
              for (let i = 0; i < pcm8k.length; i++) {
                mulaw[i] = pcmToMulaw(pcm8k[i])
              }
              
              // Step 5: Encode μ-law to base64 and send to Twilio
              const base64Mulaw = btoa(String.fromCharCode(...mulaw))
              
              const mediaMessage = {
                event: 'media',
                streamSid: this.streamSid,
                media: {
                  payload: base64Mulaw
                }
              }
              
              // Log before sending
              if (this.outboundSeq === 0) {
                logger.info('🚀 SENDING FIRST AUDIO PACKET', {
                  mulawBytes: mulaw.length,
                  base64Length: base64Mulaw.length,
                  streamSid: this.streamSid
                })
              }
              
              this.twilioWs.send(JSON.stringify(mediaMessage))
              this.outboundSeq++
              
              // Log every 10th chunk to confirm it's working
              if (this.outboundSeq % 10 === 1) {
                logger.info('✅ AUDIO SENT TO TWILIO', {
                  seq: this.outboundSeq - 1,
                  pcm24kSamples: pcm24k.length,
                  pcm8kSamples: pcm8k.length,
                  mulawBytes: mulaw.length,
                  base64Length: base64Mulaw.length
                })
              }
            } catch (error) {
              logger.error('❌ AUDIO PROCESSING ERROR', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                hasDelta: !!message.delta,
                deltaLength: message.delta?.length
              })
            }
          } else {
            logger.warn('Cannot send audio', {
              twilioReady: this.twilioWs?.readyState === WebSocket.OPEN,
              hasDelta: !!message.delta,
              streamSid: this.streamSid
            })
          }
          break

        case 'response.audio_transcript.delta':
          logger.debug('AI speaking', { text: message.delta })
          break

        case 'input_audio_buffer.speech_started':
          logger.debug('User started speaking')
          break

        case 'conversation.item.input_audio_transcription.completed':
          logger.info('User said', { transcript: message.transcript })
          break

        case 'response.function_call_arguments.done':
          await this.handleFunctionCall(message)
          break

        case 'error':
          logger.error('OpenAI error', { error: message.error })
          break
      }
    } catch (error) {
      logger.error('Error handling OpenAI message', { error })
    }
  }

  private async handleFunctionCall(message: any) {
    try {
      const { name, arguments: args, call_id } = message
      
      if (name === 'search_knowledge') {
        const { query } = JSON.parse(args)
        logger.info('Executing knowledge search', { query })
        
        // Search knowledge base via Supabase
        const results = await this.searchKnowledge(query)
        
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id,
            output: JSON.stringify(results)
          }
        }))
        
        this.openaiWs?.send(JSON.stringify({ type: 'response.create' }))
      }
    } catch (error) {
      logger.error('Error handling function call', { error })
    }
  }

  private async searchKnowledge(query: string) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_knowledge`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query_text: query,
          tenant_id_param: this.tenantId,
          match_count: 5
        })
      })

      if (!response.ok) {
        throw new Error(`Knowledge search failed: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      logger.error('Knowledge search error', { error })
      return []
    }
  }

  private cleanup() {
    if (this.isClosed) return
    this.isClosed = true
    
    logger.info('Cleaning up bridge', {
      streamSid: this.streamSid,
      callSid: this.callSid
    })
    
    this.stopKeepalive()
    
    try {
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close()
      }
    } catch (error) {
      logger.error('Error closing OpenAI WebSocket', { error })
    }
    
    try {
      if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
        this.twilioWs.close()
      }
    } catch (error) {
      logger.error('Error closing Twilio WebSocket', { error })
    }
  }

  private startKeepalive() {
    this.stopKeepalive()
    
    logger.info('Starting keepalive monitoring')
    
    this.keepaliveInterval = setInterval(() => {
      const sessionDuration = Date.now() - this.sessionStartTime
      
      if (sessionDuration >= this.SESSION_REFRESH_MS) {
        logger.warn('Approaching OpenAI 30-minute session limit', {
          sessionDurationMinutes: Math.floor(sessionDuration / 60000)
        })
      }
      
      logger.debug('Session health check', {
        sessionDurationMinutes: Math.floor(sessionDuration / 60000),
        twilioOpen: this.twilioWs?.readyState === WebSocket.OPEN,
        openaiOpen: this.openaiWs?.readyState === WebSocket.OPEN
      })
    }, this.KEEPALIVE_INTERVAL_MS)
  }

  private stopKeepalive() {
    if (this.keepaliveInterval !== null) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
      logger.debug('Keepalive stopped')
    }
  }
}

// ========== HTTP SERVER ==========

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url)
  
  // Health check endpoint for Render
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'healthy', service: 'twilio-voice-realtime' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    })
  }

  // WebSocket upgrade
  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    // Extract tenant_id from URL query parameter (sent by router)
    const tenantIdFromUrl = url.searchParams.get('tenant_id') || ''
    
    logger.info('WebSocket upgrade request', { 
      fullUrl: req.url,
      queryParams: Object.fromEntries(url.searchParams.entries()),
      tenantIdFromUrl,
      note: 'tenant_id will also be checked in Twilio customParameters'
    })

    const { socket, response } = Deno.upgradeWebSocket(req)
    new TwilioOpenAIBridge(socket, tenantIdFromUrl)
    
    return response
  }

  return new Response('Voice Relay Pro - Twilio Voice Realtime Service', {
    headers: { 'Content-Type': 'text/plain' }
  })
})

logger.info(`🚀 Twilio Voice Realtime service running on port ${PORT}`)
logger.info('Environment check', {
  hasSupabaseUrl: !!SUPABASE_URL,
  hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
  hasOpenAIKey: !!OPENAI_API_KEY
})
