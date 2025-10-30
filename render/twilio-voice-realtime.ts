/*
 * OpenAI Realtime API Bridge for Twilio Voice Calls - Render.com Deployment
 * 
 * This is a standalone version of the Supabase Edge Function, deployed to Render.com
 * to bypass the 6-minute WebSocket limit.
 * 
 * Architecture: Twilio Media Streams (g711_ulaw 8kHz) ↔ OpenAI Realtime API (g711_ulaw 8kHz)
 * 
 * Key Features:
 * - No time limits (unlike Supabase's 400s limit)
 * - DIRECT PASSTHROUGH - Zero audio conversion (both sides use g711_ulaw)
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

// NO AUDIO CONVERSION NEEDED - Direct g711_ulaw passthrough!

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
    // NOTE: voice_settings column doesn't exist in tenants table yet
    // Using fallback configuration from Twilio parameters instead
    logger.info('Using default agent config (voice_settings column not implemented)', {
      tenantId: this.tenantId
    })
    return {}
  }

  private configureSession(config: any) {
    // Use custom instructions from parameters if database config is empty
    const defaultInstructions = `You are a professional AI receptionist for ${this.businessName || 'this business'}.

CRITICAL: When customers ask questions about the business (hours, location, services, pricing, policies, etc.), you MUST use the search_knowledge function to find accurate information from the knowledge base.

NEVER make up or guess information. ALWAYS search the knowledge base first using search_knowledge before answering questions about:
- Business hours or operating times
- Location, address, or directions  
- Services offered or menu items
- Pricing or costs
- Policies or procedures
- Staff members or team
- Appointment availability or booking

After receiving search results, provide the information naturally in your response. If the knowledge base doesn't have the answer, politely say you don't have that information and offer to take a message or have someone call them back.

Be warm, professional, and helpful in all interactions.`
    
    const instructions = config?.instructions || this.customInstructions || defaultInstructions
    
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',  // Direct passthrough - no conversion needed!
        output_audio_format: 'g711_ulaw', // Direct passthrough - no conversion needed!
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
            // DIRECT PASSTHROUGH: Twilio g711_ulaw → OpenAI g711_ulaw (NO CONVERSION!)
            this.openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: message.media.payload  // Direct base64 µ-law from Twilio
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
            // DIRECT PASSTHROUGH: g711_ulaw → g711_ulaw (NO CONVERSION!)
            const mediaMessage = {
              event: 'media',
              streamSid: this.streamSid,
              media: {
                payload: message.delta  // Direct base64 µ-law from OpenAI
              }
            }
            
            this.twilioWs.send(JSON.stringify(mediaMessage))
            
            if (this.outboundSeq === 0) {
              logger.info('🚀 DIRECT g711_ulaw PASSTHROUGH (ZERO CONVERSION!)', {
                deltaLength: message.delta.length,
                streamSid: this.streamSid
              })
            }
            this.outboundSeq++
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
      logger.info('Searching knowledge base', { 
        query, 
        tenantId: this.tenantId,
        supabaseUrl: SUPABASE_URL 
      })
      
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
        const errorText = await response.text()
        logger.error('Knowledge search HTTP error', { 
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        })
        throw new Error(`Knowledge search failed: ${response.status} ${response.statusText}`)
      }

      const results = await response.json()
      logger.info('Knowledge search results', { 
        resultCount: Array.isArray(results) ? results.length : 0,
        hasResults: !!results && results.length > 0
      })
      
      return results
    } catch (error) {
      logger.error('Knowledge search error', { 
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error?.constructor?.name
      })
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
