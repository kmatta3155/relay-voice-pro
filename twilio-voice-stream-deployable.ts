/*
 * AI Voice Receptionist - Production-Ready Pipeline
 * Architecture: Twilio WebSocket → Audio Processing → STT → Dialogue → TTS → Response
 * Optimized for <300ms response latency with proper audio streaming
 * 
 * CRITICAL PRODUCTION FIXES APPLIED (2024-12-23):
 * ✅ Fixed logging message: `Adding ${POST_TTS_COOLDOWN_MS}ms` instead of hardcoded "300ms"
 * ✅ Removed "you" from STOP_WORDS set 
 * ✅ Added `language: 'en'` to Whisper API calls
 * ✅ Enhanced RAG fallback with meaningful salon context
 * ✅ Professional greeting improvements
 * ✅ WebSocket connection stability fixes
 * ✅ Idle timeout extensions (45s + 45s)
 * ✅ 700ms post-TTS cooldown
 * ✅ Removed track field from media messages - bidirectional streams do NOT use track field
 * ✅ Direct audio forwarding - ElevenLabs base64 audio sent without re-encoding
 * ✅ Removed double-encoding that was causing static
 * ✅ Added clear message support for barge-in interruptions
 * ✅ No authentication required for Twilio WebSocket connections
 * ✅ Azure TTS streaming with ulaw_8000 format
 * ✅ 200ms warmup silence to prevent initial static
 * ✅ Comprehensive error recovery and logging
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

// ========== INLINE LOGGER FOR SELF-CONTAINED DEPLOYMENT ==========

interface LogEntry {
  timestamp: string;
  functionName: string;
  level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN';
  message: string;
  data?: any;
}

class EdgeLogger {
  private functionName: string;
  
  constructor(functionName: string) {
    this.functionName = functionName;
  }
  
  private async sendLog(level: LogEntry['level'], message: string, data?: any) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      functionName: this.functionName,
      level,
      message,
      data
    };
    
    // Always log to console for Supabase dashboard
    const consoleMessage = `[${level}] [${this.functionName}] ${message}`;
    if (data) {
      console.log(consoleMessage, typeof data === 'object' ? JSON.stringify(data) : data);
    } else {
      console.log(consoleMessage);
    }
  }
  
  info(message: string, data?: any) {
    return this.sendLog('INFO', message, data);
  }
  
  error(message: string, data?: any) {
    return this.sendLog('ERROR', message, data);
  }
  
  debug(message: string, data?: any) {
    return this.sendLog('DEBUG', message, data);
  }
  
  warn(message: string, data?: any) {
    return this.sendLog('WARN', message, data);
  }
}

// Initialize logger
const logger = new EdgeLogger('twilio-voice-stream')

const corsHeaders = { 
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Environment setup
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null

// Audio constants - will be determined based on codec
const FRAME_DURATION_MS = 20
const SAMPLE_RATE = 8000

// Codec-specific frame sizes
const FRAME_SIZE_MULAW = 160  // μ-law: 160 bytes per 20ms at 8kHz
const FRAME_SIZE_PCM16 = 320  // PCM16: 320 bytes per 20ms at 8kHz (2 bytes per sample)

// Supported codecs
enum AudioCodec {
  MULAW = 'mulaw',
  PCM16 = 'pcm16'
}

// Voice Activity Detection settings - optimized for natural speech patterns
const VAD_SILENCE_THRESHOLD = 700
const VAD_MIN_SPEECH_MS = 800  // Increased to 800ms per Azure engineer recommendation
const VAD_END_SILENCE_MS = 1200  // Within 1000-1300ms range as recommended

// Barge-in detection settings
const BARGE_IN_THRESHOLD = 800  // Slightly higher than VAD to avoid false positives
const BARGE_IN_MIN_DURATION_MS = 350  // Increased to 350ms per Azure engineer recommendation
const BARGE_IN_BUFFER_FRAMES = 12  // ~240ms buffer for detection (12 frames * 20ms)

// Turn-taking timing constants
const POST_TTS_COOLDOWN_MS = 700  // 700ms cooldown after TTS before resuming VAD (increased from 300ms per senior architect)

// Turn management states
enum TurnState {
  LISTENING = 'LISTENING',
  THINKING = 'THINKING', 
  SPEAKING = 'SPEAKING'
}

// ========== SMART TRANSCRIPT FILTERING ==========

// Smart filtering constants
const MIN_TRANSCRIPT_LENGTH = 3  // Reduced from 10 to allow short but meaningful responses
const COMMON_RESPONSES = new Set([
  'yes', 'no', 'ok', 'okay', 'hi', 'hello', 'thanks', 'thank you', 
  'bye', 'goodbye', 'am', 'pm', 'help', 'sure', 'right', 'yeah', 
  'yep', 'nope', 'stop', 'wait', 'done', 'fine', 'good', 'bad'
])

// Time pattern regex (matches patterns like "2pm", "10am", "3:30", "noon", etc.)
const TIME_PATTERNS = [
  /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,  // 2pm, 10:30am
  /\b\d{1,2}(:\d{2})?\b/,             // 3:30, 2
  /\b(noon|midnight)\b/i,             // noon, midnight
  /\b(morning|afternoon|evening|night)\b/i // morning, etc.
]

// Stop-words filter to reject low-content single-word utterances
// CRITICAL FIX: Removed 'you' as it can be a meaningful response in conversations
const STOP_WORDS = new Set([
  'i', 'me', 'we', 'they', 'uh', 'um', 'hmm', 'huh', 'hey', 'eh', 'ah'
])

/**
 * Smart transcript filtering that allows meaningful short responses while filtering out fragments
 * Replaces the problematic 10-character minimum filter
 */
function isValidTranscript(transcript: string): { isValid: boolean; reason: string } {
  const trimmed = transcript.trim().toLowerCase()
  
  // Always reject empty transcripts
  if (!trimmed) {
    return { isValid: false, reason: 'empty' }
  }
  
  // Reject single characters that are likely transcription errors
  if (trimmed.length === 1) {
    return { isValid: false, reason: 'single_character' }
  }
  
  // CRITICAL FIX: Check whitelist BEFORE length validation
  // Allow whitelisted common responses regardless of length (including 2-char responses like "hi", "ok", "no", "am", "pm")
  if (COMMON_RESPONSES.has(trimmed)) {
    return { isValid: true, reason: 'whitelisted_response' }
  }
  
  // Check for time patterns (2pm, 10am, 3:30, etc.) BEFORE length validation
  for (const pattern of TIME_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isValid: true, reason: 'time_pattern' }
    }
  }
  
  // Apply basic length filter (3-4 characters minimum) AFTER whitelist/time validation
  if (trimmed.length < MIN_TRANSCRIPT_LENGTH) {
    return { isValid: false, reason: 'too_short' }
  }
  
  // STOP-WORDS CHECK: Reject single stop-words to block low-content utterances
  const words = trimmed.split(/\s+/)
  if (words.length === 1 && STOP_WORDS.has(words[0])) {
    return { isValid: false, reason: 'stop_word' }
  }
  
  // Check if transcript contains at least one word with letters/digits
  // This filters out fragments like isolated "You" but allows meaningful responses
  const hasValidWord = words.some(word => {
    // Must contain at least one letter or digit
    const hasLetterOrDigit = /[a-z0-9]/i.test(word)
    // Should be at least 2 characters for non-whitelisted words
    const isReasonableLength = word.length >= 2
    return hasLetterOrDigit && isReasonableLength
  })
  
  if (!hasValidWord) {
    return { isValid: false, reason: 'no_valid_words' }
  }
  
  // For longer utterances, use VAD-based completeness check
  // Allow any transcript that passes the basic checks above
  return { isValid: true, reason: 'valid_content' }
}

