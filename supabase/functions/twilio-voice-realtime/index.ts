/*
 * OpenAI Realtime API Bridge for Twilio Voice Calls
 * 
 * Architecture: Twilio Media Streams (μ-law 8kHz) ↔ OpenAI Realtime API (PCM16 24kHz)
 * 
 * Key Features:
 * - Bidirectional audio streaming with codec conversion
 * - OpenAI server_vad (no custom VAD needed)
 * - RAG tool integration for knowledge base search
 * - Tenant-specific agent configuration
 * - Proper error handling and logging
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] twilio-voice-realtime: ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] twilio-voice-realtime: ${message}`, data ? JSON.stringify(data) : ''),
  error: (message: string, data?: any) => console.error(`[ERROR] twilio-voice-realtime: ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message: string, data?: any) => console.log(`[DEBUG] twilio-voice-realtime: ${message}`, data ? JSON.stringify(data) : '')
}

const corsHeaders = { 
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Environment setup
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || ''

// Audio constants
const TWILIO_SAMPLE_RATE = 8000
const OPENAI_SAMPLE_RATE = 24000
const FRAME_SIZE_MULAW = 160  // 160 bytes μ-law per 20ms frame at 8kHz
const FRAME_SIZE_PCM16_8K = 320  // 320 bytes PCM16 per 20ms frame at 8kHz (160 samples * 2 bytes)

// ========== AUDIO CODEC CONVERSION HELPERS ==========

/**
 * Convert μ-law to PCM16
 * @param mulaw μ-law encoded byte (0-255)
 * @returns PCM16 sample (-32768 to 32767)
 */
function mulawToPcm(mulaw: number): number {
  mulaw = (~mulaw) & 0xff
  const sign = mulaw & 0x80
  const exponent = (mulaw >> 4) & 0x07
  const mantissa = mulaw & 0x0f
  const sample = ((mantissa | 0x10) << (exponent + 3)) - 0x84
  return sign ? -sample : sample
}

/**
 * Convert PCM16 to μ-law
 * @param sample PCM16 sample (-32768 to 32767)
 * @returns μ-law encoded byte (0-255)
 */
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
  
  while ((sample & mantissa) === 0 && exponent > 0) {
    exponent--
    mantissa >>= 1
  }
  
  const shift = (exponent === 0) ? 4 : (exponent + 3)
  const temp = (sample >> shift) & 0x0f
  
  return (~(sign | (exponent << 4) | temp)) & 0xff
}

/**
 * Upsample PCM16 from 8kHz to 24kHz (3x)
 * Uses linear interpolation for quality
 */
function upsample8to24(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3)
  for (let i = 0; i < pcm8k.length; i++) {
    pcm24k[i * 3] = pcm8k[i]
    pcm24k[i * 3 + 1] = i < pcm8k.length - 1 
      ? Math.round((pcm8k[i] * 2 + pcm8k[i + 1]) / 3)
      : pcm8k[i]
    pcm24k[i * 3 + 2] = i < pcm8k.length - 1
      ? Math.round((pcm8k[i] + pcm8k[i + 1] * 2) / 3)
      : pcm8k[i]
  }
  return pcm24k
}

/**
 * Downsample PCM16 from 24kHz to 8kHz (1/3)
 * Uses averaging for anti-aliasing
 */
function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3))
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3
    if (idx + 2 < pcm24k.length) {
      pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3)
    }
  }
  return pcm8k
}

/**
 * Safe base64 encoding for large arrays
 */
function safeBase64Encode(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length))
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j])
    }
  }
  return btoa(binary)
}

/**
 * Safe base64 decoding
 */
function safeBase64Decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ========== REALTIME AUDIO BRIDGE ==========

class RealtimeAudioBridge {
  private twilioWs: WebSocket
  private openaiWs: WebSocket | null = null
  private tenantId: string
  private streamSid: string = ''
  private callSid: string = ''
  
  // Agent configuration
  private agentInstructions: string = ''
  private voiceId: string = 'alloy'
  private greeting: string = ''
  
