/*
 * AI Voice Receptionist - Production-Ready Pipeline
 * Architecture: Twilio WebSocket → Audio Processing → STT → Dialogue → TTS → Response
 * Optimized for <300ms response latency with proper audio streaming
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

// Voice Activity Detection settings - tightened thresholds for better responsiveness
const VAD_SILENCE_THRESHOLD = 700
const VAD_MIN_SPEECH_MS = 300
const VAD_END_SILENCE_MS = 500  // Reduced from 600ms to 500ms for faster response

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

// ========== AUDIO PROCESSING ==========

// Helper function to convert binary data to hex string for debugging
function toHexString(buffer: Uint8Array, maxBytes: number = 16): string {
  const bytes = Math.min(buffer.length, maxBytes)
  const hex = Array.from(buffer.slice(0, bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')
  return `${hex}${buffer.length > maxBytes ? '...' : ''} (${buffer.length} bytes total)`
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
  private elevenLabsKey: string
  
  // Conversation state
  private conversationHistory: Array<{ role: string; content: string }> = []
  private hasGreeted = false
  private isReady = false
  
  // Track if session is closed
  private isClosed = false
  
  // Codec negotiation
  private outboundCodec: AudioCodec = AudioCodec.MULAW
  private outboundFrameSize: number = FRAME_SIZE_MULAW
  
  // Barge-in detection state
  private bargeInBuffer: Uint8Array[] = []
  private currentTTSAbortController: AbortController | null = null
  private lastBargeInTime = 0
  
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
    this.elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY') || ''
    
    logger.info('AIVoiceSession initialized', {
      tenantId: this.tenantId,
      businessName: this.businessName,
      voiceId: this.voiceId,
      greetingLength: this.greeting?.length || 0,
      hasOpenAIKey: !!this.openaiKey,
      hasElevenLabsKey: !!this.elevenLabsKey
    })
    
    this.setupEventListeners()
    // Don't start greeting here - wait for 'start' event
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
    
    // Decode base64 μ-law audio
    const audioData = Uint8Array.from(atob(media.payload), c => c.charCodeAt(0))
    const rms = calculateRMS([audioData])
    
    // Handle different states
    if (this.turnState === TurnState.LISTENING) {
      await this.handleListeningState(audioData, rms)
    } else if (this.turnState === TurnState.SPEAKING) {
      await this.handleSpeakingState(audioData, rms)
    }
    // THINKING state: ignore audio frames while processing
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
    
    // Check for end of speech
    if (this.audioBuffer.length >= 10 && !this.isProcessing) { // At least 200ms
      const recentFrames = this.audioBuffer.slice(-30) // Last 600ms
      const recentRMS = calculateRMS(recentFrames)
      
      if (recentRMS < VAD_SILENCE_THRESHOLD) {
        const silenceDuration = Date.now() - this.lastActivityTime
        if (silenceDuration > VAD_END_SILENCE_MS && this.audioBuffer.length > 15) {
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
    
    this.isProcessing = true
    this.turnState = TurnState.THINKING
    
    try {
      logger.info('Processing user speech', {
        bufferLength: this.audioBuffer.length,
        durationMs: this.audioBuffer.length * FRAME_DURATION_MS
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
      
      if (transcript.trim()) {
        logger.info('Transcription completed', {
          transcript,
          transcriptLength: transcript.length
        })
        
        // Generate AI response
        const response = await this.generateResponse(transcript)
        
        // Convert to speech and stream back
        await this.speakResponse(response)
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
    // Get business-specific system prompt
    let systemPrompt = `You are a professional AI receptionist for ${this.businessName}. Be helpful, friendly, and efficient. Answer questions about the business and help customers with their needs.`
    
    if (this.tenantId && supabase) {
      try {
        const { data: agent } = await supabase
          .from('ai_agents')
          .select('system_prompt')
          .eq('tenant_id', this.tenantId)
          .maybeSingle()
        
        if (agent?.system_prompt) {
          systemPrompt = agent.system_prompt
        }
      } catch (error) {
        logger.warn('Failed to fetch agent prompt from database', {
          error: error instanceof Error ? error.message : String(error),
          tenantId: this.tenantId
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
      logger.info('Starting ElevenLabs TTS', {
        textLength: text.length,
        voiceId: this.voiceId,
        codec: this.outboundCodec,
        frameSize: this.outboundFrameSize
      })
      
      // Determine optimal ElevenLabs format based on outbound codec
      const outputFormat = this.outboundCodec === AudioCodec.MULAW ? 'ulaw_8000' : 'pcm_16000'
      
      logger.debug('ElevenLabs request configuration', {
        outputFormat,
        model: 'eleven_turbo_v2',
        streamingEnabled: true
      })
      
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.elevenLabsKey
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
          output_format: outputFormat
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        logger.error('ElevenLabs API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`)
      }
      
      logger.debug('ElevenLabs response received, starting stream processing')
      
      if (!response.body) {
        throw new Error('No response body from ElevenLabs')
      }
      
      const reader = response.body.getReader()
      let audioBuffer = new Uint8Array(0)
      let headerSkipped = false
      let totalBytesProcessed = 0
      let framesStreamed = 0
      
      try {
        while (true) {
          // Check for abort signal before each iteration
          if (abortSignal.aborted) {
            logger.info('TTS streaming aborted due to barge-in')
            throw new Error('TTS_ABORTED')
          }
          
          const { done, value } = await reader.read()
          
          if (done) {
            logger.debug('ElevenLabs stream complete', {
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
            
            // Skip WAV header if present (first time only)
            if (!headerSkipped) {
              const wavInfo = this.parseWavHeader(audioBuffer)
              if (wavInfo) {
                logger.debug('WAV header detected and skipped', {
                  headerSize: wavInfo.dataOffset,
                  expectedDataSize: wavInfo.dataSize,
                  sampleRate: wavInfo.sampleRate,
                  bitsPerSample: wavInfo.bitsPerSample
                })
                audioBuffer = wavInfo.audioData
              }
              headerSkipped = true
            }
            
            // Process audio in frame-sized chunks
            let processedBytes = 0
            
            if (outputFormat === 'ulaw_8000') {
              // Direct μ-law streaming - optimal for μ-law codec
              while (audioBuffer.length - processedBytes >= this.outboundFrameSize) {
                // Check for abort before each frame
                if (abortSignal.aborted) {
                  logger.info('TTS frame processing aborted during μ-law streaming')
                  throw new Error('TTS_ABORTED')
                }
                
                const frame = audioBuffer.slice(processedBytes, processedBytes + this.outboundFrameSize)
                await this.sendOutboundFrame(frame)
                processedBytes += this.outboundFrameSize
                framesStreamed++
                totalBytesProcessed += this.outboundFrameSize
              }
            } else {
              // PCM16 format - convert if needed
              const bytesPerSample = 2
              const samplesPerFrame = 160
              const frameSize = samplesPerFrame * bytesPerSample
              
              while (audioBuffer.length - processedBytes >= frameSize) {
                // Check for abort before each frame
                if (abortSignal.aborted) {
                  logger.info('TTS frame processing aborted during PCM16 streaming')
                  throw new Error('TTS_ABORTED')
                }
                
                const pcmFrame = audioBuffer.slice(processedBytes, processedBytes + frameSize)
                
                if (this.outboundCodec === AudioCodec.MULAW) {
                  // Convert PCM16 to μ-law
                  const mulawFrame = new Uint8Array(this.outboundFrameSize)
                  const view = new DataView(pcmFrame.buffer, pcmFrame.byteOffset, pcmFrame.byteLength)
                  
                  for (let i = 0; i < samplesPerFrame; i++) {
                    const pcmSample = view.getInt16(i * 2, true)
                    mulawFrame[i] = pcmToMulaw(pcmSample)
                  }
                  
                  await this.sendOutboundFrame(mulawFrame)
                } else {
                  // Direct PCM16 streaming
                  await this.sendOutboundFrame(pcmFrame)
                }
                
                processedBytes += frameSize
                framesStreamed++
                totalBytesProcessed += frameSize
              }
            }
            
            // Keep remaining unprocessed bytes for next iteration
            if (processedBytes > 0) {
              audioBuffer = audioBuffer.slice(processedBytes)
            }
          }
        }
        
        // Process any remaining audio data
        if (audioBuffer.length > 0) {
          logger.debug('Processing final audio chunk', {
            remainingBytes: audioBuffer.length,
            frameSize: this.outboundFrameSize
          })
          
          if (outputFormat === 'ulaw_8000') {
            // Pad the final frame if needed
            if (audioBuffer.length < this.outboundFrameSize) {
              const paddedFrame = new Uint8Array(this.outboundFrameSize)
              paddedFrame.set(audioBuffer)
              paddedFrame.fill(0xFF, audioBuffer.length) // μ-law silence padding
              await this.sendOutboundFrame(paddedFrame)
            } else {
              await this.sendOutboundFrame(audioBuffer.slice(0, this.outboundFrameSize))
            }
          } else {
            // Handle PCM16 final chunk
            const bytesPerSample = 2
            const samplesInChunk = Math.floor(audioBuffer.length / bytesPerSample)
            
            if (samplesInChunk > 0) {
              if (this.outboundCodec === AudioCodec.MULAW) {
                const mulawFrame = new Uint8Array(this.outboundFrameSize)
                const view = new DataView(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength)
                
                for (let i = 0; i < Math.min(samplesInChunk, 160); i++) {
                  const pcmSample = view.getInt16(i * 2, true)
                  mulawFrame[i] = pcmToMulaw(pcmSample)
                }
                
                // Fill remaining with silence
                mulawFrame.fill(0xFF, samplesInChunk)
                await this.sendOutboundFrame(mulawFrame)
              } else {
                const paddedFrame = new Uint8Array(this.outboundFrameSize)
                paddedFrame.set(audioBuffer.slice(0, Math.min(audioBuffer.length, this.outboundFrameSize)))
                await this.sendOutboundFrame(paddedFrame)
              }
            }
          }
          
          framesStreamed++
        }
        
        logger.info('ElevenLabs TTS streaming complete', {
          totalBytesProcessed,
          framesStreamed,
          outputFormat,
          streamingMode: 'real-time'
        })
        
      } finally {
        reader.releaseLock()
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage === 'TTS_ABORTED') {
        logger.info('ElevenLabs TTS streaming was aborted due to barge-in - no fallback needed')
        return // Don't attempt fallback for intentional abort
      }
      
      logger.error('ElevenLabs TTS streaming failed, attempting fallback', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Fallback to the buffered approach
      await this.speakResponseFallback(text)
    } finally {
      // Clean up abort controller after TTS completes or is aborted
      this.currentTTSAbortController = null
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
          'xi-api-key': this.elevenLabsKey
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
    logger.info('Cleaning up session', {
      hasGreeted: this.hasGreeted,
      conversationLength: this.conversationHistory.length,
      isReady: this.isReady
    })
    this.isClosed = true
    this.audioBuffer = []
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
    
    for (let i = 0; i < 10; i++) {
      await this.sendOutboundFrame(silenceFrame)
    }
    logger.debug('Buffer warmup complete', {
      framesSent: 10
    })
  }
  
  private async sendOutboundFrame(frame: Uint8Array): Promise<void> {
    // Guard against sending after close or without streamSid
    if (!this.streamSid || this.isClosed || this.ws.readyState !== 1) {
      logger.debug('Skipping frame send', {
        hasStreamSid: !!this.streamSid,
        isClosed: this.isClosed,
        wsReadyState: this.ws.readyState
      })
      return
    }
    
    const payload = btoa(String.fromCharCode(...frame))
    
    // Log first few frames for debugging
    if (this.outboundSeq < 3) {
      logger.debug('Sending initial frame', {
        frameNumber: this.outboundSeq,
        frameSize: frame.length,
        codec: this.outboundCodec,
        hexDump: toHexString(frame, 32),
        payloadLength: payload.length
      })
    }
    
    // CRITICAL FIX: Only send required fields for outbound media
    // DO NOT include timestamp or sequenceNumber - they're only for inbound messages!
    const message = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        track: 'outbound', // Required for outbound audio
        payload: payload    // The audio data - ONLY these 2 fields allowed
      }
    }
    
    this.ws.send(JSON.stringify(message))
    this.outboundSeq++ // Keep for internal tracking only
    
    // Pace frames at 20ms intervals to match 8kHz audio rate
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  
  private async sendDirectFrame(frame: Uint8Array): Promise<void> {
    // Wrapper for compatibility - uses new sendOutboundFrame
    await this.sendOutboundFrame(frame)
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
    
    // Use the fixed speech method with WAV parsing
    const greetingText = this.greeting || `Hello! Thank you for calling ${this.businessName}. How can I help you today?`
    await this.speakResponseFixed(greetingText)
  }
}

// ========== MAIN WEBSOCKET HANDLER ==========

serve(async (req) => {
  // Health check endpoint
  const url = new URL(req.url)
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      version: '2024-09-20-v2',
      timestamp: new Date().toISOString()
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
  
  // Handle WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }
  
  // Extract context from URL parameters
  const tenantId = url.searchParams.get('tenantId') || ''
  const businessName = url.searchParams.get('businessName') || 'this business'
  const voiceId = url.searchParams.get('voiceId') || 'Xb7hH8MSUJpSbSDYk0k2'
  const greeting = url.searchParams.get('greeting') || ''
  
  logger.info('Starting AI Voice Session', {
    tenantId,
    businessName,
    voiceId,
    greetingProvided: !!greeting
  })
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  socket.onopen = () => {
    logger.info('WebSocket connection established')
    // Initialize AI session
    new AIVoiceSession(socket, { tenantId, businessName, voiceId, greeting })
  }
  
  return response
})