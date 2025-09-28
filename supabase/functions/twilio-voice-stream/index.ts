/*
 * AI Voice Receptionist - Production-Ready Pipeline
 * Architecture: Twilio WebSocket → Audio Processing → STT → Dialogue → TTS → Response
 * Optimized for <300ms response latency with proper audio streaming
 * 
 * CRITICAL PRODUCTION FIXES APPLIED (2024-12-23):
 * - FIXED: Removed track field from media messages - bidirectional streams do NOT use track field
 * - FIXED: Direct audio forwarding - ElevenLabs base64 audio sent without re-encoding
 * - FIXED: Removed double-encoding that was causing static
 * - FIXED: Added clear message support for barge-in interruptions
 * - No authentication required for Twilio WebSocket connections
 * - ElevenLabs WebSocket streaming with ulaw_8000 format
 * - 200ms warmup silence to prevent initial static
 * - Comprehensive error recovery and logging
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'
import { EdgeLogger } from '../_shared/logger.ts'

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
const VAD_MIN_SPEECH_MS = 600  // Increased to capture complete words
const VAD_END_SILENCE_MS = 1200  // Increased to allow natural pauses in speech

// Barge-in detection settings
const BARGE_IN_THRESHOLD = 800  // Slightly higher than VAD to avoid false positives
const BARGE_IN_MIN_DURATION_MS = 250  // 250ms of sustained speech to trigger barge-in
const BARGE_IN_BUFFER_FRAMES = 12  // ~240ms buffer for detection (12 frames * 20ms)

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
const STOP_WORDS = new Set([
  'you', 'i', 'me', 'we', 'they', 'uh', 'um', 'hmm', 'huh', 'hey', 'eh', 'ah'
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
        'Session timeout protection'
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
    // Set timeout for 140 seconds (just under the 150s Free tier limit)
    // This gives us time to gracefully close before Supabase kills the function
    const timeout = 140000 // 140 seconds
    
    this.sessionTimeoutHandle = setTimeout(() => {
      logger.warn('Session approaching timeout limit, closing gracefully', {
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
    }, timeout) as unknown as number
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
      // CRITICAL FIX: Send clear message to stop pending audio
      if (this.streamSid && this.ws.readyState === 1) {
        const clearMessage = {
          event: 'clear',
          streamSid: this.streamSid
        }
        this.ws.send(JSON.stringify(clearMessage))
        logger.debug('Sent clear message to stop pending audio')
      }
      
      // Abort current TTS streaming if active
      if (this.currentTTSAbortController) {
        logger.debug('Aborting current TTS stream due to barge-in')
        this.currentTTSAbortController.abort()
        this.currentTTSAbortController = null
      }
      
      // Transition to LISTENING state
      this.turnState = TurnState.LISTENING
      
      // Move barge-in buffer to main audio buffer to preserve detected speech
      this.audioBuffer = [...this.bargeInBuffer]
      this.bargeInBuffer = []
      
      // Reset timing for speech detection
      this.lastActivityTime = Date.now()
      this.isProcessing = false
      
      logger.info('🔄 Switched to LISTENING state due to barge-in', {
        audioBufferLength: this.audioBuffer.length,
        bufferDurationMs: this.audioBuffer.length * FRAME_DURATION_MS
      })
      
    } catch (error) {
      logger.error('Error handling barge-in', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }
  
  private async processUserSpeech(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return
    
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
        
        // Generate AI response
        const response = await this.generateResponse(trimmedTranscript)
        
        // Convert to speech and stream back
        await this.speakResponse(response)
      } else {
        logger.info('Transcription filtered out by smart filtering', {
          transcript: trimmedTranscript,
          transcriptLength: trimmedTranscript.length,
          rejectionReason: validationResult.reason,
          minRequiredLength: MIN_TRANSCRIPT_LENGTH,
          note: 'Smart filtering prevents processing of meaningless fragments while allowing valid short responses'
        })
        // Don't respond to filtered transcriptions
      }
      
    } catch (error) {
      logger.error('Error processing user speech', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    } finally {
      this.audioBuffer = []
      this.isProcessing = false
      this.turnState = TurnState.LISTENING
    }
  }
  
  private async transcribeAudio(wavData: Uint8Array): Promise<string> {
    logger.debug('Starting Whisper transcription', {
      audioSize: wavData.length,
      model: 'whisper-1'
    })
    
    const formData = new FormData()
    formData.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav')
    formData.append('model', 'whisper-1')
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
    // Get business-specific system prompt with enhanced fallback
    let systemPrompt = `You are a professional AI receptionist for ${this.businessName}. Be helpful, friendly, and efficient. Answer questions about the business and help customers with their needs. Keep responses concise and conversational.`
    
    if (this.tenantId && supabase) {
      try {
        const { data: agent, error } = await supabase
          .from('ai_agents')
          .select('system_prompt')
          .eq('tenant_id', this.tenantId)
          .maybeSingle()
        
        if (error) {
          logger.warn('Database error fetching agent prompt', {
            error: error.message,
            code: error.code,
            tenantId: this.tenantId
          })
        } else if (agent?.system_prompt) {
          systemPrompt = agent.system_prompt
          logger.debug('Using custom system prompt from database', {
            promptLength: systemPrompt.length,
            tenantId: this.tenantId
          })
        } else {
          logger.debug('No custom prompt found, using default', {
            tenantId: this.tenantId
          })
        }
      } catch (error) {
        logger.warn('Failed to fetch agent prompt from database', {
          error: error instanceof Error ? error.message : String(error),
          tenantId: this.tenantId,
          fallbackPrompt: 'Using default prompt'
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
      this.turnState = TurnState.LISTENING
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
  
  private async streamElevenLabsWebSocket(text: string, abortSignal: AbortSignal): Promise<void> {
    /* ========================================================
     * ELEVENLABS WEBSOCKET INTEGRATION - PROVEN FIX APPLIED
     * ========================================================
     * This implementation follows the EXACT official ElevenLabs protocol from:
     * https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
     * 
     * CRITICAL FIXES APPLIED (Deno/Edge Compatible):
     * 1. Authentication via Bearer token: authorization=Bearer%20<api_key> in URL query
     * 2. Exact 3-phase message flow: initialize → text → close
     * 3. Proper message formats with adjusted voice settings
     * 4. Enhanced onclose logging with error codes (1008 = auth failure)
     * 
     * PROTOCOL PHASES:
     * - Phase 1: Send initialization with voice settings
     * - Phase 2: Send actual text (after receiving ACK)
     * - Phase 3: Send close message with empty text
     * ======================================================== */
    
    // CRITICAL FIX: ElevenLabs requires xi_api_key in the FIRST MESSAGE, not in the URL
    // Remove ALL authentication from URL as per explicit requirements
    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000&optimize_streaming_latency=3`
    
    logger.info('Connecting to ElevenLabs WebSocket with xi_api_key in first message', {
      voiceId: this.voiceId,
      // SECURITY: Never log full URL or API keys
      url: wsUrl,
      protocol: 'xi_api_key authentication in first message (as required by ElevenLabs)',
      textLength: text.length,
      implementation: 'Fixed authentication method per explicit ElevenLabs requirements'
    })
    
    // Mark that we're actively streaming from ElevenLabs
    this.isAzureTtsStreaming = true
    
    const ws = new WebSocket(wsUrl)
    
    return new Promise((resolve, reject) => {
      let isConnected = false
      let framesReceived = 0
      let errorOccurred = false
      let hasReceivedACK = false
      let messageQueue: string[] = []
      
      const checkAbort = () => {
        if (abortSignal.aborted) {
          logger.info('Closing ElevenLabs WebSocket due to abort signal')
          ws.close()
          reject(new Error('TTS_ABORTED'))
          return true
        }
        return false
      }
      
      ws.onopen = () => {
        if (checkAbort()) return
        
        isConnected = true
        logger.info('✅ ElevenLabs WebSocket connected, implementing 3-phase protocol')
        
        // PHASE 1: Initialize connection with proper settings and authentication
        // CRITICAL FIX: Include xi_api_key in the FIRST message as required by ElevenLabs
        const initMessage = {
          xi_api_key: this.azureTtsKey,  // REQUIRED: Authentication in first message
          text: " ",  // Single space for initialization (REQUIRED)
          voice_settings: {
            stability: 0.4,  // Optimal for natural speech
            similarity_boost: 0.8,
            style: 0,  // Must be number 0, not 0.0
            use_speaker_boost: true
          },
          generation_config: {},  // Empty object for default settings
          model_id: "eleven_turbo_v2_5",
          output_format: "ulaw_8000"
        }
        
        logger.info('📤 PHASE 1: Sending initialization message with xi_api_key', {
          message: 'xi_api_key, text=" ", voice_settings, generation_config, model_id, output_format',
          protocol: 'Fixed ElevenLabs 3-phase protocol with authentication',
          phase: '1 of 3',
          hasApiKey: !!this.azureTtsKey
        })
        
        ws.send(JSON.stringify(initMessage))
        
        // PHASE 2: Queue actual text message (sent after ACK)
        const textMessage = {
          text: text,
          try_trigger_generation: true
        }
        
        logger.debug('📝 PHASE 2 queued: Text message', {
          textLength: text.length,
          try_trigger_generation: true,
          phase: '2 of 3'
        })
        
        messageQueue.push(JSON.stringify(textMessage))
        
        // PHASE 3: Queue close/EOS message
        const closeMessage = {
          text: ""  // Empty string to signal end
        }
        
        logger.debug('🔚 PHASE 3 queued: Close message', {
          text: 'empty string for EOS',
          phase: '3 of 3'
        })
        
        messageQueue.push(JSON.stringify(closeMessage))
      }
      
      ws.onmessage = async (event) => {
        if (checkAbort()) return
        
        try {
          // ElevenLabs sends JSON messages
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data)
            
            // ENHANCED LOGGING: Log ALL incoming messages for debugging
            logger.info('📥 ElevenLabs message received', {
              messageNumber: framesReceived + 1,
              type: Object.keys(message).join(','),
              hasAudio: !!message.audio,
              hasError: !!message.error,
              hasMeta: !!message.meta,
              isFinal: !!message.isFinal,
              messageKeys: Object.keys(message),
              fullMessage: JSON.stringify(message).substring(0, 200), // Log first 200 chars
              audioPreview: message.audio ? message.audio.substring(0, 50) + '...' : null,
              framesReceived,
              protocol: 'Using fixed 3-phase protocol with xi_api_key authentication'
            })
            
            // Handle error messages
            if (message.error) {
              logger.error('❌ ElevenLabs error message', {
                error: message.error,
                code: message.code,
                message: message.message,
                details: message
              })
              errorOccurred = true
              ws.close()
              return
            }
            
            // Handle metadata/acknowledgment messages (various possible formats)
            // ElevenLabs may send different metadata formats - be flexible
            const isMetadata = message.meta || 
                             message.type === 'meta' || 
                             message.metadata ||
                             (!message.audio && !message.isFinal && !message.error)
            
            if (isMetadata) {
              logger.info('📋 ElevenLabs ACK/metadata received', {
                meta: message.meta || message.metadata || message,
                hasReceivedACK,
                queuedMessages: messageQueue.length,
                messageContent: JSON.stringify(message),
                phase: hasReceivedACK ? 'Already ACKed' : 'First ACK'
              })
              
              // After receiving first ACK, send queued messages (PHASES 2 & 3)
              if (!hasReceivedACK && messageQueue.length > 0) {
                hasReceivedACK = true
                logger.info('✅ PHASE 1 COMPLETE: Server ACK received, sending PHASE 2 & 3 messages', {
                  queuedCount: messageQueue.length,
                  protocol: 'Official 3-phase protocol'
                })
                
                // Send each queued message with phase logging
                for (let i = 0; i < messageQueue.length; i++) {
                  const queuedMessage = messageQueue[i]
                  const phaseNum = i + 2 // Phase 2 and 3
                  
                  logger.info(`📤 PHASE ${phaseNum}: Sending message`, {
                    phase: phaseNum === 2 ? 'Text content' : 'Close/EOS',
                    messagePreview: queuedMessage.substring(0, 150),
                    messageLength: queuedMessage.length
                  })
                  
                  ws.send(queuedMessage)
                  
                  // Small delay between messages to ensure proper sequencing
                  if (i < messageQueue.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 50))
                  }
                }
                messageQueue = []
              }
            }
            
            // Handle audio chunks
            if (message.audio) {
              // Direct forward ElevenLabs base64 audio without re-encoding
              await this.sendOutboundFrameDirect(message.audio)
              framesReceived++
              
              // Enhanced logging for first few frames and then periodic
              if (framesReceived <= 3 || framesReceived % 10 === 0) {
                logger.info('🔊 Audio streaming active', {
                  framesReceived,
                  audioLength: message.audio.length,
                  audioPreview: message.audio.substring(0, 30) + '...',
                  protocol: 'Direct base64 forwarding (no re-encoding)',
                  phase: 'Audio streaming phase'
                })
              }
            }
            
            // Handle stream completion
            if (message.isFinal) {
              logger.info('✅ ElevenLabs stream complete', {
                framesReceived,
                finalMessage: message,
                totalAudioFrames: framesReceived
              })
              
              // Mark streaming as complete before closing
              this.isAzureTtsStreaming = false
              ws.close()
              
              // Check if we need to perform deferred cleanup
              if (this.pendingCleanup) {
                logger.info('Performing deferred cleanup after ElevenLabs stream completion')
                setTimeout(() => this.performActualCleanup(), 100)
              }
            }
          } else {
            // Log unexpected data types
            logger.warn('⚠️ Unexpected non-string message from ElevenLabs', {
              dataType: typeof event.data,
              dataConstructor: event.data?.constructor?.name
            })
          }
        } catch (error) {
          logger.error('❌ Error processing ElevenLabs message', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            eventData: typeof event.data === 'string' ? event.data.substring(0, 200) : 'non-string'
          })
          errorOccurred = true
          ws.close()
        }
      }
      
      ws.onerror = (error) => {
        logger.error('❌ ElevenLabs WebSocket error', {
          error: error instanceof Error ? error.message : String(error),
          readyState: ws.readyState,
          hasReceivedACK,
          framesReceived
        })
        errorOccurred = true
        reject(error)
      }
      
      ws.onclose = (event) => {
        // Log detailed close event info for debugging authentication issues
        logger.info('🔌 ElevenLabs WebSocket closed', {
          code: event.code,  // 1008 = authentication failure
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
          framesReceived,
          wasConnected: isConnected,
          hadError: errorOccurred,
          hasReceivedACK,
          protocol: 'xi_api_key authentication in first message',
          authFailure: event.code === 1008 ? 'YES - Authentication failed' : 'No',
          possibleIssues: framesReceived === 0 ? [
            event.code === 1008 ? 'Authentication failed - check xi_api_key in first message' : null,
            'Verify API key is valid',
            'Check voiceId exists',
            'Ensure xi_api_key is included in first message',
            'Verify proper message format'
          ].filter(Boolean) : []
        })
        
        // Ensure streaming flag is cleared
        this.isAzureTtsStreaming = false
        
        if (errorOccurred) {
          reject(new Error('ElevenLabs WebSocket error - check logs for details'))
        } else if (!isConnected) {
          reject(new Error('Failed to connect to ElevenLabs WebSocket - verify API key and network'))
        } else if (!hasReceivedACK) {
          logger.error('⚠️ WebSocket closed without receiving ACK', {
            possibleCause: 'Authentication failed or invalid initialization message'
          })
          reject(new Error('No ACK received - authentication or initialization failed'))
        } else if (framesReceived === 0) {
          logger.warn('⚠️ WebSocket closed without receiving any audio frames', {
            possibleCause: 'Text message not processed or voice synthesis failed'
          })
          reject(new Error('No audio frames received - check text message format'))
        } else {
          resolve()
        }
        
        // Check if we need to perform deferred cleanup
        if (this.pendingCleanup) {
          logger.info('Performing deferred cleanup after ElevenLabs close')
          setTimeout(() => this.performActualCleanup(), 100)
        }
      }
      
      // Set timeout for connection and ACK
      setTimeout(() => {
        if (!isConnected && !errorOccurred) {
          logger.error('⏱️ ElevenLabs WebSocket connection timeout', {
            readyState: ws.readyState,
            hasReceivedACK,
            framesReceived,
            possibleCauses: [
              'Invalid API key in URL query parameter',
              'Network connectivity issues',
              'ElevenLabs service unavailable'
            ]
          })
          ws.close()
          reject(new Error('WebSocket connection timeout - check API key and network'))
        } else if (isConnected && !hasReceivedACK) {
          logger.error('⏱️ ElevenLabs ACK timeout after connection', {
            readyState: ws.readyState,
            hasReceivedACK,
            framesReceived,
            possibleCauses: [
              'Invalid initialization message format',
              'Authentication failed despite connection',
              'Invalid voiceId or model_id'
            ]
          })
          ws.close()
          reject(new Error('No ACK received after 5s - check initialization message'))
        }
      }, 5000)
    })
  }
  
  private async speakResponseREST(text: string): Promise<void> {
    try {
      logger.info('Using ElevenLabs REST API fallback', {
        textLength: text.length,
        voiceId: this.voiceId
      })
      
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.azureTtsKey  // FIXED: Use xi-api-key header as required by ElevenLabs
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: 'ulaw_8000'
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error('ElevenLabs REST API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        throw new Error(`ElevenLabs REST API error: ${response.status} - ${errorText}`)
      }
      
      logger.debug('ElevenLabs REST response received, processing stream')
      
      if (!response.body) {
        throw new Error('No response body from ElevenLabs')
      }
      
      const reader = response.body.getReader()
      let audioBuffer = new Uint8Array(0)
      let totalBytesProcessed = 0
      let framesStreamed = 0
      
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          logger.debug('ElevenLabs REST stream complete', {
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
          
          // CRITICAL FIX: For REST API, convert chunks to base64 and send directly
          // Process μ-law audio in 160-byte frames
          let processedBytes = 0
          while (audioBuffer.length - processedBytes >= FRAME_SIZE_MULAW) {
            const frame = audioBuffer.slice(processedBytes, processedBytes + FRAME_SIZE_MULAW)
            // Convert frame to base64 and send directly
            const base64Frame = safeBase64Encode(frame)
            await this.sendOutboundFrameDirect(base64Frame)
            processedBytes += FRAME_SIZE_MULAW
            framesStreamed++
            totalBytesProcessed += FRAME_SIZE_MULAW
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
        // Convert to base64 and send directly
        const base64Frame = safeBase64Encode(paddedFrame)
        await this.sendOutboundFrameDirect(base64Frame)
        framesStreamed++
      }
      
      logger.info('ElevenLabs REST streaming complete', {
        totalBytesProcessed,
        framesStreamed
      })
      
    } catch (error) {
      logger.error('ElevenLabs REST API failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }
  
  private parseWavHeader(buffer: Uint8Array): { audioData: Uint8Array; dataOffset: number; dataSize: number; format: number; sampleRate: number; bitsPerSample: number } | null {
    if (buffer.length < 44) return null
    
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    
    // Check for RIFF header
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (riff !== 'RIFF') return null
    
    // Check for WAVE format
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
    if (wave !== 'WAVE') return null
    
    logger.debug('WAV container detected')
    
    try {
      // Find fmt and data chunks
      let offset = 12
      let audioFormat = 0
      let numChannels = 0
      let sampleRate = 8000 // Default fallback
      let bitsPerSample = 16 // Default fallback
      let dataOffset = 0
      let dataSize = 0
      let audioData: Uint8Array | null = null
      
      while (offset < buffer.length - 8) {
        const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
        const chunkSize = view.getUint32(offset + 4, true)
        
        if (chunkId === 'fmt ') {
          // Read format information
          audioFormat = view.getUint16(offset + 8, true)
          numChannels = view.getUint16(offset + 10, true)
          sampleRate = view.getUint32(offset + 12, true)
          bitsPerSample = view.getUint16(offset + 22, true)
          
          logger.debug('WAV format chunk found', {
            audioFormat,
            formatName: audioFormat === 1 ? 'PCM' : audioFormat === 7 ? 'μ-law' : 'Unknown',
            numChannels,
            sampleRate,
            bitsPerSample,
            chunkSize
          })
        } else if (chunkId === 'data') {
          // Found data chunk
          dataOffset = offset + 8
          dataSize = chunkSize
          const dataEnd = Math.min(dataOffset + chunkSize, buffer.length)
          audioData = buffer.slice(dataOffset, dataEnd)
          
          logger.debug('WAV data chunk found', {
            dataOffset,
            dataSize,
            audioDataLength: audioData.length,
            firstBytes: toHexString(audioData, 16)
          })
        }
        
        offset += 8 + chunkSize
        // Ensure even offset (WAV chunks are word-aligned)
        if (offset % 2 !== 0) offset++
      }
      
      if (audioData) {
        return {
          audioData,
          dataOffset,
          dataSize,
          format: audioFormat,
          sampleRate,
          bitsPerSample
        }
      }
      
    } catch (error) {
      logger.warn('Error parsing WAV header', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
    
    return null
  }
  
  private async speakResponseFallback(text: string): Promise<void> {
    try {
      const fallbackFormat = this.outboundCodec === AudioCodec.PCM16 ? 'pcm_16000' : 'pcm_8000'
      logger.warn('Attempting ElevenLabs fallback format', {
        fallbackFormat,
        voiceId: this.voiceId
      })
      
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.azureTtsKey  // FIXED: Use xi-api-key header as required by ElevenLabs
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: fallbackFormat
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error('ElevenLabs fallback failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        throw new Error(`ElevenLabs fallback failed: ${response.status} - ${errorText}`)
      }
      
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          totalBytes += value.length
        }
      }
      
      const fullBuffer = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset)
        offset += chunk.length
      }
      
      // Process fallback based on codec
      const wavInfo = this.parseWavHeader(fullBuffer)
      const audioData = wavInfo ? wavInfo.audioData : fullBuffer
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        // Handle PCM fallback for PCM16 codec
        if (fallbackFormat === 'pcm_16000') {
          // Downsample from 16kHz to 8kHz
          const view = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength)
          const downsampled = new Uint8Array((audioData.length / 4) * 2)
          const outView = new DataView(downsampled.buffer)
          let outIndex = 0
          
          for (let i = 0; i < audioData.length - 3; i += 4) {
            // Take every other sample (16kHz to 8kHz)
            const sample = view.getInt16(i, true)
            outView.setInt16(outIndex, sample, true)
            outIndex += 2
          }
          
          // Send PCM16 frames
          for (let i = 0; i < downsampled.length; i += this.outboundFrameSize) {
            const frame = new Uint8Array(this.outboundFrameSize)
            const remaining = Math.min(this.outboundFrameSize, downsampled.length - i)
            frame.set(downsampled.slice(i, i + remaining))
            await this.sendOutboundFrame(frame)
          }
        } else {
          // Already 8kHz, send directly
          for (let i = 0; i < audioData.length; i += this.outboundFrameSize) {
            const frame = new Uint8Array(this.outboundFrameSize)
            const remaining = Math.min(this.outboundFrameSize, audioData.length - i)
            frame.set(audioData.slice(i, i + remaining))
            await this.sendOutboundFrame(frame)
          }
        }
      } else {
        // Convert PCM to μ-law for μ-law codec
        const view = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength)
        const mulawBuffer: number[] = []
        
        for (let i = 0; i < audioData.length - 1; i += 2) {
          const pcmSample = view.getInt16(i, true)
          mulawBuffer.push(pcmToMulaw(pcmSample))
        }
        
        // Send μ-law frames
        while (mulawBuffer.length >= this.outboundFrameSize) {
          const frame = new Uint8Array(this.outboundFrameSize)
          for (let i = 0; i < this.outboundFrameSize; i++) {
            frame[i] = mulawBuffer.shift()!
          }
          await this.sendOutboundFrame(frame)
        }
        
        // Send remaining with padding
        if (mulawBuffer.length > 0) {
          const frame = new Uint8Array(this.outboundFrameSize)
          for (let i = 0; i < mulawBuffer.length; i++) {
            frame[i] = mulawBuffer[i]
          }
          frame.fill(0xFF, mulawBuffer.length)
          await this.sendOutboundFrame(frame)
        }
      }
      
      logger.info('ElevenLabs fallback complete')
      
    } catch (fallbackError) {
      logger.error('Both ElevenLabs attempts failed', {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        stack: fallbackError instanceof Error ? fallbackError.stack : undefined
      })
    } finally {
      this.turnState = TurnState.LISTENING
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
    
    // If Azure TTS is still streaming, defer the actual cleanup
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
      avgFramesPerSecond: this.totalFramesReceived / ((Date.now() - this.sessionStartTime) / 1000)
    })
  }

  private async sendSimpleTestTone(): Promise<void> {
    logger.debug('Sending 440Hz test tone', {
      codec: this.outboundCodec,
      frameSize: this.outboundFrameSize,
      frequency: 440,
      durationMs: 500
    })
    
    // Generate 0.5 seconds of 440Hz tone
    const numFrames = 25
    const samplesPerFrame = this.outboundCodec === AudioCodec.PCM16 ? 160 : 160 // 160 samples at 8kHz
    
    for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
      const frame = new Uint8Array(this.outboundFrameSize)
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        // Generate PCM16 directly
        const view = new DataView(frame.buffer)
        for (let i = 0; i < samplesPerFrame; i++) {
          const time = (frameIndex * samplesPerFrame + i) / 8000
          const amplitude = Math.sin(2 * Math.PI * 440 * time)
          const pcm16 = Math.floor(amplitude * 16384)
          // Write as little-endian 16-bit signed integer
          view.setInt16(i * 2, pcm16, true)
        }
      } else {
        // Generate μ-law
        for (let i = 0; i < samplesPerFrame; i++) {
          const time = (frameIndex * samplesPerFrame + i) / 8000
          const amplitude = Math.sin(2 * Math.PI * 440 * time)
          const pcm16 = Math.floor(amplitude * 16384)
          frame[i] = pcmToMulaw(pcm16)
        }
      }
      
      await this.sendDirectFrame(frame)
    }
    logger.debug('Test tone transmission complete', {
      framesSent: numFrames
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
    // Guard against sending after close or without streamSid
    // Allow sending if ElevenLabs is still streaming, even if cleanup is pending
    if (!this.streamSid || (this.isClosed && !this.isAzureTtsStreaming) || this.ws.readyState !== 1) {
      logger.debug('Skipping direct frame send', {
        hasStreamSid: !!this.streamSid,
        isClosed: this.isClosed,
        wsReadyState: this.ws.readyState,
        isElevenLabsStreaming: this.isAzureTtsStreaming,
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
  
  private async sendOutboundFrame(frame: Uint8Array): Promise<void> {
    // Guard against sending after close or without streamSid
    // Allow sending if ElevenLabs is still streaming, even if cleanup is pending
    if (!this.streamSid || (this.isClosed && !this.isAzureTtsStreaming) || this.ws.readyState !== 1) {
      logger.debug('Skipping frame send', {
        hasStreamSid: !!this.streamSid,
        isClosed: this.isClosed,
        wsReadyState: this.ws.readyState,
        isElevenLabsStreaming: this.isAzureTtsStreaming,
        pendingCleanup: this.pendingCleanup
      })
      return
    }
    
    try {
      const payload = safeBase64Encode(frame)
      
      // Log first few frames for debugging
      if (this.outboundSeq < 3) {
        logger.debug('Sending initial frame (legacy method - prefer sendOutboundFrameDirect)', {
          frameNumber: this.outboundSeq,
          frameSize: frame.length,
          codec: this.outboundCodec,
          hexDump: toHexString(frame, 32),
          payloadLength: payload.length
        })
      }
      
      // PRODUCTION FIX: Use exact Twilio media format for bidirectional streams
      // CRITICAL FIX: Bidirectional streams do NOT use track field
      const message = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: payload   // Base64 encoded μ-law audio
        }
      }
      
      this.ws.send(JSON.stringify(message))
      this.outboundSeq++
      this.totalFramesSent++
      
      // Send immediately - audio timing is handled by the sender
      
    } catch (error) {
      logger.error('Failed to send outbound frame', {
        error: error instanceof Error ? error.message : String(error),
        frameNumber: this.outboundSeq,
        streamSid: this.streamSid
      })
    }
  }
  
  private async sendDirectFrame(frame: Uint8Array): Promise<void> {
    // Convert frame to base64 and send using the direct method
    const base64Frame = safeBase64Encode(frame)
    await this.sendOutboundFrameDirect(base64Frame)
  }



  private async sendTestPattern(): Promise<void> {
    logger.debug('Sending diagnostic audio patterns', {
      codec: this.outboundCodec,
      frameSize: this.outboundFrameSize
    })
    const samplesPerFrame = 160 // Always 160 samples at 8kHz
    
    // Pattern 1: Pure silence (1 second)
    logger.debug('TEST Pattern 1: Silence frames')
    for (let i = 0; i < 50; i++) {
      const frame = new Uint8Array(this.outboundFrameSize)
      if (this.outboundCodec === AudioCodec.PCM16) {
        // PCM16 silence is all zeros (already initialized)
      } else {
        frame.fill(0xFF) // μ-law silence
      }
      await this.sendDirectFrame(frame)
    }
    
    // Pattern 2: Simple 440Hz tone (A note)
    logger.debug('TEST Pattern 2: 440Hz tone')
    for (let frameIndex = 0; frameIndex < 50; frameIndex++) {
      const frame = new Uint8Array(this.outboundFrameSize)
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        const view = new DataView(frame.buffer)
        for (let i = 0; i < samplesPerFrame; i++) {
          const time = (frameIndex * samplesPerFrame + i) / 8000
          const amplitude = Math.sin(2 * Math.PI * 440 * time)
          const pcm16 = Math.floor(amplitude * 16384)
          view.setInt16(i * 2, pcm16, true)
        }
      } else {
        for (let i = 0; i < samplesPerFrame; i++) {
          const time = (frameIndex * samplesPerFrame + i) / 8000
          const amplitude = Math.sin(2 * Math.PI * 440 * time)
          const pcm16 = Math.floor(amplitude * 16384)
          frame[i] = pcmToMulaw(pcm16)
        }
      }
      
      await this.sendDirectFrame(frame)
    }
    
    // Pattern 3: Square wave
    logger.debug('TEST Pattern 3: Square wave')
    for (let frameIndex = 0; frameIndex < 50; frameIndex++) {
      const frame = new Uint8Array(this.outboundFrameSize)
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        const view = new DataView(frame.buffer)
        for (let i = 0; i < samplesPerFrame; i++) {
          const sampleIndex = frameIndex * samplesPerFrame + i
          const squareValue = ((sampleIndex / 20) % 2) < 1 ? 16384 : -16384
          view.setInt16(i * 2, squareValue, true)
        }
      } else {
        for (let i = 0; i < samplesPerFrame; i++) {
          const sampleIndex = frameIndex * samplesPerFrame + i
          const squareValue = ((sampleIndex / 20) % 2) < 1 ? 16384 : -16384
          frame[i] = pcmToMulaw(squareValue)
        }
      }
      
      await this.sendDirectFrame(frame)
    }
    
    logger.debug('All test patterns sent successfully')
  }

  private async sendTestTone(): Promise<void> {
    logger.info('Sending test tone to verify audio pipeline', {
      codec: this.outboundCodec,
      frameSize: this.outboundFrameSize,
      sampleRate: SAMPLE_RATE
    })
    
    // Generate 400Hz tone at 8kHz for 1 second
    const sampleRate = 8000
    const frequency = 400
    const duration = 1 // seconds
    const totalSamples = sampleRate * duration
    const samplesPerFrame = this.outboundCodec === AudioCodec.PCM16 ? 160 : 160
    const totalFrames = Math.ceil(totalSamples / samplesPerFrame)
    
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const frame = new Uint8Array(this.outboundFrameSize)
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        // Generate PCM16 directly
        const view = new DataView(frame.buffer)
        for (let i = 0; i < samplesPerFrame; i++) {
          const sampleIndex = frameIndex * samplesPerFrame + i
          if (sampleIndex < totalSamples) {
            const time = sampleIndex / sampleRate
            const amplitude = Math.sin(2 * Math.PI * frequency * time)
            const pcm16 = Math.floor(amplitude * 32767)
            // Write as little-endian 16-bit signed integer
            view.setInt16(i * 2, pcm16, true)
          } else {
            // PCM16 silence is 0
            view.setInt16(i * 2, 0, true)
          }
        }
      } else {
        // Generate μ-law
        for (let i = 0; i < samplesPerFrame; i++) {
          const sampleIndex = frameIndex * samplesPerFrame + i
          if (sampleIndex < totalSamples) {
            const time = sampleIndex / sampleRate
            const amplitude = Math.sin(2 * Math.PI * frequency * time)
            const pcm16 = Math.floor(amplitude * 32767)
            frame[i] = pcmToMulaw(pcm16)
          } else {
            frame[i] = 0xFF // μ-law silence
          }
        }
      }
      
      await this.sendDirectFrame(frame)
    }
    
    logger.debug('Test tone generation complete', {
      totalFramesSent: totalFrames
    })
  }
  
  // Removed duplicate pcmToMulaw - using standard G.711 function
  
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
      // Use custom greeting or default
      const greetingText = this.greeting || `Hello! Thank you for calling ${this.businessName}. How can I help you today?`
      await this.speakResponseFixed(greetingText)
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
      version: '2024-12-20-production',
      features: [
        'No authentication required',
        'Azure TTS REST streaming',
        'μ-law 8kHz native support',
        'Barge-in detection',
        'VAD with 500ms silence detection',
        'Simple header authentication'
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
    authRequired: false // PRODUCTION FIX: No auth needed
  })
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  socket.onopen = () => {
    logger.info('WebSocket connection established')
    // Initialize AI session
    new AIVoiceSession(socket, { tenantId, businessName, voiceId, greeting })
  }
  
  return response
})