  // Session state
  private isReady = false
  private hasGreeted = false
  private isClosed = false
  private connectionStartTime: number = Date.now()
  
  // Audio buffering
  private audioBuffer: Uint8Array[] = []
  
  // Sequence tracking
  private outboundSeq = 0
  
  // Timeout monitoring (Supabase Edge Functions have 400s wall-clock limit)
  private timeoutWarningTimer?: ReturnType<typeof setTimeout>
  private readonly MAX_CALL_DURATION_MS = 360000 // 6 minutes (safe margin before 400s limit)
  
  constructor(twilioWs: WebSocket, tenantId: string) {
    this.twilioWs = twilioWs
    this.tenantId = tenantId
    
    logger.info('RealtimeAudioBridge initialized', { tenantId })
    
    // Set timeout warning at 6 minutes (before 400s Edge Function limit)
    this.timeoutWarningTimer = setTimeout(() => {
      this.handleTimeoutWarning()
    }, this.MAX_CALL_DURATION_MS)
  }
  
  async initialize() {
    try {
      // Fetch agent configuration from Supabase
      await this.fetchAgentConfig()
      
      // Connect to OpenAI Realtime API
      await this.connectToOpenAI()
      
      // Setup Twilio message handlers
      this.setupTwilioHandlers()
      
      logger.info('Bridge initialization complete')
    } catch (error) {
      logger.error('Bridge initialization failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.cleanup()
    }
  }
  
  private async fetchAgentConfig() {
    try {
      if (!supabaseUrl || !supabaseKey) {
        logger.warn('Supabase not configured, using default instructions')
        this.agentInstructions = 'You are a helpful AI assistant for phone calls.'
        return
      }
      
      // If tenantId is empty, it will come from customParameters later
      if (!this.tenantId) {
        logger.info('No tenant_id yet, will be set from Twilio customParameters')
        this.agentInstructions = 'You are a helpful AI assistant for phone calls.'
        return
      }
      
      const supabase = createClient(supabaseUrl, supabaseKey)
      
      const { data: agent, error } = await supabase
        .from('ai_agents')
        .select('name, system_prompt, overrides')
        .eq('tenant_id', this.tenantId)
        .maybeSingle()
      
      if (error) {
        logger.error('Failed to fetch agent config', { error })
        this.agentInstructions = 'You are a helpful AI assistant for phone calls.'
        return
      }
      
      if (agent?.system_prompt) {
        this.agentInstructions = agent.system_prompt
        
        // Extract voice and greeting from overrides if available
        const overrides = agent.overrides as any
        if (overrides?.voice) {
          this.voiceId = overrides.voice
        }
        if (overrides?.greeting) {
          this.greeting = overrides.greeting
        }
      } else {
        this.agentInstructions = 'You are a helpful AI assistant for phone calls.'
      }
      
      logger.info('Agent config loaded', {
        hasInstructions: !!this.agentInstructions,
        voice: this.voiceId,
        hasGreeting: !!this.greeting
      })
    } catch (error) {
      logger.error('Error fetching agent config', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.agentInstructions = 'You are a helpful AI assistant for phone calls.'
    }
  }
  
  private async connectToOpenAI() {
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }
    
    // Correct Deno/browser WebSocket connection with subprotocols
    const openaiUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'
    
    logger.info('Connecting to OpenAI Realtime API')
    
    // Use subprotocols for auth - this is the correct approach for Deno
    this.openaiWs = new WebSocket(openaiUrl, [
      'realtime',  // Base protocol identifier
      `openai-insecure-api-key.${openaiApiKey}`,  // API authentication
      'openai-beta.realtime-v1'  // Required beta protocol version
    ])
    
    this.openaiWs.onopen = () => {
      logger.info('OpenAI WebSocket connected successfully')
    }
    
    this.openaiWs.onmessage = (event) => {
      this.handleOpenAIMessage(event.data)
    }
    
    this.openaiWs.onerror = (error) => {
      logger.error('OpenAI WebSocket error', { 
        error: error.toString(),
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
    
    this.openaiWs.onclose = (event) => {
      logger.info('OpenAI WebSocket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
      
      // Clean up Twilio connection when OpenAI connection closes
      if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
        this.twilioWs.close()
      }
      
      this.cleanup()
    }
  }
  
  private setupTwilioHandlers() {
    this.twilioWs.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        await this.handleTwilioMessage(message)
      } catch (error) {
        logger.error('Error handling Twilio message', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    this.twilioWs.onclose = (event) => {
      logger.info('Twilio WebSocket closed', {
        code: event.code,
        reason: event.reason
      })
      this.cleanup()
    }
    
    this.twilioWs.onerror = (error) => {
      logger.error('Twilio WebSocket error', { error })
    }
  }
  
  private async handleTwilioMessage(message: any) {
    const { event } = message
    
    switch (event) {
      case 'start':
        this.streamSid = message.start.streamSid
        this.callSid = message.start.callSid
        
        // Extract parameters from Twilio customParameters
        const customParameters = message.start.customParameters || {}
        const tenantIdFromParams = customParameters.tenantId || customParameters.tenant_id
        const voiceFromParams = customParameters.voiceId || customParameters.voice_id
        const greetingFromParams = customParameters.greeting
        
        logger.info('Received customParameters', { customParameters })
        
        // Apply tenant_id from customParameters if we don't have it yet
        if (tenantIdFromParams && !this.tenantId) {
          this.tenantId = tenantIdFromParams
          logger.info('Tenant ID set from customParameters', { tenantId: this.tenantId })
          
          // Now that we have tenant_id, fetch agent config from database
          await this.fetchAgentConfig()
        }
        
        // Apply customParameters with precedence over DB values
        if (voiceFromParams) {
          this.voiceId = voiceFromParams  // Override unconditionally
          logger.info('Voice overridden from customParameters', { voice: this.voiceId })
        }
        
        if (greetingFromParams) {
          this.greeting = greetingFromParams  // Override unconditionally
          logger.info('Greeting overridden from customParameters', { greeting: this.greeting })
        }
        
        logger.info('Twilio stream started', {
          streamSid: this.streamSid,
          callSid: this.callSid,
          tenantId: this.tenantId,
          hasGreeting: !!this.greeting
        })
        
        // Reconfigure OpenAI session with tenant-specific settings
        logger.info('Reconfiguring OpenAI session with tenant settings')
        await this.configureSession()
        
        // Send greeting immediately if configured
        if (this.greeting && !this.hasGreeted && this.isReady) {
          this.hasGreeted = true
          logger.info('Sending greeting', { greeting: this.greeting })
          this.openaiWs?.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'input_text',
                text: this.greeting
              }]
            }
          }))
          this.openaiWs?.send(JSON.stringify({ type: 'response.create' }))
        }
        break
        
      case 'media':
        await this.handleIncomingAudio(message.media)
        break
        
      case 'stop':
        logger.info('Twilio stream stopped')
        this.cleanup()
        break
        
      default:
        logger.debug('Unhandled Twilio event', { event })
    }
  }
  
  private async handleIncomingAudio(media: any) {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN || !this.isReady) {
      return
    }
    
    try {
      // Decode base64 μ-law audio from Twilio
      const mulawBytes = safeBase64Decode(media.payload)
      
      // Convert μ-law to PCM16 8kHz
      const pcm8kSamples = new Int16Array(mulawBytes.length)
      for (let i = 0; i < mulawBytes.length; i++) {
        pcm8kSamples[i] = mulawToPcm(mulawBytes[i])
      }
      
      // Upsample to 24kHz
      const pcm24kSamples = upsample8to24(pcm8kSamples)
      
      // Convert to bytes for base64 encoding
      const pcm24kBytes = new Uint8Array(pcm24kSamples.length * 2)
      const view = new DataView(pcm24kBytes.buffer)
      for (let i = 0; i < pcm24kSamples.length; i++) {
        view.setInt16(i * 2, pcm24kSamples[i], true) // little-endian
      }
      
      // Send to OpenAI as base64 PCM16 24kHz
      const base64Audio = safeBase64Encode(pcm24kBytes)
      
      this.openaiWs.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      }))
    } catch (error) {
      logger.error('Error processing incoming audio', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  private async handleOpenAIMessage(data: string) {
    try {
      const event = JSON.parse(data)
      
      switch (event.type) {
        case 'session.created':
          // Mark as ready - we'll configure when we have tenant data
          this.isReady = true
          logger.info('OpenAI session created and ready')
          break
          
        case 'session.updated':
          logger.info('OpenAI session updated')
          break
          
        case 'response.audio.delta':
          await this.handleAudioOutput(event.delta)
          break
          
        case 'response.audio_transcript.delta':
          logger.debug('Transcript delta', { text: event.delta })
          break
          
        case 'response.function_call_arguments.done':
          await this.handleToolCall(event)
          break
          
        case 'input_audio_buffer.speech_started':
          logger.debug('Speech started')
          break
          
        case 'input_audio_buffer.speech_stopped':
          // With server_vad enabled, OpenAI automatically commits buffer and creates response
          // We don't need to do it manually - that causes "already has active response" errors
          logger.debug('Speech stopped - server VAD will handle response')
          break
          
        case 'conversation.item.input_audio_transcription.completed':
          logger.info('User said', { transcript: event.transcript })
          break
          
        case 'error':
          logger.error('OpenAI error event', { error: event.error })
          break
          
        default:
          logger.debug('OpenAI event', { type: event.type })
      }
    } catch (error) {
      logger.error('Error handling OpenAI message', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  private async configureSession() {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
      return
    }
    
    // Define RAG tool
    const tools = [{
      type: 'function',
      name: 'search_knowledge',
      description: 'Search business knowledge base for information about services, pricing, hours, policies, and other business details.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant business information'
          }
        },
        required: ['query']
      }
    }]
    
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: this.voiceId,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000
        },
        instructions: this.agentInstructions,
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.8,
        max_response_output_tokens: 4096
      }
    }
    
    logger.info('Configuring OpenAI session', {
      voice: this.voiceId,
      hasInstructions: !!this.agentInstructions,
      toolCount: tools.length
    })
    
    this.openaiWs.send(JSON.stringify(sessionConfig))
  }
  
  private async handleAudioOutput(base64Audio: string) {
    if (!this.twilioWs || this.twilioWs.readyState !== WebSocket.OPEN || !this.streamSid) {
      return
    }
    
    try {
      // Decode base64 PCM16 24kHz from OpenAI
      const pcm24kBytes = safeBase64Decode(base64Audio)
      
      // Convert to Int16Array
      const pcm24kSamples = new Int16Array(pcm24kBytes.length / 2)
      const view = new DataView(pcm24kBytes.buffer)
      for (let i = 0; i < pcm24kSamples.length; i++) {
        pcm24kSamples[i] = view.getInt16(i * 2, true) // little-endian
      }
      
      // Downsample to 8kHz
      const pcm8kSamples = downsample24to8(pcm24kSamples)
      
      // Convert to μ-law
      const mulawBytes = new Uint8Array(pcm8kSamples.length)
      for (let i = 0; i < pcm8kSamples.length; i++) {
        mulawBytes[i] = pcmToMulaw(pcm8kSamples[i])
      }
      
      // Send to Twilio in chunks
      const chunkSize = FRAME_SIZE_MULAW
      for (let i = 0; i < mulawBytes.length; i += chunkSize) {
        const chunk = mulawBytes.slice(i, Math.min(i + chunkSize, mulawBytes.length))
        const base64Chunk = safeBase64Encode(chunk)
        
        const mediaMessage = {
          event: 'media',
          streamSid: this.streamSid,
          media: {
            payload: base64Chunk
          }
        }
        
        this.twilioWs.send(JSON.stringify(mediaMessage))
        this.outboundSeq++
      }
    } catch (error) {
      logger.error('Error processing audio output', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  private async handleToolCall(event: any) {
    const { name, call_id, arguments: argsJson } = event
    
    logger.info('Tool call received', { name, call_id })
    
    if (name === 'search_knowledge') {
      try {
        const args = JSON.parse(argsJson)
        const { query } = args
        
        logger.info('Searching knowledge base', { query })
        
        if (!supabaseUrl || !supabaseKey) {
          throw new Error('Supabase not configured')
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey)
        
        const { data, error } = await supabase.rpc('search_knowledge', {
          tenant_id: this.tenantId,
          query_text: query,
          match_threshold: 0.3,
          match_count: 3
        })
        
        if (error) {
          logger.error('Knowledge search failed', { error })
          throw error
        }
        
        logger.info('Knowledge search results', {
          resultCount: data?.length || 0
        })
        
        // Send results back to OpenAI
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify(data || [])
          }
        }))
        
        // Trigger response generation
        this.openaiWs?.send(JSON.stringify({ type: 'response.create' }))
      } catch (error) {
        logger.error('Error handling tool call', {
          error: error instanceof Error ? error.message : String(error)
        })
        
        // Send error response
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify({ error: 'Failed to search knowledge base' })
          }
        }))
        
        this.openaiWs?.send(JSON.stringify({ type: 'response.create' }))
      }
    }
  }
  
  private async handleTimeoutWarning() {
    const durationMinutes = Math.floor((Date.now() - this.connectionStartTime) / 60000)
    logger.warn('Approaching Edge Function timeout limit', {
      durationMinutes,
      callSid: this.callSid,
      note: 'Supabase Edge Functions have 400s (6.67min) wall-clock limit'
    })
    
    // Send polite warning to caller
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'input_text',
            text: 'I apologize, but our call is approaching the maximum duration. Is there anything else I can quickly help you with?'
          }]
        }
      }))
      this.openaiWs.send(JSON.stringify({ type: 'response.create' }))
    }
  }
  
  private cleanup() {
    if (this.isClosed) return
    this.isClosed = true
    
    // Clear timeout timer
    if (this.timeoutWarningTimer) {
      clearTimeout(this.timeoutWarningTimer)
    }
    
    const durationSeconds = Math.floor((Date.now() - this.connectionStartTime) / 1000)
    logger.info('Cleaning up bridge', {
      streamSid: this.streamSid,
      callSid: this.callSid,
      durationSeconds
    })
    
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
}