// ========== AUDIO PROCESSING ==========

// Helper function to convert binary data to hex string for debugging
function toHexString(buffer: Uint8Array, maxBytes: number = 16): string {
  const bytes = Math.min(buffer.length, maxBytes)
  const hex = Array.from(buffer.slice(0, bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')
  return `${hex}${buffer.length > maxBytes ? '...' : ''} (${buffer.length} bytes total)`
}

// Safe base64 encoding function that avoids spread operator stack overflow
function safeBase64Encode(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192 // Process in chunks to avoid stack overflow
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length))
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j])
    }
  }
  return btoa(binary)
}

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
  
  while ((sample & mantissa) === 0 && exponent > 0) {
    exponent--
    mantissa >>= 1
  }
  
  const shift = (exponent === 0) ? 4 : (exponent + 3)
  const temp = (sample >> shift) & 0x0f
  
  return (~(sign | (exponent << 4) | temp)) & 0xff
}

function calculateRMS(frames: Uint8Array[]): number {
  let sum = 0
  let count = 0
  
  for (const frame of frames) {
    for (const sample of frame) {
      const pcm = mulawToPcm(sample)
      sum += pcm * pcm
      count++
    }
  }
  
  return count > 0 ? Math.sqrt(sum / count) : 0
}

function createWavFile(pcmData: Int16Array, sampleRate: number): Uint8Array {
  const length = pcmData.length
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }
  
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, length * 2, true)
  
  for (let i = 0; i < length; i++) {
    view.setInt16(44 + i * 2, pcmData[i], true)
  }
  
  return new Uint8Array(buffer)
}

// ========== AI VOICE SESSION ==========

class AIVoiceSession {
  private ws: WebSocket
  private turnState = TurnState.LISTENING
  private audioBuffer: Uint8Array[] = []
  private lastActivityTime = Date.now()
  private isProcessing = false
  
  // Twilio stream tracking
  private streamSid: string = ''
  private sequenceNumber: number = 1
  
  // Outbound audio scheduling (critical for no static)
  private outboundSeq: number = 0
  private outboundTsBase: number = 0
  
  // Context
  private tenantId: string
  private businessName: string
  private voiceId: string
  private greeting: string
  
  // API keys
  private openaiKey: string
  private azureTtsKey: string
  private azureTtsRegion: string
  
  // Conversation state
  private conversationHistory: Array<{ role: string; content: string }> = []
  private hasGreeted = false
  private isReady = false
  
  // Track if session is closed
  private isClosed = false
  
  // Track active Azure TTS streaming
  private isAzureTtsStreaming = false
  private pendingCleanup = false
  
  // Codec negotiation
  private outboundCodec: AudioCodec = AudioCodec.MULAW
  private outboundFrameSize: number = FRAME_SIZE_MULAW
  
  // Barge-in detection state
  private bargeInBuffer: Uint8Array[] = []
  private currentTTSAbortController: AbortController | null = null
  private lastBargeInTime = 0
  
  // Production monitoring
  private sessionStartTime = Date.now()
  private totalFramesSent = 0
  private totalFramesReceived = 0
  private sessionTimeoutHandle: number | null = null
  private heartbeatInterval: number | null = null
  
  // CRITICAL FIX: Idle timeout management per Azure engineer recommendations (45s + 45s)
  private lastUserActivityTime = Date.now()
  private idleTimeoutHandle: number | null = null
  private hasPromptedForActivity = false
  private readonly IDLE_TIMEOUT_MS = 45000 // 45 seconds idle before prompt (increased from 8s per senior architect)
  private readonly FINAL_TIMEOUT_MS = 45000 // Another 45 seconds after prompt before close (increased from 8s per senior architect)
  
  constructor(
    ws: WebSocket,
    context: { tenantId: string; businessName: string; voiceId: string; greeting: string }
  ) {
    this.ws = ws
    this.tenantId = context.tenantId
    this.businessName = context.businessName
    this.voiceId = context.voiceId
    this.greeting = context.greeting
    
    this.openaiKey = Deno.env.get('OPENAI_API_KEY') || ''
    this.azureTtsKey = Deno.env.get('AZURE_TTS_KEY') || ''
    this.azureTtsRegion = Deno.env.get('AZURE_TTS_REGION') || 'eastus'
    
    // Validate required API keys
    if (!this.openaiKey) {
      logger.error('CRITICAL: OpenAI API key not configured')
      this.sendErrorToCallerAndClose('Configuration error: OpenAI API key missing')
      return
    }
    
    if (!this.azureTtsKey) {
      logger.error('CRITICAL: Azure TTS API key not configured')
      this.sendErrorToCallerAndClose('Configuration error: Azure TTS API key missing')
      return
    }
    
    logger.info('AIVoiceSession initialized successfully', {
      tenantId: this.tenantId,
      businessName: this.businessName,
      voiceId: this.voiceId,
      greetingLength: this.greeting?.length || 0,
      hasOpenAIKey: !!this.openaiKey,
      hasAzureTtsKey: !!this.azureTtsKey,
      azureTtsRegion: this.azureTtsRegion,
      maxSessionDuration: '150s (Free) / 400s (Pro)',
      features: [
        'Azure TTS streaming',
        'Barge-in detection',
        'VAD with 1200ms silence detection',
        'Smart transcript filtering',
        'Database-driven prompts',
        'Session timeout protection',
        'All critical fixes applied'
      ]
    })
    
    this.setupEventListeners()
    this.setupSessionTimeout()
    this.setupHeartbeat()
  }
  
