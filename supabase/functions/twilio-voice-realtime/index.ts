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
  private bookingMode: 'native' | 'external' = 'native'
  private externalBookingUrl: string = ''
  
  // Session state
  private isReady = false
  private hasGreeted = false
  private isClosed = false
  
  // Audio buffering
  private audioBuffer: Uint8Array[] = []
  
  // Sequence tracking
  private outboundSeq = 0
  
  constructor(twilioWs: WebSocket, tenantId: string) {
    this.twilioWs = twilioWs
    this.tenantId = tenantId
    
    logger.info('RealtimeAudioBridge initialized', { tenantId })
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
      
      // Load booking mode — controls whether the AI books directly or hands off
      try {
        const { data: bs } = await supabase
          .from('booking_settings')
          .select('mode,external_url,provider')
          .eq('tenant_id', this.tenantId)
          .maybeSingle()
        if (bs?.mode === 'external') {
          this.bookingMode = 'external'
          this.externalBookingUrl = bs.external_url || ''
          this.agentInstructions += `\n\nBOOKING MODE: EXTERNAL (handoff). Do NOT book, check availability, or promise specific times yourself — the salon books through its own system. When a caller wants to book:\n1. Help them choose a service and (if they have a preference) a stylist, using your knowledge of the team.\n2. Ask for their mobile number and call the send_booking_link tool to text them the booking link so they can pick their exact time.\n3. If they can't receive a text, read the booking link aloud: ${this.externalBookingUrl || 'the salon booking page'}.\nBooking link: ${this.externalBookingUrl || '(not set)'}.`
        }
      } catch { /* table may not exist yet — default to native */ }

      logger.info('Agent config loaded', {
        hasInstructions: !!this.agentInstructions,
        voice: this.voiceId,
        hasGreeting: !!this.greeting,
        bookingMode: this.bookingMode
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
      'realtime',  // Required subprotocol for OpenAI Realtime API
      `openai-insecure-api-key.${openaiApiKey}`  // Auth via subprotocol
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
        const voiceFromParams = customParameters.voiceId || customParameters.voice_id
        const greetingFromParams = customParameters.greeting
        
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
          callSid: this.callSid
        })
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
          await this.configureSession()
          break
          
        case 'session.updated':
          this.isReady = true
          logger.info('OpenAI session ready')
          
          // Send greeting if configured
          if (this.greeting && !this.hasGreeted) {
            this.hasGreeted = true
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
          logger.info('User speech stopped, triggering response generation')
          
          // Commit the audio buffer
          this.openaiWs?.send(JSON.stringify({
            type: 'input_audio_buffer.commit'
          }))
          
          // Trigger response generation
          this.openaiWs?.send(JSON.stringify({
            type: 'response.create'
          }))
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
    
    // Define RAG + booking tools
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
    }, {
      type: 'function',
      name: 'check_availability',
      description: 'Check REAL appointment availability for staff members. Use whenever the caller asks when a stylist is available, who is free, or wants to book a time. Never guess availability — always call this tool.',
      parameters: {
        type: 'object',
        properties: {
          staff_name: { type: 'string', description: 'Staff member name if the caller asked for a specific person; omit to check everyone' },
          date: { type: 'string', description: 'Requested date in YYYY-MM-DD; omit to search the next 7 days' },
          service_name: { type: 'string', description: 'The service requested, used to determine appointment length' }
        }
      }
    }, {
      type: 'function',
      name: 'book_appointment',
      description: 'Book an appointment. Only call AFTER confirming the service, time, staff member, and customer name with the caller. The booking is only complete when this tool returns success.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Caller full name' },
          customer_phone: { type: 'string', description: 'Caller phone number if provided' },
          service_name: { type: 'string', description: 'Service being booked' },
          staff_name: { type: 'string', description: 'Staff member, if the caller chose one' },
          start_time: { type: 'string', description: 'Appointment start as ISO 8601 local time, e.g. 2026-06-13T14:00:00' }
        },
        required: ['customer_name', 'service_name', 'start_time']
      }
    }, {
      type: 'function',
      name: 'cancel_appointment',
      description: 'Cancel an existing upcoming appointment. Ask for the name the appointment is under (and phone number if the name alone is ambiguous). Only confirm cancellation after this tool returns success. For rescheduling: cancel first, then book the new time.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Name the appointment is booked under' },
          customer_phone: { type: 'string', description: 'Phone number on the booking, if provided' }
        }
      }
    }, {
      type: 'function',
      name: 'send_booking_link',
      description: 'Text the salon\'s online booking link to the caller so they can pick their time. Use this when booking is handled by the salon\'s existing system (handoff): after helping them choose a service and stylist, collect their mobile number and call this tool.',
      parameters: {
        type: 'object',
        properties: {
          customer_phone: { type: 'string', description: 'Caller mobile number to text the booking link to' },
          customer_name: { type: 'string', description: 'Caller name, if provided' }
        },
        required: ['customer_phone']
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
  
  private sendToolOutput(call_id: string, payload: unknown) {
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id,
        output: JSON.stringify(payload)
      }
    }))
    this.openaiWs?.send(JSON.stringify({ type: 'response.create' }))
  }

  private async handleToolCall(event: any) {
    const { name, call_id, arguments: argsJson } = event

    logger.info('Tool call received', { name, call_id })

    try {
      if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured')
      const supabase = createClient(supabaseUrl, supabaseKey)
      const args = JSON.parse(argsJson || '{}')

      if (name === 'search_knowledge') {
        // NOTE: the DB function is search_knowledge_keywords(p_tenant, p_query, p_match_count).
        // 'search_knowledge' with (tenant_id, query_text, ...) does not exist — calling it
        // made every in-call knowledge lookup fail silently.
        const { data, error } = await supabase.rpc('search_knowledge_keywords', {
          p_tenant: this.tenantId,
          p_query: args.query,
          p_match_count: 3
        })
        if (error) throw error
        logger.info('Knowledge search results', { resultCount: data?.length || 0 })
        this.sendToolOutput(call_id, data || [])
        return
      }

      if (name === 'check_availability') {
        if (this.bookingMode === 'external') {
          this.sendToolOutput(call_id, { external: true, message: 'Availability is in the salon\'s own booking system. Do not quote times — instead collect the caller\'s mobile number and use send_booking_link so they can pick a time.' })
          return
        }
        const slots = await computeAvailability(supabase, this.tenantId!, args.staff_name, args.date, args.service_name)
        logger.info('Availability computed', { slots: slots.length, staff: args.staff_name })
        this.sendToolOutput(call_id, slots.length > 0
          ? { available_slots: slots }
          : { available_slots: [], note: 'No open slots found in the requested window. Offer to take a message or suggest calling back.' })
        return
      }

      if (name === 'book_appointment') {
        if (this.bookingMode === 'external') {
          this.sendToolOutput(call_id, {
            success: false,
            external: true,
            message: `This business books through its own system. Direct the caller to ${this.externalBookingUrl || 'their online booking page'} and offer to text the link.`,
          })
          return
        }
        const result = await bookAppointment(supabase, this.tenantId!, args)
        logger.info('Booking attempt', { success: result.success, staff: args.staff_name, start: args.start_time })
        this.sendToolOutput(call_id, result)
        return
      }

      if (name === 'cancel_appointment') {
        const result = await cancelAppointment(supabase, this.tenantId!, args)
        logger.info('Cancellation attempt', { success: result.success, name: args.customer_name })
        this.sendToolOutput(call_id, result)
        return
      }

      if (name === 'send_booking_link') {
        const url = this.externalBookingUrl
        if (!url) {
          this.sendToolOutput(call_id, { success: false, message: 'No booking link is configured. Offer to take a message or read the phone number instead.' })
          return
        }
        if (!args.customer_phone) {
          this.sendToolOutput(call_id, { success: false, message: 'Ask the caller for their mobile number first.' })
          return
        }
        const sent = await sendBookingSms(supabase, this.tenantId!, args.customer_phone,
          `Book your appointment here: ${url}`)
        logger.info('Booking link SMS', { sent, to: args.customer_phone })
        this.sendToolOutput(call_id, sent
          ? { success: true, message: `Booking link texted. Tell the caller it's on its way and they can tap it to pick their time.` }
          : { success: false, message: `Could not send the text. Read the booking link aloud instead: ${url}` })
        return
      }

      this.sendToolOutput(call_id, { error: `Unknown tool: ${name}` })
    } catch (error) {
      logger.error('Error handling tool call', {
        tool: name,
        error: error instanceof Error ? error.message : String(error)
      })
      this.sendToolOutput(call_id, { error: 'Tool call failed — apologize and offer to take a message instead.' })
    }
  }
  
  private cleanup() {
    if (this.isClosed) return
    this.isClosed = true
    
    logger.info('Cleaning up bridge', {
      streamSid: this.streamSid,
      callSid: this.callSid
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

// ========== STAFF AVAILABILITY & BOOKING ==========
// Availability = staff weekly schedule windows (staff_schedules) minus
// existing appointments. Slots are offered on 30-minute boundaries; duration
// comes from the matched service's duration_minutes (default 60).
// NOTE: times are treated as the business's local wall-clock time.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function slotLabel(d: Date): string {
  const h = d.getUTCHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()} at ${h12}:${mm} ${ap}`
}

async function resolveDuration(supabase: any, tenantId: string, serviceName?: string): Promise<number> {
  if (!serviceName) return 60
  const { data } = await supabase.from('services')
    .select('duration_minutes').eq('tenant_id', tenantId)
    .ilike('name', `%${serviceName}%`).limit(1)
  return data?.[0]?.duration_minutes || 60
}

async function computeAvailability(
  supabase: any, tenantId: string,
  staffName?: string, dateStr?: string, serviceName?: string
): Promise<{ staff: string; start_time: string; spoken: string }[]> {
  // 1. Staff roster (optionally filtered by name)
  let staffQuery = supabase.from('staff').select('id,name').eq('tenant_id', tenantId).eq('active', true)
  if (staffName) staffQuery = staffQuery.ilike('name', `%${staffName}%`)
  let { data: staffRows } = await staffQuery
  if (!staffRows?.length) return []

  // Service assignments: when the requested service has assignments, only
  // stylists who perform it are offered. No assignments → everyone bookable.
  if (serviceName) {
    try {
      const { data: svc } = await supabase.from('services').select('id')
        .eq('tenant_id', tenantId).ilike('name', `%${serviceName}%`).limit(1)
      const serviceId = svc?.[0]?.id
      if (serviceId) {
        const { data: assigned } = await supabase.from('staff_services')
          .select('staff_id').eq('tenant_id', tenantId).eq('service_id', serviceId)
        if (assigned?.length) {
          const allowed = new Set(assigned.map((a: any) => a.staff_id))
          const filtered = staffRows.filter((s: any) => allowed.has(s.id))
          if (filtered.length) staffRows = filtered
        }
      }
    } catch { /* staff_services may not exist yet */ }
  }

  // Time off: exclude staff who are away on a given day
  let timeOff: any[] = []
  try {
    const { data: toRows } = await supabase.from('staff_time_off')
      .select('staff_id,start_date,end_date').eq('tenant_id', tenantId)
    timeOff = toRows || []
  } catch { /* table may not exist yet */ }
  const isAway = (staffId: string, day: Date) => {
    const ymd = day.toISOString().slice(0, 10)
    return timeOff.some((o: any) => o.staff_id === staffId && o.start_date <= ymd && o.end_date >= ymd)
  }

  const staffIds = staffRows.map((s: any) => s.id)
  let { data: schedules } = await supabase.from('staff_schedules')
    .select('staff_id,dow,start_time,end_time').in('staff_id', staffIds)

  // Most salons publish staff names but not schedules (those live inside their
  // booking platform). Fall back to business hours as every stylist's window —
  // conflicts with existing appointments are still respected.
  if (!schedules?.length) {
    const { data: bizHours } = await supabase.from('business_hours')
      .select('dow,open_time,close_time,is_closed').eq('tenant_id', tenantId)
    if (!bizHours?.length) return []
    schedules = []
    for (const s of staffRows) {
      for (const h of bizHours) {
        if (h.is_closed || !h.open_time || !h.close_time) continue
        schedules.push({ staff_id: s.id, dow: h.dow, start_time: h.open_time, end_time: h.close_time })
      }
    }
  }
  if (!schedules.length) return []

  // 2. Search window: requested day, or the next 7 days
  const now = new Date()
  const windowStart = dateStr ? new Date(`${dateStr}T00:00:00Z`) : now
  const days = dateStr ? 1 : 7
  const windowEnd = new Date(windowStart.getTime() + days * 86400000)

  // 3. Existing appointments in the window (staff is stored by name)
  const { data: appts } = await supabase.from('appointments')
    .select('staff,start_at,end_at').eq('tenant_id', tenantId)
    .gte('start_at', windowStart.toISOString()).lt('start_at', windowEnd.toISOString())

  const durationMin = await resolveDuration(supabase, tenantId, serviceName)
  const slots: { staff: string; start_time: string; spoken: string }[] = []

  for (let d = 0; d < days && slots.length < 5; d++) {
    const day = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate() + d))
    const dow = day.getUTCDay()

    for (const sched of schedules) {
      if (slots.length >= 5) break
      if (sched.dow !== dow) continue
      const person = staffRows.find((s: any) => s.id === sched.staff_id)
      if (!person) continue
      if (isAway(person.id, day)) continue

      const [sh, sm] = String(sched.start_time).split(':').map(Number)
      const [eh, em] = String(sched.end_time).split(':').map(Number)
      const shiftStart = new Date(day); shiftStart.setUTCHours(sh, sm, 0, 0)
      const shiftEnd = new Date(day); shiftEnd.setUTCHours(eh, em, 0, 0)

      for (let t = shiftStart.getTime(); t + durationMin * 60000 <= shiftEnd.getTime(); t += 30 * 60000) {
        if (slots.length >= 5) break
        const slotStart = new Date(t)
        const slotEnd = new Date(t + durationMin * 60000)
        // Skip past times (when checking today)
        if (slotStart.getTime() < now.getTime()) continue
        // Conflict: overlapping appointment for the same person
        const conflict = (appts || []).some((a: any) =>
          a.staff && a.staff.toLowerCase().includes(person.name.toLowerCase().split(' ')[0].toLowerCase()) &&
          new Date(a.start_at).getTime() < slotEnd.getTime() &&
          new Date(a.end_at).getTime() > slotStart.getTime()
        )
        if (conflict) continue
        slots.push({
          staff: person.name,
          start_time: slotStart.toISOString().replace('.000Z', ''),
          spoken: `${person.name}: ${slotLabel(slotStart)}`,
        })
      }
    }
  }

  return slots
}

async function bookAppointment(
  supabase: any, tenantId: string,
  args: { customer_name: string; customer_phone?: string; service_name: string; staff_name?: string; start_time: string }
): Promise<{ success: boolean; message: string; alternatives?: unknown }> {
  const { customer_name, customer_phone, service_name, staff_name, start_time } = args
  if (!customer_name || !service_name || !start_time) {
    return { success: false, message: 'Missing customer name, service, or start time.' }
  }

  const start = new Date(start_time.endsWith('Z') ? start_time : `${start_time}Z`)
  if (isNaN(start.getTime())) return { success: false, message: 'Could not understand the requested time.' }

  const durationMin = await resolveDuration(supabase, tenantId, service_name)
  const end = new Date(start.getTime() + durationMin * 60000)

  // Conflict check for the chosen staff member
  if (staff_name) {
    const { data: appts } = await supabase.from('appointments')
      .select('staff,start_at,end_at').eq('tenant_id', tenantId)
      .gte('start_at', new Date(start.getTime() - 86400000).toISOString())
      .lt('start_at', end.toISOString())
    const conflict = (appts || []).some((a: any) =>
      a.staff && a.staff.toLowerCase().includes(staff_name.toLowerCase().split(' ')[0].toLowerCase()) &&
      new Date(a.start_at).getTime() < end.getTime() &&
      new Date(a.end_at).getTime() > start.getTime()
    )
    if (conflict) {
      const alternatives = await computeAvailability(supabase, tenantId, staff_name, undefined, service_name)
      return { success: false, message: `${staff_name} already has an appointment at that time.`, alternatives: alternatives.slice(0, 3) }
    }
  }

  const customer = customer_phone ? `${customer_name} (${customer_phone})` : customer_name
  const { error } = await supabase.from('appointments').insert({
    tenant_id: tenantId,
    title: service_name,
    customer,
    phone: customer_phone || null,
    staff: staff_name || null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: 'booked',
    source: 'voice-ai',
  })
  if (error) return { success: false, message: `Could not save the appointment: ${error.message}` }

  // Best-effort lead capture so the booking shows up in the CRM
  try {
    await supabase.from('leads').insert({
      tenant_id: tenantId,
      name: customer_name,
      phone: customer_phone || '',
      source: 'VoiceAI-Booking',
      status: 'Booked',
      notes: `Booked ${service_name}${staff_name ? ` with ${staff_name}` : ''} for ${slotLabel(start)}`,
    })
  } catch { /* non-fatal */ }

  // SMS confirmation (industry standard) — best effort, never blocks the booking
  let smsSent = false
  if (customer_phone) {
    smsSent = await sendBookingSms(supabase, tenantId,
      customer_phone,
      `Your ${service_name} appointment${staff_name ? ` with ${staff_name}` : ''} is confirmed for ${slotLabel(start)}. Reply or call us to reschedule.`)
  }

  return {
    success: true,
    message: `Booked ${service_name}${staff_name ? ` with ${staff_name}` : ''} on ${slotLabel(start)} for ${customer_name}.${smsSent ? ' A text confirmation was sent.' : ''} Confirm this to the caller.`,
  }
}

// Send an SMS via Twilio from the tenant's own number. Best-effort.
async function sendBookingSms(supabase: any, tenantId: string, to: string, body: string): Promise<boolean> {
  try {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const token = Deno.env.get('TWILIO_AUTH_TOKEN')
    if (!sid || !token) return false
    const { data: settings } = await supabase.from('agent_settings')
      .select('twilio_number').eq('tenant_id', tenantId).maybeSingle()
    const from = settings?.twilio_number
    if (!from) return false

    const digits = to.replace(/[^\d+]/g, '')
    const e164 = digits.startsWith('+') ? digits : (digits.length === 10 ? `+1${digits}` : `+${digits}`)
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: e164, Body: body }),
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) {
      logger.warn('Booking SMS failed', { status: resp.status })
      return false
    }
    return true
  } catch (e) {
    logger.warn('Booking SMS error', { error: (e as Error).message })
    return false
  }
}

// Cancel the caller's upcoming appointment, located by name (and phone if given)
async function cancelAppointment(
  supabase: any, tenantId: string,
  args: { customer_name?: string; customer_phone?: string }
): Promise<{ success: boolean; message: string; matches?: unknown }> {
  const name = (args.customer_name || '').trim()
  const phone = (args.customer_phone || '').replace(/[^\d]/g, '')
  if (!name && !phone) return { success: false, message: 'Need the customer name or phone number to find the appointment.' }

  const { data: appts } = await supabase.from('appointments')
    .select('id,title,customer,staff,start_at,phone')
    .eq('tenant_id', tenantId)
    .gte('start_at', new Date().toISOString())
    .order('start_at')
    .limit(50)

  const matches = (appts || []).filter((a: any) => {
    const nameHit = name && a.customer && a.customer.toLowerCase().includes(name.toLowerCase())
    const phoneHit = phone && ((a.phone || '').replace(/[^\d]/g, '').includes(phone) || (a.customer || '').replace(/[^\d]/g, '').includes(phone))
    return nameHit || phoneHit
  })

  if (matches.length === 0) {
    return { success: false, message: 'No upcoming appointment found under that name or number. Double-check the spelling or offer to take a message.' }
  }
  if (matches.length > 1) {
    return {
      success: false,
      message: 'Multiple upcoming appointments match — ask the caller which one to cancel.',
      matches: matches.slice(0, 4).map((m: any) => ({ service: m.title, staff: m.staff, when: slotLabel(new Date(m.start_at)) })),
    }
  }

  const appt = matches[0]
  const { error } = await supabase.from('appointments').delete().eq('tenant_id', tenantId).eq('id', appt.id)
  if (error) return { success: false, message: `Could not cancel: ${error.message}` }

  if (appt.phone) {
    await sendBookingSms(supabase, tenantId, appt.phone,
      `Your ${appt.title} appointment on ${slotLabel(new Date(appt.start_at))} has been cancelled. Call us anytime to rebook.`)
  }

  return { success: true, message: `Cancelled ${appt.title}${appt.staff ? ` with ${appt.staff}` : ''} on ${slotLabel(new Date(appt.start_at))}. Confirm this to the caller and offer to rebook.` }
}

// ========== MAIN HTTP HANDLER ==========

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  // Handle WebSocket upgrade
  if (req.headers.get('upgrade') === 'websocket') {
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    
    if (!tenantId) {
      return new Response('Missing tenant_id parameter', { 
        status: 400,
        headers: corsHeaders 
      })
    }
    
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req)
    
    twilioWs.onopen = async () => {
      logger.info('Twilio WebSocket connected', { tenantId })
      
      try {
        const bridge = new RealtimeAudioBridge(twilioWs, tenantId)
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
