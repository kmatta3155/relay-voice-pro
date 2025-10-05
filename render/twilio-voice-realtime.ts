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
      const response = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${this.tenantId}&select=voice_settings`, {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch tenant config: ${response.statusText}`)
      }

      const data = await response.json()
      return data[0]?.voice_settings || {}
    } catch (error) {
      logger.error('Error fetching agent config', { error })
      return {}
    }
  }

  private configureSession(config: any) {
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        voice: config?.voice || 'alloy',
        instructions: config?.instructions || 'You are a helpful voice assistant.',
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
    logger.info('OpenAI session configured', { voice: sessionConfig.session.voice })
  }

  private handleTwilioMessage(data: string) {
    try {
      const message = JSON.parse(data)

      switch (message.event) {
        case 'start':
          this.streamSid = message.start.streamSid
          this.callSid = message.start.callSid
          const customParams = message.start.customParameters || {}
          
          // Support both naming conventions (router sends tenantId, but allow tenant_id too)
          const customTenantId = customParams.tenant_id || customParams.tenantId || customParams.TENANT_ID || ''
          if (customTenantId) {
            this.tenantId = customTenantId.trim()
          }
          
          logger.info('Twilio stream started', {
            streamSid: this.streamSid,
            callSid: this.callSid,
            tenantId: this.tenantId
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

      switch (message.type) {
        case 'session.created':
        case 'session.updated':
          logger.info(`OpenAI ${message.type}`)
          break

        case 'response.audio.delta':
          if (this.twilioWs?.readyState === WebSocket.OPEN && message.delta) {
            const pcm24k = Int16Array.from(atob(message.delta), c => c.charCodeAt(0))
            const pcm8k = resample24kTo8k(pcm24k)
            const mulaw = new Uint8Array(pcm8k.length)
            for (let i = 0; i < pcm8k.length; i++) {
              mulaw[i] = pcmToMulaw(pcm8k[i])
            }
            
            const base64Mulaw = btoa(String.fromCharCode(...mulaw))
            this.twilioWs.send(JSON.stringify({
              event: 'media',
              streamSid: this.streamSid,
              media: {
                payload: base64Mulaw
              },
              sequenceNumber: this.outboundSeq++
            }))
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
    const tenantId = url.searchParams.get('tenant_id') || ''
    
    logger.info('WebSocket upgrade request', { 
      tenantId,
      note: 'tenant_id can also come from Twilio customParameters'
    })

    const { socket, response } = Deno.upgradeWebSocket(req)
    new TwilioOpenAIBridge(socket, tenantId)
    
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