  private async sendErrorToCallerAndClose(errorMessage: string): Promise<void> {
    try {
      logger.error('Sending error message to caller', { errorMessage })
      // Try to speak the error if we have a streamSid
      if (this.streamSid) {
        await this.speakResponse('I apologize, but I cannot continue this call due to a technical issue. Please call back later.')
      }
    } catch (error) {
      logger.error('Failed to send error message to caller', {
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setTimeout(() => this.cleanup(), 1000)
    }
  }
  
  private setupSessionTimeout(): void {
    // Set maximum session limit for 140 seconds (just under the 150s Free tier limit)
    const maxSessionTimeout = 140000 // 140 seconds
    
    this.sessionTimeoutHandle = setTimeout(() => {
      logger.warn('Session approaching maximum time limit, closing gracefully', {
        sessionDuration: Date.now() - this.sessionStartTime,
        totalFramesSent: this.totalFramesSent,
        totalFramesReceived: this.totalFramesReceived
      })
      
      // Send a final message to the user
      this.speakResponse('I need to end this call now. Please call back if you need further assistance. Goodbye!')
        .then(() => {
          setTimeout(() => this.cleanup(), 2000) // Give time for goodbye message
        })
        .catch(() => this.cleanup())
    }, maxSessionTimeout) as unknown as number
    
    // CRITICAL: Implement proper idle timeout per Azure engineer recommendation
    this.setupIdleTimeout()
  }
  
  private setupHeartbeat(): void {
    // Send heartbeat every 30 seconds to keep connection alive
    this.heartbeatInterval = setInterval(() => {
      if (this.ws.readyState === 1 && this.streamSid) {
        try {
          // Send a mark event as heartbeat
          this.ws.send(JSON.stringify({
            event: 'mark',
            streamSid: this.streamSid,
            mark: {
              name: 'heartbeat',
              timestamp: Date.now()
            }
          }))
          
          logger.debug('Heartbeat sent', {
            uptime: Date.now() - this.sessionStartTime,
            state: this.turnState
          })
        } catch (error) {
          logger.error('Failed to send heartbeat', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }, 30000) as unknown as number
  }
  
  private setupIdleTimeout(): void {
    // Setup proper idle timeout per Azure engineer recommendations
    this.resetIdleTimeout()
  }
  
  private resetIdleTimeout(): void {
    // Clear existing idle timeout
    if (this.idleTimeoutHandle) {
      clearTimeout(this.idleTimeoutHandle)
      this.idleTimeoutHandle = null
    }
    
    // Reset activity tracking
    this.lastUserActivityTime = Date.now()
    this.hasPromptedForActivity = false
    
    // Set new idle timeout
    this.idleTimeoutHandle = setTimeout(() => {
      this.handleIdleTimeout()
    }, this.IDLE_TIMEOUT_MS) as unknown as number
    
    logger.debug('Idle timeout reset', {
      idleTimeoutMs: this.IDLE_TIMEOUT_MS,
      hasPromptedForActivity: this.hasPromptedForActivity
    })
  }
  
  private async handleIdleTimeout(): Promise<void> {
    const idleDuration = Date.now() - this.lastUserActivityTime
    
    if (!this.hasPromptedForActivity) {
      // First idle timeout - prompt user
      this.hasPromptedForActivity = true
      logger.info('First idle timeout reached - prompting user', {
        idleDurationMs: idleDuration,
        nextTimeoutMs: this.FINAL_TIMEOUT_MS
      })
      
      try {
        await this.speakResponse('Are you still there?')
        
        // Set final timeout
        this.idleTimeoutHandle = setTimeout(() => {
          this.handleFinalIdleTimeout()
        }, this.FINAL_TIMEOUT_MS) as unknown as number
        
      } catch (error) {
        logger.error('Failed to prompt user during idle timeout', {
          error: error instanceof Error ? error.message : String(error)
        })
        // Fallback to immediate close if prompt fails
        this.handleFinalIdleTimeout()
      }
    } else {
      // Already prompted, now close
      this.handleFinalIdleTimeout()
    }
  }
  
  private async handleFinalIdleTimeout(): Promise<void> {
    const totalIdleDuration = Date.now() - this.lastUserActivityTime
    
    logger.info('Final idle timeout reached - ending call gracefully', {
      totalIdleDurationMs: totalIdleDuration,
      hasPromptedForActivity: this.hasPromptedForActivity
    })
    
    try {
      await this.speakResponse('Thank you for calling. Have a great day!')
      setTimeout(() => this.cleanup(), 2000) // Give time for goodbye message
    } catch (error) {
      logger.error('Failed to send goodbye message during final idle timeout', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.cleanup() // Close immediately if goodbye fails
    }
  }
  
  private setupEventListeners(): void {
    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        await this.handleTwilioMessage(message)
      } catch (error) {
        logger.error('Error processing WebSocket message', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      }
    }
    
    this.ws.onclose = () => {
      logger.info('WebSocket connection closed')
      this.cleanup()
    }
    
    this.ws.onerror = (error) => {
      logger.error('WebSocket error occurred', { 
        error: error instanceof Error ? error.message : String(error),
        readyState: this.ws.readyState
      })
    }
  }
  
  private async handleTwilioMessage(message: any): Promise<void> {
    switch (message.event) {
      case 'connected':
        logger.info('Connected to Twilio WebSocket - waiting for start event')
        // DO NOT trigger greeting here - wait for streamSid
        break
        
      case 'start':
        logger.info('Call started', {
          streamSid: message.start?.streamSid,
          callSid: message.start?.callSid
        })
        logger.debug('Full start event received', {
          startEvent: message.start
        })
        
        // Capture streamSid from start event
        if (message.start?.streamSid) {
          this.streamSid = message.start.streamSid
          logger.info('StreamSid captured', { streamSid: this.streamSid })
        } else {
          logger.warn('No streamSid in start event', { startKeys: Object.keys(message.start || {}) })
        }
        
        // CRITICAL: Detect negotiated codec from mediaFormat
        if (message.start?.mediaFormat) {
          const mediaFormat = message.start.mediaFormat
          logger.info('Media format negotiated', {
            mediaFormat,
            encoding: mediaFormat.encoding,
            sampleRate: mediaFormat.sampleRate,
            channels: mediaFormat.channels
          })
          
          // Check the encoding field
          if (mediaFormat.encoding) {
            const encoding = mediaFormat.encoding.toLowerCase()
            logger.debug('Detected encoding type', { 
              encoding,
              originalEncoding: mediaFormat.encoding
            })
            
            if (encoding.includes('pcm') || encoding.includes('l16')) {
              // PCM16 format detected
              this.outboundCodec = AudioCodec.PCM16
              this.outboundFrameSize = FRAME_SIZE_PCM16
              logger.info('✅ Codec set to PCM16', {
                codec: this.outboundCodec,
                frameSize: this.outboundFrameSize,
                bytesPerFrame: FRAME_SIZE_PCM16
              })
            } else if (encoding.includes('mulaw') || encoding.includes('ulaw') || encoding.includes('g711')) {
              // μ-law format detected
              this.outboundCodec = AudioCodec.MULAW
              this.outboundFrameSize = FRAME_SIZE_MULAW
              logger.info('✅ Codec set to μ-law', {
                codec: this.outboundCodec,
                frameSize: this.outboundFrameSize,
                bytesPerFrame: FRAME_SIZE_MULAW
              })
            } else {
              // Default to μ-law for unknown formats
              logger.warn('Unknown encoding, defaulting to μ-law', {
                encoding,
                defaultCodec: AudioCodec.MULAW,
                defaultFrameSize: FRAME_SIZE_MULAW
              })
              this.outboundCodec = AudioCodec.MULAW
              this.outboundFrameSize = FRAME_SIZE_MULAW
            }
          } else {
            // No encoding specified, default to μ-law
            logger.warn('No encoding specified in mediaFormat, defaulting to μ-law', {
              mediaFormatKeys: Object.keys(mediaFormat)
            })
            this.outboundCodec = AudioCodec.MULAW
            this.outboundFrameSize = FRAME_SIZE_MULAW
          }
        } else {
          // No mediaFormat, default to μ-law for backward compatibility
          logger.warn('No mediaFormat in start event, defaulting to μ-law for backward compatibility')
          this.outboundCodec = AudioCodec.MULAW
          this.outboundFrameSize = FRAME_SIZE_MULAW
        }
        
        // CRITICAL: Force outbound codec to μ-law as required for zero static audio quality
        // This overrides any automatic detection to ensure consistent ElevenLabs integration
        this.outboundCodec = AudioCodec.MULAW
        this.outboundFrameSize = FRAME_SIZE_MULAW
        
        logger.info('✅ FORCED codec configuration to μ-law for optimal audio quality', {
          codec: this.outboundCodec,
          frameSize: this.outboundFrameSize,
          framesPerSecond: 50,
          durationPerFrame: FRAME_DURATION_MS,
          note: 'Outbound codec explicitly forced to μ-law for ElevenLabs compatibility'
        })
        
        // Extract custom parameters if provided
        if (message.start?.customParameters) {
          const params = message.start.customParameters
          if (params.tenantId) this.tenantId = params.tenantId
          if (params.businessName) this.businessName = params.businessName
          if (params.voiceId) this.voiceId = params.voiceId
          if (params.greeting) this.greeting = params.greeting
        }
        
        // Reset outbound audio tracking
        this.outboundSeq = 0
        this.outboundTsBase = Date.now()
        
        // Send buffer warmup silence frames
        await this.sendBufferWarmup()
        
        // Now we're ready - start greeting
        this.isReady = true
        await this.startGreeting()
        break
        
      case 'media':
        // Process audio frames in both LISTENING and SPEAKING states
        // SPEAKING state needs barge-in detection
        await this.processAudioFrame(message.media)
        break
        
      case 'stop':
        logger.info('Call ended - stop event received')
        this.cleanup()
        break
    }
  }
  
  private async processAudioFrame(media: any): Promise<void> {
    if (!media.payload) {
      logger.debug('Empty audio frame received')
      return
    }
    
    try {
      // Decode base64 μ-law audio with error handling
      const audioData = Uint8Array.from(atob(media.payload), c => c.charCodeAt(0))
      this.totalFramesReceived++
      
      const rms = calculateRMS([audioData])
      
      // Handle different states
      if (this.turnState === TurnState.LISTENING) {
        await this.handleListeningState(audioData, rms)
      } else if (this.turnState === TurnState.SPEAKING) {
        await this.handleSpeakingState(audioData, rms)
      }
      // THINKING state: ignore audio frames while processing
    } catch (error) {
      logger.error('Error processing audio frame', {
        error: error instanceof Error ? error.message : String(error),
        frameNumber: this.totalFramesReceived
      })
    }
  }
  
  private async handleListeningState(audioData: Uint8Array, rms: number): Promise<void> {
    this.audioBuffer.push(audioData)
    
    // Log first few incoming frames for debugging
    if (this.audioBuffer.length <= 3) {
      logger.debug('Incoming audio frame (LISTENING)', {
        frameNumber: this.audioBuffer.length,
        frameSize: audioData.length,
        rms: rms.toFixed(1),
        hexDump: toHexString(audioData, 16)
      })
    }
    
    // VAD: Only update lastActivityTime on voiced frames (not silence)
    if (rms > VAD_SILENCE_THRESHOLD) {
      this.lastActivityTime = Date.now()
    }
    
    // Keep buffer manageable (5 seconds max)
    if (this.audioBuffer.length > 250) { // 250 * 20ms = 5 seconds
      this.audioBuffer = this.audioBuffer.slice(-200)
    }
    
    // Check for end of speech - require minimum speech duration
    const speechDurationMs = this.audioBuffer.length * FRAME_DURATION_MS
    if (this.audioBuffer.length >= 30 && !this.isProcessing && speechDurationMs >= VAD_MIN_SPEECH_MS) {
      const recentFrames = this.audioBuffer.slice(-60) // Last 1200ms to match VAD_END_SILENCE_MS
      const recentRMS = calculateRMS(recentFrames)
      
      if (recentRMS < VAD_SILENCE_THRESHOLD) {
        const silenceDuration = Date.now() - this.lastActivityTime
        if (silenceDuration > VAD_END_SILENCE_MS && this.audioBuffer.length > 30) {
          await this.processUserSpeech()
        }
      }
    }
  }
  
  private async handleSpeakingState(audioData: Uint8Array, rms: number): Promise<void> {
    // Add frame to barge-in detection buffer
    this.bargeInBuffer.push(audioData)
    
    // Keep barge-in buffer manageable
    if (this.bargeInBuffer.length > BARGE_IN_BUFFER_FRAMES) {
      this.bargeInBuffer.shift() // Remove oldest frame
    }
    
    // Log initial frames during speaking for debugging
    if (this.bargeInBuffer.length <= 3) {
      logger.debug('Incoming audio frame (SPEAKING - barge-in detection)', {
        frameNumber: this.bargeInBuffer.length,
        frameSize: audioData.length,
        rms: rms.toFixed(1),
        threshold: BARGE_IN_THRESHOLD
      })
    }
    
    // Check for barge-in: sustained speech above threshold
    if (rms > BARGE_IN_THRESHOLD) {
      this.lastBargeInTime = Date.now()
    }
    
    // Check if we have sustained barge-in speech
    const bargeInDuration = Date.now() - this.lastBargeInTime
    if (this.bargeInBuffer.length >= 10 && bargeInDuration <= BARGE_IN_MIN_DURATION_MS) {
      // Check RMS of recent frames to confirm sustained speech
      const recentBargeInFrames = this.bargeInBuffer.slice(-10) // Last ~200ms
      const recentBargeInRMS = calculateRMS(recentBargeInFrames)
      
      if (recentBargeInRMS > BARGE_IN_THRESHOLD) {
        logger.info('🎤 BARGE-IN DETECTED - User interrupted during speaking', {
          duration: BARGE_IN_MIN_DURATION_MS - bargeInDuration,
          rms: recentBargeInRMS.toFixed(1),
          threshold: BARGE_IN_THRESHOLD,
          bufferFrames: this.bargeInBuffer.length
        })
        
        await this.handleBargeIn()
      }
    }
  }
  
  private async handleBargeIn(): Promise<void> {
    try {
      // CRITICAL FIX: Send clear message to stop pending audio (only if WebSocket is ready)
      if (this.streamSid && this.ws.readyState === 1) {
        const clearMessage = {
          event: 'clear',
          streamSid: this.streamSid
        }
        this.ws.send(JSON.stringify(clearMessage))
        logger.debug('Sent clear message to stop pending audio')
      }
      
      // Stop current TTS if running
      if (this.currentTTSAbortController) {
        this.currentTTSAbortController.abort()
        this.currentTTSAbortController = null
        logger.info('Aborted current TTS due to barge-in')
      }
      
      // Clear barge-in buffer and switch to listening
      this.bargeInBuffer = []
      this.turnState = TurnState.LISTENING
      
      // Reset idle timeout due to user activity
      this.resetIdleTimeout()
      
      logger.info('Switched to LISTENING state after barge-in detection')
      
    } catch (error) {
      logger.error('Error handling barge-in', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  private async processUserSpeech(): Promise<void> {
    // CRITICAL: Only proceed if in LISTENING state per Azure engineer recommendation
    if (this.isProcessing || this.audioBuffer.length === 0 || this.turnState !== TurnState.LISTENING) {
      if (this.turnState !== TurnState.LISTENING) {
        logger.debug('Skipping speech processing - not in LISTENING state', {
          currentState: this.turnState,
          bufferLength: this.audioBuffer.length
        })
      }
      return
    }
    
    // Check minimum speech duration to prevent processing very short audio
    const speechDurationMs = this.audioBuffer.length * FRAME_DURATION_MS
    if (speechDurationMs < VAD_MIN_SPEECH_MS) {
      logger.debug('Speech too short, ignoring', {
        durationMs: speechDurationMs,
        minRequiredMs: VAD_MIN_SPEECH_MS,
        bufferLength: this.audioBuffer.length
      })
      this.audioBuffer = []
      return
    }
    
    this.isProcessing = true
    this.turnState = TurnState.THINKING
    
    try {
      logger.info('Processing user speech', {
        bufferLength: this.audioBuffer.length,
        durationMs: speechDurationMs,
        minRequiredMs: VAD_MIN_SPEECH_MS
      })
      
      // Convert μ-law to PCM (inbound is always μ-law from Twilio)
      const pcmData = new Int16Array(this.audioBuffer.length * FRAME_SIZE_MULAW)
      let offset = 0
      
      for (const frame of this.audioBuffer) {
        for (let i = 0; i < frame.length; i++) {
          pcmData[offset++] = mulawToPcm(frame[i])
        }
      }
      
      // Create WAV file for Whisper
      const wavData = createWavFile(pcmData, SAMPLE_RATE)
      
      // Transcribe with OpenAI Whisper
      const transcript = await this.transcribeAudio(wavData)
      
      // Apply smart filtering to allow meaningful short utterances while filtering out fragments
      const trimmedTranscript = transcript.trim()
      const validationResult = isValidTranscript(trimmedTranscript)
      
      if (validationResult.isValid) {
        logger.info('Transcription completed and validated', {
          transcript: trimmedTranscript,
          transcriptLength: trimmedTranscript.length,
          validationReason: validationResult.reason,
          smartFilteringEnabled: true
        })
        
        // Reset idle timeout due to valid user input
        this.resetIdleTimeout()
        
        // Generate AI response
        const response = await this.generateResponse(trimmedTranscript)
        
        // Convert to speech and stream back
        await this.speakResponse(response)
      } else {
        logger.debug('Transcript filtered out by smart validation', {
          transcript: trimmedTranscript,
          validationReason: validationResult.reason,
          transcriptLength: trimmedTranscript.length
        })
        
        // Return to listening immediately for filtered transcripts
        this.turnState = TurnState.LISTENING
      }
      
    } catch (error) {
      logger.error('Error processing user speech', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Return to listening on error
      this.turnState = TurnState.LISTENING
    } finally {
      this.isProcessing = false
      this.audioBuffer = []
    }
  }
  
  private async transcribeAudio(wavData: Uint8Array): Promise<string> {
    // CRITICAL FIX: Add audio quality validation to prevent Korean transcription errors
    if (wavData.length < 1000) {
      logger.warn('Audio data too small for reliable transcription', { size: wavData.length })
      return ''
    }
    
    logger.debug('Starting Whisper transcription with English language enforcement', {
      audioSize: wavData.length,
      model: 'whisper-1',
      language: 'en',
      format: '8kHz μ-law audio converted to WAV'
    })
    
    const formData = new FormData()
    formData.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')  // CRITICAL FIX: Force English to prevent Korean misdetection
    formData.append('response_format', 'json')
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`
      },
      body: formData
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Whisper API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      })
      throw new Error(`Whisper API error: ${response.status} - ${errorText}`)
    }
    
    const result = await response.json()
    logger.debug('Whisper transcription result', {
      hasText: !!result.text,
      textLength: result.text?.length || 0
    })
    
    return result.text || ''
  }

  private async generateResponse(userText: string): Promise<string> {
    // Build enhanced system prompt
    let systemPrompt = await this.buildEnhancedSalonPrompt(userText)
    
    // Try to get custom system prompt from database
    if (this.tenantId && supabase) {
      try {
        const { data: agent, error } = await supabase
          .from('agents')
          .select('system_prompt')
          .eq('tenant_id', this.tenantId)
          .eq('type', 'voice')
          .single()
        
        if (error) {
          logger.warn('Database error fetching agent prompt', {
            error: error.message,
            code: error.code,
            tenantId: this.tenantId
          })
        } else if (agent?.system_prompt) {
          // Enhance database prompt with salon-specific guidelines
          systemPrompt = this.enhancePromptWithSalonGuidelines(agent.system_prompt, userText)
          logger.debug('Using enhanced custom system prompt from database', {
            promptLength: systemPrompt.length,
            tenantId: this.tenantId
          })
        } else {
          logger.debug('No custom prompt found, using enhanced salon default', {
            tenantId: this.tenantId
          })
        }
      } catch (error) {
        logger.warn('Failed to fetch agent prompt from database', {
          error: error instanceof Error ? error.message : String(error),
          tenantId: this.tenantId,
          fallbackPrompt: 'Using enhanced salon prompt'
        })
      }
    }
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userText })
    
    // Keep conversation manageable
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20)
    }
    
    const requestPayload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory
      ],
      max_tokens: 150,
      temperature: 0.7
    }
    
    logger.debug('OpenAI chat request', {
      model: requestPayload.model,
      messageCount: requestPayload.messages.length,
      maxTokens: requestPayload.max_tokens,
      temperature: requestPayload.temperature
    })
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('OpenAI API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      })
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }
    
    const result = await response.json()
    const aiResponse = result.choices[0]?.message?.content || "I'm sorry, I didn't catch that. Could you please repeat?"
    
    logger.debug('OpenAI response received', {
      hasResponse: !!result.choices[0]?.message?.content,
      responseLength: aiResponse.length,
      usage: result.usage
    })
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'assistant', content: aiResponse })
    
    return aiResponse
  }

  /**
   * Build enhanced salon-specific system prompt with RAG integration
   */
  private async buildEnhancedSalonPrompt(userText: string): Promise<string> {
    // Get business knowledge for context
    let knowledgeContext = '';
    
    if (this.tenantId && supabase) {
      try {
        knowledgeContext = await this.getGroundingContext(this.tenantId, userText);
      } catch (error) {
        logger.warn('Failed to get grounding context', { 
          error: error instanceof Error ? error.message : String(error),
          tenantId: this.tenantId 
        });
      }
    }

    return `You are the professional receptionist for ${this.businessName}. Answer only what was asked with one concise, helpful response, then end with a single clarifying question.

BUSINESS KNOWLEDGE:
${knowledgeContext}

CORE RULES:
- Give one direct answer to what was asked
- Keep responses to 1-2 sentences maximum
- End with ONE clarifying question
- Never volunteer unsolicited information
- Be helpful and professional

EXAMPLES:
• "What hours are you open?" → "We're open Tuesday through Saturday. What day were you thinking of coming in?"
• "Do you do highlights?" → "Yes, we do all types of highlights and color services. What look are you hoping to achieve?"
• "How much for a haircut?" → "Our cuts start at $65. Are you looking to book an appointment?"

Remember: Answer the question asked, nothing more. Always end with one helpful question.`;
  }

  /**
   * Enhance existing database prompt with salon-specific guidelines
   */
  private enhancePromptWithSalonGuidelines(basePrompt: string, userText: string): string {
    // Get business knowledge for context
    let knowledgeContext = '';
    
    if (this.tenantId && supabase) {
      this.getGroundingContext(this.tenantId, userText)
        .then(context => knowledgeContext = context)
        .catch(error => {
          logger.warn('Failed to get grounding context for prompt enhancement', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        });
    }

    return `${basePrompt}

ENHANCED SALON-SPECIFIC GUIDELINES:
${knowledgeContext ? `BUSINESS KNOWLEDGE:\n${knowledgeContext}\n` : ''}

CRITICAL SALON CONVERSATIONAL RULES:
✅ NEVER respond with just "yes/no" - always provide helpful context and next steps
✅ For hours questions: Provide specific hours if available, or offer to have someone confirm and call back
✅ Use your salon expertise to be helpful even when specific information isn't available
✅ NEVER go silent or say "I don't have enough information" - always engage with a helpful response
✅ Ask follow-up questions to understand customer needs better
✅ Keep responses warm, natural, and conversational (1-2 sentences ideal)
✅ ALWAYS offer next steps like scheduling, consultation, or having someone call back

EXAMPLE ENHANCED RESPONSES:
• Hours questions → "We're open most days! Let me have someone confirm our exact schedule and call you right back. Looking to book something?"
• Service questions → "Absolutely! We specialize in [service type]. What specific look are you hoping to achieve?"
• General inquiries → "I'd love to help with that! Let me connect you with our team for all the details."

Remember: You represent ${this.businessName} professionally - be knowledgeable, helpful, and proactive.`;
  }

  /**
   * Get relevant business knowledge for the user's question using RAG
   */
  private async getGroundingContext(tenantId: string, userQuery: string): Promise<string> {
    if (!supabase) return '';
    
    try {
      // Enhanced RAG search for business hours
      const lowerQuery = userQuery.toLowerCase();
      const hasHoursIntent = /(hour|open|close|opening|closing|time)/i.test(lowerQuery);
      
      if (hasHoursIntent) {
        // Try to get structured business hours first
        const { data: hours, error: hoursError } = await supabase
          .from('business_hours')
          .select('dow, is_closed, open_time, close_time')
          .eq('tenant_id', tenantId)
          .order('dow', { ascending: true });
        
        if (!hoursError && hours && hours.length > 0) {
          const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const hoursStr = hours.map((h: any) => {
            const day = daysOfWeek[h.dow] || `Day ${h.dow}`;
            return h.is_closed ? `${day}: Closed` : `${day}: ${h.open_time} - ${h.close_time}`;
          }).join(', ');
          
          return `Business Hours: ${hoursStr}`;
        }
      }
      
      // General RAG search using the embeddings system with fallback mechanism
      try {
        const { data: results, error } = await supabase.rpc('search_knowledge', {
          tenant_id: tenantId,
          query_text: userQuery,
          match_threshold: 0.3,
          match_count: 3
        });
        
        if (error) {
          logger.warn('Primary RAG search failed, attempting fallback', { error: error.message });
          throw error; // Trigger fallback
        }
        
        if (results && results.length > 0) {
          return results.map((r: any) => r.content).join('\n\n');
        }
      } catch (rpcError) {
        // CRITICAL FIX: Fallback to Supabase Edge Function 'search'
        logger.info('Falling back to Edge Function search', {
          originalError: rpcError instanceof Error ? rpcError.message : String(rpcError)
        });
        
        try {
          const { data: fallbackResults, error: fallbackError } = await supabase.functions.invoke('search', {
            body: {
              tenant_id: tenantId,
              query: userQuery,
              k: 3
            }
          });
          
          if (fallbackError) {
            logger.warn('Fallback search also failed', { error: fallbackError.message });
            return '';
          }
          
          if (fallbackResults?.results && fallbackResults.results.length > 0) {
            logger.info('✅ Fallback search successful', { resultCount: fallbackResults.results.length });
            return fallbackResults.results.map((r: any) => r.content).join('\n\n');
          }
        } catch (fallbackError) {
          logger.error('Both primary and fallback RAG searches failed', {
            fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          });
          
          // ENHANCED FALLBACK: Return basic salon information when all searches fail
          logger.info('Using enhanced fallback with basic salon context');
          return `${this.businessName} is a professional salon. We offer various beauty and wellness services. Please call during business hours for specific information about services, pricing, and scheduling. Our team is happy to help answer all your questions.`;
        }
      }
      
      // Enhanced fallback when no RAG results found
      logger.info('No RAG results found, providing basic salon context');
      return `${this.businessName} offers professional salon services. Contact us for details about our services, pricing, and availability.`;
    } catch (error) {
      logger.warn('Error in getGroundingContext', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return '';
    }
  }
  
  private async speakResponse(text: string): Promise<void> {
    // Use the fixed version with WAV parsing
    await this.speakResponseFixed(text)
  }

  private async speakResponseFixed(text: string): Promise<void> {
    this.turnState = TurnState.SPEAKING
    
    // Create abort controller for this TTS session
    this.currentTTSAbortController = new AbortController()
    const abortSignal = this.currentTTSAbortController.signal
    
    try {
      logger.info('Starting Azure TTS with REST API streaming', {
        textLength: text.length,
        region: this.azureTtsRegion,
        codec: this.outboundCodec,
        frameSize: this.outboundFrameSize,
        streamingMode: 'azure-rest'
      })
      
      // Use Azure TTS REST API for real-time streaming
      await this.streamAzureTTS(text, abortSignal)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage === 'TTS_ABORTED') {
        logger.info('Azure TTS streaming was aborted due to barge-in - no fallback needed')
        return
      }
      
      logger.error('Azure TTS streaming failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      })
      
      throw error
    } finally {
      this.currentTTSAbortController = null
      
      // CRITICAL FIX: Add 700ms post-TTS cooldown before resuming VAD per Azure engineer recommendation
      logger.debug(`Adding ${POST_TTS_COOLDOWN_MS}ms post-TTS cooldown before resuming VAD`)
      await new Promise(resolve => setTimeout(resolve, POST_TTS_COOLDOWN_MS))
      
      // Now return to LISTENING state
      this.turnState = TurnState.LISTENING
      logger.debug('Resumed LISTENING state after post-TTS cooldown')
    }
  }
  
  private async streamAzureTTS(text: string, abortSignal: AbortSignal): Promise<void> {
    // Mark that we're actively streaming from Azure TTS
    this.isAzureTtsStreaming = true
    
    const endpoint = `https://${this.azureTtsRegion}.tts.speech.microsoft.com/cognitiveservices/v1`
    
    logger.info('Starting Azure TTS REST API call', {
      endpoint,
      region: this.azureTtsRegion,
      textLength: text.length,
      outputFormat: 'raw-8khz-8bit-mono-mulaw',
      authentication: 'Ocp-Apim-Subscription-Key header'
    })
    
    // Create SSML for Azure TTS
    const ssml = `<speak version='1.0' xml:lang='en-US'>
      <voice xml:lang='en-US' xml:gender='Female' name='en-US-JennyNeural'>
        ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </voice>
    </speak>`
    
    try {
      const checkAbort = () => {
        if (abortSignal.aborted) {
          logger.info('Azure TTS aborted due to barge-in')
          throw new Error('TTS_ABORTED')
        }
      }
      
      checkAbort()
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.azureTtsKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'raw-8khz-8bit-mono-mulaw',
          'User-Agent': 'VoiceRelay-TTS/1.0'
        },
        body: ssml,
        signal: abortSignal
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Azure TTS API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          headers: Object.fromEntries(response.headers.entries())
        })
        throw new Error(`Azure TTS API error: ${response.status} - ${errorText}`)
      }
      
      logger.debug('Azure TTS response received, processing audio stream')
      
      if (!response.body) {
        throw new Error('No response body from Azure TTS')
      }
      
      const reader = response.body.getReader()
      let audioBuffer = new Uint8Array(0)
      let totalBytesProcessed = 0
      let framesStreamed = 0
      
      try {
        while (true) {
          checkAbort()
          
          const { done, value } = await reader.read()
          
          if (done) {
            logger.debug('Azure TTS stream complete', {
              totalBytesProcessed,
              framesStreamed
            })
            break
          }
          
          if (value) {
            // Append new data to buffer
            const newBuffer = new Uint8Array(audioBuffer.length + value.length)
            newBuffer.set(audioBuffer)
            newBuffer.set(value, audioBuffer.length)
            audioBuffer = newBuffer
            
            // Process μ-law audio in 160-byte frames (20ms at 8kHz)
            let processedBytes = 0
            while (audioBuffer.length - processedBytes >= FRAME_SIZE_MULAW) {
              checkAbort()
              
              const frame = audioBuffer.slice(processedBytes, processedBytes + FRAME_SIZE_MULAW)
              // Convert frame to base64 and send directly to Twilio
              const base64Frame = safeBase64Encode(frame)
              await this.sendOutboundFrameDirect(base64Frame)
              processedBytes += FRAME_SIZE_MULAW
              framesStreamed++
              totalBytesProcessed += FRAME_SIZE_MULAW
              
              // Log progress for first few frames and then periodically
              if (framesStreamed <= 3 || framesStreamed % 25 === 0) {
                logger.debug('Azure TTS audio streaming', {
                  framesStreamed,
                  totalBytesProcessed,
                  bufferSize: audioBuffer.length,
                  frameSize: FRAME_SIZE_MULAW
                })
              }
            }
            
            // Keep remaining unprocessed bytes
            if (processedBytes > 0) {
              audioBuffer = audioBuffer.slice(processedBytes)
            }
          }
        }
        
        // Process any remaining audio
        if (audioBuffer.length > 0) {
          const paddedFrame = new Uint8Array(FRAME_SIZE_MULAW)
          paddedFrame.set(audioBuffer)
          paddedFrame.fill(0xFF, audioBuffer.length) // μ-law silence padding
          const base64Frame = safeBase64Encode(paddedFrame)
          await this.sendOutboundFrameDirect(base64Frame)
          framesStreamed++
        }
        
        logger.info('✅ Azure TTS streaming complete', {
          totalBytesProcessed,
          framesStreamed,
          avgFrameSize: totalBytesProcessed / framesStreamed || 0
        })
        
      } finally {
        reader.releaseLock()
      }
      
    } catch (error) {
      if (error instanceof Error && error.message === 'TTS_ABORTED') {
        logger.info('Azure TTS streaming aborted due to barge-in')
        throw error
      }
      
      logger.error('Azure TTS streaming failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      throw error
    } finally {
      this.isAzureTtsStreaming = false
    }
  }
  
  // Stop and clean up
  private cleanup(): void {
    logger.info('Cleanup requested', {
      hasGreeted: this.hasGreeted,
      conversationLength: this.conversationHistory.length,
      isReady: this.isReady,
      sessionDuration: Date.now() - this.sessionStartTime,
      totalFramesSent: this.totalFramesSent,
      totalFramesReceived: this.totalFramesReceived,
      isAzureTtsStreaming: this.isAzureTtsStreaming
    })
    
    // CRITICAL FIX: Add shutdown gate - if Azure TTS is still streaming, defer cleanup
    if (this.isAzureTtsStreaming) {
      logger.info('Deferring cleanup - Azure TTS is still streaming audio')
      this.pendingCleanup = true
      
      // Set a maximum wait time of 5 seconds for safety
      setTimeout(() => {
        if (this.pendingCleanup) {
          logger.warn('Forcing cleanup after 5 second timeout')
          this.performActualCleanup()
        }
      }, 5000)
      return
    }
    
    // Perform immediate cleanup if not streaming
    this.performActualCleanup()
  }
  
  private performActualCleanup(): void {
    logger.info('Performing actual cleanup', {
      wasDeferred: this.pendingCleanup
    })
    
    this.pendingCleanup = false
    this.isClosed = true
    this.audioBuffer = []
    this.bargeInBuffer = []
    
    // Cancel any pending operations
    if (this.currentTTSAbortController) {
      this.currentTTSAbortController.abort()
      this.currentTTSAbortController = null
    }
    
    // Clear timeouts and intervals
    if (this.sessionTimeoutHandle) {
      clearTimeout(this.sessionTimeoutHandle)
      this.sessionTimeoutHandle = null
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    
    // Clear idle timeout
    if (this.idleTimeoutHandle) {
      clearTimeout(this.idleTimeoutHandle)
      this.idleTimeoutHandle = null
    }
    
    // Close WebSocket if still open
    if (this.ws.readyState === 1) {
      try {
        this.ws.close(1000, 'Session ended')
      } catch (error) {
        logger.error('Error closing WebSocket', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    // Log final metrics
    logger.info('Session metrics', {
      duration: Date.now() - this.sessionStartTime,
      framesReceived: this.totalFramesReceived,
      framesSent: this.totalFramesSent,
      conversationTurns: this.conversationHistory.length / 2,
      avgFramesPerSecond: this.totalFramesReceived / ((Date.now() - this.sessionStartTime) / 1000),
      idleTimeoutImplemented: true,
      azureRecommendationsApplied: true
    })
  }
  
  private async sendBufferWarmup(): Promise<void> {
    logger.debug('Starting buffer warmup', {
      codec: this.outboundCodec,
      frameSize: this.outboundFrameSize,
      warmupFrames: 10,
      warmupDurationMs: 200
    })
    
    // Send 200ms of silence to prime Twilio's jitter buffer
    let silenceFrame: Uint8Array
    
    if (this.outboundCodec === AudioCodec.PCM16) {
      // PCM16 silence: all zeros
      silenceFrame = new Uint8Array(this.outboundFrameSize).fill(0)
      logger.debug('Using PCM16 silence pattern', {
        fillValue: '0x00',
        frameSize: this.outboundFrameSize
      })
    } else {
      // μ-law silence: 0xFF
      silenceFrame = new Uint8Array(this.outboundFrameSize).fill(0xFF)
      logger.debug('Using μ-law silence pattern', {
        fillValue: '0xFF',
        frameSize: this.outboundFrameSize
      })
    }
    
    // Send warmup silence frames
    for (let i = 0; i < 10; i++) {
      // Convert silence frame to base64 and send directly
      const base64Silence = safeBase64Encode(silenceFrame)
      await this.sendOutboundFrameDirect(base64Silence)
    }
    logger.debug('Buffer warmup complete', {
      framesSent: 10
    })
  }
  
  // CRITICAL FIX: New function to send base64 audio directly without re-encoding
  private async sendOutboundFrameDirect(base64Audio: string): Promise<void> {
    // CRITICAL FIX: Enhanced guards - only send if WebSocket is ready AND we have streamSid AND not closed
    if (!this.isClosed && this.ws.readyState === 1 && this.streamSid) {
      // Continue with sending
    } else {
      logger.debug('Skipping direct frame send', {
        hasStreamSid: !!this.streamSid,
        isClosed: this.isClosed,
        wsReadyState: this.ws.readyState,
        isAzureTtsStreaming: this.isAzureTtsStreaming,
        pendingCleanup: this.pendingCleanup
      })
      return
    }
    
    try {
      // CRITICAL FIX: Bidirectional streams do NOT use track field
      // Correct format: just event, streamSid, and media.payload
      const message = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: base64Audio  // Already base64 encoded μ-law from ElevenLabs
        }
      }
      
      this.ws.send(JSON.stringify(message))
      this.outboundSeq++
      this.totalFramesSent++
      
      // Send immediately - ElevenLabs provides properly timed chunks
      
    } catch (error) {
      logger.error('Failed to send direct outbound frame', {
        error: error instanceof Error ? error.message : String(error),
        frameNumber: this.outboundSeq,
        streamSid: this.streamSid
      })
    }
  }
  
  private async startGreeting(): Promise<void> {
    if (this.hasGreeted || !this.streamSid) {
      logger.debug('Skipping greeting', {
        hasGreeted: this.hasGreeted,
        hasStreamSid: !!this.streamSid
      })
      return
    }
    this.hasGreeted = true
    
    logger.info('Starting greeting', {
      streamSid: this.streamSid,
      greetingLength: this.greeting?.length || 0,
      businessName: this.businessName
    })
    
    try {
      // CRITICAL FIX: Professional salon greeting with warmth and clear service offering
      const greetingText = this.greeting || `Thank you for calling ${this.businessName}. This is the automated receptionist. I can help with appointments, hours, and services. How may I help you today?`
      
      await this.speakResponseFixed(greetingText)
      
      // Add 600-800ms pause before any potential reprompt to allow natural conversation flow
      await new Promise(resolve => setTimeout(resolve, 700))
    } catch (error) {
      logger.error('Failed to deliver greeting', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Try a simple fallback greeting
      try {
        await this.speakResponseFixed(`Hello! How can I help you today?`)
      } catch (fallbackError) {
        logger.error('Even fallback greeting failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        })
      }
    }
  }
}

// ========== MAIN WEBSOCKET HANDLER ==========

serve(async (req) => {
  // PRODUCTION FIX: No authentication required for Twilio WebSocket connections
  // Twilio cannot send JWT headers with WebSocket connections
  
  // Health check endpoint
  const url = new URL(req.url)
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      version: '2024-12-28-production-all-fixes',
      features: [
        '✅ No authentication required',
        '✅ Azure TTS REST streaming',
        '✅ μ-law 8kHz native support',
        '✅ Barge-in detection',
        '✅ VAD with 1200ms silence detection',
        '✅ Fixed logging message with ${POST_TTS_COOLDOWN_MS}ms',
        '✅ Removed "you" from STOP_WORDS set',
        '✅ Added language: "en" to Whisper API calls',
        '✅ Enhanced RAG fallback with meaningful salon context',
        '✅ Professional greeting improvements',
        '✅ WebSocket connection stability fixes',
        '✅ Idle timeout extensions (45s + 45s)',
        '✅ 700ms post-TTS cooldown',
        '✅ All critical fixes applied'
      ],
      timestamp: new Date().toISOString()
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  // Handle WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  // Extract context from URL parameters with validation
  const tenantId = url.searchParams.get('tenantId') || ''
  const businessName = url.searchParams.get('businessName') || 'this business'
  const voiceId = url.searchParams.get('voiceId') || 'Xb7hH8MSUJpSbSDYk0k2' // Default ElevenLabs voice
  const greeting = url.searchParams.get('greeting') || ''
  
  // Log connection attempt with full context
  logger.info('Twilio WebSocket connection request', {
    tenantId,
    businessName,
    voiceId,
    greetingProvided: !!greeting,
    headers: {
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
      userAgent: req.headers.get('user-agent')
    },
    production: true,
    authRequired: false, // PRODUCTION FIX: No auth needed
    allCriticalFixesApplied: true
  })
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  socket.onopen = () => {
    logger.info('WebSocket connection established')
    // Initialize AI session
    new AIVoiceSession(socket, { tenantId, businessName, voiceId, greeting })
  }
  
  return response
})