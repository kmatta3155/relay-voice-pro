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
  private callerNumber = ''
  
  // Custom parameters from Twilio (fallback if database fails)
  private greeting = ''
  private businessName = ''
  private customInstructions = ''
  
  // Conversation tracking for call summaries
  private conversationHistory: Array<{role: string, content: string, timestamp: number}> = []
  private callStartTime: number = 0
  
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
    
    this.twilioWs.onerror = async (error) => {
      logger.error('Twilio WebSocket error', { error })
      // Make sure cleanup completes before handler exits
      try {
        await this.cleanup()
      } catch (err) {
        logger.error('Cleanup error in error handler', { err })
      }
    }
    
    this.twilioWs.onclose = async () => {
      logger.info('Twilio WebSocket closed')
      // Make sure cleanup completes before handler exits
      try {
        await this.cleanup()
      } catch (err) {
        logger.error('Cleanup error in close handler', { err })
      }
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

      this.openaiWs.onerror = async (error) => {
        logger.error('OpenAI WebSocket error', { error })
        // Make sure cleanup completes before handler exits
        try {
          await this.cleanup()
        } catch (err) {
          logger.error('Cleanup error in OpenAI error handler', { err })
        }
      }

      this.openaiWs.onclose = async () => {
        logger.info('OpenAI WebSocket closed')
        // Make sure cleanup completes before handler exits
        try {
          await this.cleanup()
        } catch (err) {
          logger.error('Cleanup error in OpenAI close handler', { err })
        }
      }
    } catch (error) {
      logger.error('Failed to initialize OpenAI', { error })
      // Await cleanup even during initialization failures
      try {
        await this.cleanup()
      } catch (cleanupError) {
        logger.error('Cleanup error during init failure', { cleanupError })
      }
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
        tool_choice: 'auto',  // CRITICAL: Enable automatic function calling
        tools: [
          {
            type: 'function',
            name: 'search_knowledge',
            description: 'Search the business knowledge base for accurate information about hours, location, services, pricing, and policies. ALWAYS use this before answering business-related questions.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The search query about the business (e.g., "business hours", "location address", "available services")' }
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
      instructionsLength: instructions.length,
      instructionsPreview: instructions.substring(0, 200),
      configInstructions: config?.instructions || 'none',
      customInstructions: this.customInstructions || 'none',
      usingDefaultInstructions: instructions === defaultInstructions
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

  private async handleTwilioMessage(data: string) {
    try {
      const message = JSON.parse(data)

      switch (message.event) {
        case 'start':
          this.streamSid = message.start.streamSid
          this.callSid = message.start.callSid
          this.callStartTime = Date.now()
          this.callerNumber = message.start.from || ''
          const customParams = message.start.customParameters || {}
          
          // Log ALL received parameters for debugging
          logger.info('Twilio start event received', {
            streamSid: this.streamSid,
            callSid: this.callSid,
            from: this.callerNumber,
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
          // Make sure cleanup completes before handler exits
          try {
            await this.cleanup()
          } catch (err) {
            logger.error('Cleanup error in stop event', { err })
          }
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
          // Track AI responses for call summary
          if (message.delta) {
            const lastMsg = this.conversationHistory[this.conversationHistory.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              // Append to last AI message
              lastMsg.content += message.delta
            } else {
              // New AI message
              this.conversationHistory.push({
                role: 'assistant',
                content: message.delta,
                timestamp: Date.now()
              })
            }
          }
          break

        case 'input_audio_buffer.speech_started':
          logger.debug('User started speaking')
          break

        case 'conversation.item.input_audio_transcription.completed':
          logger.info('User said', { transcript: message.transcript })
          // Track user messages for call summary
          if (message.transcript) {
            this.conversationHistory.push({
              role: 'user',
              content: message.transcript,
              timestamp: Date.now()
            })
          }
          break

        case 'response.function_call_arguments.delta':
          // OpenAI sends function arguments in chunks - buffer them
          logger.debug('Function call arguments delta received', { 
            callId: message.call_id,
            name: message.name 
          })
          break

        case 'response.function_call_arguments.done':
          // CRITICAL: Event name has NO dot between "call" and "arguments"!
          logger.info('🔧 Function call ready to execute', { 
            name: message.name,
            callId: message.call_id,
            argumentsLength: message.arguments?.length 
          })
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
      
      logger.info('🔧 handleFunctionCall called', { 
        name, 
        callId: call_id,
        argsRaw: args,
        argsType: typeof args 
      })
      
      if (name === 'search_knowledge') {
        const parsedArgs = JSON.parse(args)
        const { query } = parsedArgs
        
        logger.info('📞 Executing knowledge search', { 
          query,
          queryLength: query?.length,
          parsedArgs 
        })
        
        // Search knowledge base via Supabase
        const results = await this.searchKnowledge(query)
        
        logger.info('📤 Sending function results to OpenAI', {
          resultCount: results.length,
          callId: call_id
        })
        
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
      logger.error('❌ Error handling function call', { 
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }

  private async searchKnowledge(query: string) {
    try {
      logger.info('Searching knowledge base', { 
        query, 
        tenantId: this.tenantId,
        supabaseUrl: SUPABASE_URL 
      })
      
      // FIXED: Call the Edge Function, not RPC endpoint
      const response = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tenant_id: this.tenantId,
          query: query,
          k: 5,
          min_score: 0.3
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

      const responseData = await response.json()
      
      // FIXED: Search Edge Function returns {ok, results, search_type}, not a simple array
      const results = responseData.results || []
      
      logger.info('Knowledge search results', { 
        resultCount: results.length,
        hasResults: results.length > 0,
        searchType: responseData.search_type,
        queryIntent: responseData.query_intent
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

  private async cleanup() {
    if (this.isClosed) return
    this.isClosed = true
    
    logger.info('Cleaning up bridge', {
      streamSid: this.streamSid,
      callSid: this.callSid,
      conversationLength: this.conversationHistory.length
    })
    
    this.stopKeepalive()
    
    // Generate call summary if we have conversation data
    // IMPORTANT: Generate summary even for blocked/anonymous callers
    if (this.conversationHistory.length > 0 && this.tenantId) {
      try {
        await this.generateCallSummary()
      } catch (error) {
        logger.error('Error generating call summary - will retry once', { error })
        // Retry once in case of transient failures
        try {
          await this.generateCallSummary()
        } catch (retryError) {
          logger.error('Failed to generate call summary after retry', { retryError })
        }
      }
    }
    
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

  private async generateCallSummary() {
    try {
      logger.info('Generating call summary', {
        tenantId: this.tenantId,
        caller: this.callerNumber,
        messageCount: this.conversationHistory.length
      })

      // Build conversation transcript
      const transcript = this.conversationHistory
        .map(msg => `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`)
        .join('\n')

      // Use OpenAI to generate summary and extract outcome
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are analyzing a phone call between a customer and a business AI receptionist. 
              
Extract:
1. A brief summary (2-3 sentences) of what was discussed
2. The call outcome from these options:
   - appointment_booked: Customer scheduled an appointment
   - appointment_inquiry: Customer asked about appointments but didn't book
   - pricing_inquiry: Customer asked about prices
   - hours_inquiry: Customer asked about business hours
   - general_inquiry: General questions about services
   - complaint: Customer had a complaint
   - callback_requested: Customer wants a callback
   - wrong_number: Wrong number or spam
   - incomplete: Call disconnected or incomplete

3. If the customer provided their name, extract it
4. If appointment was discussed, extract the service type if mentioned

Respond in JSON format:
{
  "summary": "Brief summary here",
  "outcome": "outcome_type",
  "customer_name": "Name if provided, else null",
  "service_requested": "Service type if discussed, else null",
  "appointment_booked": true/false
}`
            },
            {
              role: 'user',
              content: `Analyze this call transcript:\n\n${transcript}`
            }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }

      const data = await response.json()
      const analysis = JSON.parse(data.choices[0].message.content)
      
      logger.info('Call analysis complete', analysis)

      // Calculate call duration
      const durationSeconds = Math.floor((Date.now() - this.callStartTime) / 1000)

      // Save to Supabase
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

      // Save call record - use placeholder for blocked/anonymous callers
      const callerPhone = this.callerNumber || 'Unknown/Blocked'
      const { data: callRecord, error: callError } = await supabase
        .from('calls')
        .insert({
          tenant_id: this.tenantId,
          from: callerPhone,
          to: this.businessName || 'Voice Relay',
          outcome: analysis.outcome,
          duration: durationSeconds,
          summary: analysis.summary,
          at: new Date(this.callStartTime).toISOString()
        })
        .select()
        .single()

      if (callError) {
        logger.error('Error saving call record', { error: callError })
      } else {
        logger.info('Call record saved', { callId: callRecord.id })
      }

      // Create lead if this was a meaningful inquiry
      // Allow leads even for blocked numbers - they might provide contact info in conversation
      if (analysis.outcome !== 'wrong_number' && analysis.outcome !== 'incomplete') {
        const leadStatus = analysis.appointment_booked ? 'converted' : 
                          analysis.outcome.includes('inquiry') ? 'new' : 'contacted'

        const { data: leadRecord, error: leadError } = await supabase
          .from('leads')
          .insert({
            tenant_id: this.tenantId,
            name: analysis.customer_name || (this.callerNumber ? 'Phone Inquiry' : 'Anonymous Caller'),
            phone: this.callerNumber || null,
            source: 'phone_call',
            status: leadStatus,
            notes: `${analysis.summary}\n\nService interested: ${analysis.service_requested || 'Not specified'}`,
            created_at: new Date().toISOString()
          })
          .select()
          .single()

        if (leadError) {
          logger.error('Error creating lead', { error: leadError })
        } else {
          logger.info('Lead created', { leadId: leadRecord.id })
        }
      }

    } catch (error) {
      logger.error('Failed to generate call summary', { error })
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