// ========== MAIN HTTP HANDLER ==========

serve(async (req) => {
  const url = new URL(req.url)
  const upgradeHeader = req.headers.get('upgrade')
  
  logger.info('Incoming request', {
    method: req.method,
    url: url.toString(),
    upgradeHeader,
    searchParams: Object.fromEntries(url.searchParams)
  })
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  // Handle WebSocket upgrade
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    const tenantId = url.searchParams.get('tenant_id')
    
    logger.info('WebSocket upgrade request', { 
      tenantId,
      hasTenantId: !!tenantId,
      note: 'tenant_id can also come from Twilio customParameters'
    })
    
    // Allow connection even without tenant_id - it will come from Twilio customParameters
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req)
    
    twilioWs.onopen = async () => {
      logger.info('Twilio WebSocket connected', { tenantIdFromUrl: tenantId })
      
      try {
        // Pass tenantId from URL if available, otherwise will get from customParameters
        const bridge = new RealtimeAudioBridge(twilioWs, tenantId || '')
        await bridge.initialize()
      } catch (error) {
        logger.error('Failed to initialize bridge', {
          error: error instanceof Error ? error.message : String(error)
        })
        twilioWs.close()
      }
    }
    
    return response
  }
  
  // Handle HTTP health check
  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'twilio-voice-realtime',
      version: '1.0.0',
      features: [
        'OpenAI Realtime API integration',
        'Audio codec conversion (μ-law ↔ PCM16)',
        'Sample rate conversion (8kHz ↔ 24kHz)',
        'Server-side VAD',
        'RAG tool integration'
      ]
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
})
