/*
 * AI Voice Receptionist - Production-Ready Pipeline
 * Architecture: Twilio WebSocket → Audio Processing → STT → Dialogue → TTS → Response
 * Optimized for <300ms response latency with proper audio streaming
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

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

// Voice Activity Detection settings
const VAD_SILENCE_THRESHOLD = 700
const VAD_MIN_SPEECH_MS = 300
const VAD_END_SILENCE_MS = 600

// Turn management states
enum TurnState {
  LISTENING = 'LISTENING',
  THINKING = 'THINKING', 
  SPEAKING = 'SPEAKING'
}

// ========== AUDIO PROCESSING ==========

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
    
    this.setupEventListeners()
    // Don't start greeting here - wait for 'start' event
  }
  
  private setupEventListeners(): void {
    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        await this.handleTwilioMessage(message)
      } catch (error) {
        console.error('[AIVoiceSession] Error processing message:', error)
      }
    }
    
    this.ws.onclose = () => {
      console.log('[AIVoiceSession] WebSocket closed')
      this.cleanup()
    }
    
    this.ws.onerror = (error) => {
      console.error('[AIVoiceSession] WebSocket error:', error)
    }
  }
  
  private async handleTwilioMessage(message: any): Promise<void> {
    switch (message.event) {
      case 'connected':
        console.log('[AIVoiceSession] Connected to Twilio - waiting for start event')
        // DO NOT trigger greeting here - wait for streamSid
        break
        
      case 'start':
        console.log('[AIVoiceSession] Call started - streamSid:', message.start?.streamSid)
        console.log('[AIVoiceSession] Full start event:', JSON.stringify(message.start, null, 2))
        
        // Capture streamSid from start event
        if (message.start?.streamSid) {
          this.streamSid = message.start.streamSid
          console.log('[AIVoiceSession] StreamSid captured:', this.streamSid)
        }
        
        // CRITICAL: Detect negotiated codec from mediaFormat
        if (message.start?.mediaFormat) {
          const mediaFormat = message.start.mediaFormat
          console.log('[AIVoiceSession] Media format negotiated:', JSON.stringify(mediaFormat))
          
          // Check the encoding field
          if (mediaFormat.encoding) {
            const encoding = mediaFormat.encoding.toLowerCase()
            console.log('[AIVoiceSession] Detected encoding:', encoding)
            
            if (encoding.includes('pcm') || encoding.includes('l16')) {
              // PCM16 format detected
              this.outboundCodec = AudioCodec.PCM16
              this.outboundFrameSize = FRAME_SIZE_PCM16
              console.log('[AIVoiceSession] ✅ Codec set to PCM16, frame size:', this.outboundFrameSize)
            } else if (encoding.includes('mulaw') || encoding.includes('ulaw') || encoding.includes('g711')) {
              // μ-law format detected
              this.outboundCodec = AudioCodec.MULAW
              this.outboundFrameSize = FRAME_SIZE_MULAW
              console.log('[AIVoiceSession] ✅ Codec set to μ-law, frame size:', this.outboundFrameSize)
            } else {
              // Default to μ-law for unknown formats
              console.log(`[AIVoiceSession] Unknown encoding '${encoding}', defaulting to μ-law`)
              this.outboundCodec = AudioCodec.MULAW
              this.outboundFrameSize = FRAME_SIZE_MULAW
            }
          } else {
            // No encoding specified, default to μ-law
            console.log('[AIVoiceSession] No encoding specified, defaulting to μ-law')
            this.outboundCodec = AudioCodec.MULAW
            this.outboundFrameSize = FRAME_SIZE_MULAW
          }
        } else {
          // No mediaFormat, default to μ-law for backward compatibility
          console.log('[AIVoiceSession] No mediaFormat in start event, defaulting to μ-law')
          this.outboundCodec = AudioCodec.MULAW
          this.outboundFrameSize = FRAME_SIZE_MULAW
        }
        
        console.log('[AIVoiceSession] Final codec configuration:', {
          codec: this.outboundCodec,
          frameSize: this.outboundFrameSize
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
        if (this.turnState === TurnState.LISTENING) {
          await this.processAudioFrame(message.media)
        }
        break
        
      case 'stop':
        console.log('[AIVoiceSession] Call ended')
        this.cleanup()
        break
    }
  }
  
  private async processAudioFrame(media: any): Promise<void> {
    if (!media.payload) return
    
    // Decode base64 μ-law audio
    const audioData = Uint8Array.from(atob(media.payload), c => c.charCodeAt(0))
    this.audioBuffer.push(audioData)
    
    // VAD: Only update lastActivityTime on voiced frames (not silence)
    const rms = calculateRMS([audioData])
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
      const rms = calculateRMS(recentFrames)
      
      if (rms < VAD_SILENCE_THRESHOLD) {
        const silenceDuration = Date.now() - this.lastActivityTime
        if (silenceDuration > VAD_END_SILENCE_MS && this.audioBuffer.length > 15) {
          await this.processUserSpeech()
        }
      }
    }
  }
  
  private async processUserSpeech(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return
    
    this.isProcessing = true
    this.turnState = TurnState.THINKING
    
    try {
      console.log('[AIVoiceSession] Processing speech...')
      
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
        console.log('[AIVoiceSession] User said:', transcript)
        
        // Generate AI response
        const response = await this.generateResponse(transcript)
        
        // Convert to speech and stream back
        await this.speakResponse(response)
      }
      
    } catch (error) {
      console.error('[AIVoiceSession] Error processing speech:', error)
    } finally {
      this.audioBuffer = []
      this.isProcessing = false
      this.turnState = TurnState.LISTENING
    }
  }
  
  private async transcribeAudio(wavData: Uint8Array): Promise<string> {
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
      throw new Error(`Whisper API error: ${response.status}`)
    }
    
    const result = await response.json()
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
        console.warn('[AIVoiceSession] Failed to fetch agent prompt:', error)
      }
    }
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userText })
    
    // Keep conversation manageable
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20)
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...this.conversationHistory
        ],
        max_tokens: 150,
        temperature: 0.7
      })
    })
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }
    
    const result = await response.json()
    const aiResponse = result.choices[0]?.message?.content || "I'm sorry, I didn't catch that. Could you please repeat?"
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'assistant', content: aiResponse })
    
    return aiResponse
  }
  
  private async speakResponse(text: string): Promise<void> {
    // Use the fixed version with WAV parsing
    await this.speakResponseFixed(text)
  }
  
  // Stop and clean up
  private cleanup(): void {
    console.log('[AIVoiceSession] Cleaning up session')
    this.isClosed = true
    this.audioBuffer = []
  }
  

  private async sendSimpleTestTone(): Promise<void> {
    console.log('[TEST] Sending simple 440Hz test tone with codec:', this.outboundCodec)
    
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
    console.log('[TEST] Test tone complete')
  }
  
  private async sendBufferWarmup(): Promise<void> {
    console.log('[AIVoiceSession] Sending buffer warmup silence for codec:', this.outboundCodec)
    
    // Send 200ms of silence to prime Twilio's jitter buffer
    let silenceFrame: Uint8Array
    
    if (this.outboundCodec === AudioCodec.PCM16) {
      // PCM16 silence: all zeros
      silenceFrame = new Uint8Array(this.outboundFrameSize).fill(0)
      console.log('[AIVoiceSession] Using PCM16 silence (zeros)')
    } else {
      // μ-law silence: 0xFF
      silenceFrame = new Uint8Array(this.outboundFrameSize).fill(0xFF)
      console.log('[AIVoiceSession] Using μ-law silence (0xFF)')
    }
    
    for (let i = 0; i < 10; i++) {
      await this.sendOutboundFrame(silenceFrame)
    }
    console.log('[AIVoiceSession] Buffer warmup complete')
  }
  
  private async sendOutboundFrame(frame: Uint8Array): Promise<void> {
    // Guard against sending after close or without streamSid
    if (!this.streamSid || this.isClosed || this.ws.readyState !== 1) return
    
    const payload = btoa(String.fromCharCode(...frame))
    
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

  private parseWavHeader(buffer: Uint8Array): { audioData: Uint8Array; format: number; sampleRate: number; bitsPerSample: number } | null {
    // Check if this is a WAV file (starts with 'RIFF' and contains 'WAVE')
    if (buffer.length < 44) return null
    
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    
    // Check RIFF header
    const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3])
    if (riff !== 'RIFF') return null
    
    // Check WAVE format
    const wave = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11])
    if (wave !== 'WAVE') return null
    
    console.log('[WAV Parser] Detected WAV container')
    
    // Find fmt chunk
    let offset = 12
    let audioFormat = 0
    let numChannels = 0
    let sampleRate = 0
    let bitsPerSample = 0
    
    while (offset < buffer.length - 8) {
      const chunkId = String.fromCharCode(buffer[offset], buffer[offset+1], buffer[offset+2], buffer[offset+3])
      const chunkSize = view.getUint32(offset + 4, true)
      
      if (chunkId === 'fmt ') {
        audioFormat = view.getUint16(offset + 8, true)
        numChannels = view.getUint16(offset + 10, true)
        sampleRate = view.getUint32(offset + 12, true)
        bitsPerSample = view.getUint16(offset + 22, true)
        
        console.log(`[WAV Parser] Format: ${audioFormat} (1=PCM, 7=μ-law), Channels: ${numChannels}, SampleRate: ${sampleRate}, Bits: ${bitsPerSample}`)
      } else if (chunkId === 'data') {
        // Found the data chunk - this contains the actual audio
        const dataStart = offset + 8
        const dataEnd = Math.min(dataStart + chunkSize, buffer.length)
        const audioData = buffer.slice(dataStart, dataEnd)
        
        console.log(`[WAV Parser] Found data chunk: ${audioData.length} bytes`)
        return { audioData, format: audioFormat, sampleRate, bitsPerSample }
      }
      
      offset += 8 + chunkSize
      // Ensure even offset (WAV chunks are word-aligned)
      if (offset % 2 !== 0) offset++
    }
    
    return null
  }

  private async speakResponseFixed(text: string): Promise<void> {
    this.turnState = TurnState.SPEAKING
    
    try {
      // Choose output format based on negotiated codec
      let outputFormat: string
      let expectedSampleRate: number
      
      if (this.outboundCodec === AudioCodec.PCM16) {
        // For PCM16 output, request raw PCM from ElevenLabs
        outputFormat = 'pcm_8000'  // Request 8kHz PCM to match Twilio
        expectedSampleRate = 8000
        console.log('[ElevenLabs] ✅ Codec is PCM16, requesting pcm_8000 from ElevenLabs')
      } else {
        // For μ-law output, request μ-law directly
        outputFormat = 'ulaw_8000'
        expectedSampleRate = 8000
        console.log('[ElevenLabs] ✅ Codec is μ-law, requesting ulaw_8000 from ElevenLabs')
      }
      
      console.log(`[ElevenLabs] Requesting ${outputFormat} format for: ${text.substring(0, 50)}...`)
      
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
          output_format: outputFormat  // Use codec-specific format
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`)
      }
      
      if (!response.body) {
        throw new Error('No audio response from ElevenLabs')
      }
      
      // Log response metadata
      const contentType = response.headers.get('content-type')
      console.log('[ElevenLabs] Response content-type:', contentType)
      
      // Collect the entire response first to check format
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.length > 0) {
            chunks.push(value)
            totalBytes += value.length
          }
        }
      } finally {
        reader.releaseLock()
      }
      
      console.log(`[ElevenLabs] Received total ${totalBytes} bytes`)
      
      // Combine all chunks
      const fullBuffer = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset)
        offset += chunk.length
      }
      
      // Log first 16 bytes for format identification
      if (fullBuffer.length >= 16) {
        const header = Array.from(fullBuffer.slice(0, 16))
        const headerHex = header.map(b => b.toString(16).padStart(2, '0')).join(' ')
        const headerAscii = header.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('')
        console.log(`[ElevenLabs] First 16 bytes (hex): ${headerHex}`)
        console.log(`[ElevenLabs] First 16 bytes (ascii): ${headerAscii}`)
      }
      
      let totalFramesSent = 0
      
      // Check if response is WAV container or raw audio
      const wavInfo = this.parseWavHeader(fullBuffer)
      let audioData: Uint8Array
      
      if (wavInfo) {
        console.log('[ElevenLabs] Detected WAV container, extracting audio data')
        audioData = wavInfo.audioData
      } else {
        console.log('[ElevenLabs] Raw audio data (no WAV container)')
        audioData = fullBuffer
      }
      
      // Process based on codec
      if (this.outboundCodec === AudioCodec.PCM16) {
        // PCM16 output - send raw PCM directly to Twilio
        console.log('[ElevenLabs] ✅ Processing PCM16 audio for PCM16 output')
        
        // Send PCM16 frames directly
        for (let i = 0; i < audioData.length; i += this.outboundFrameSize) {
          const frame = new Uint8Array(this.outboundFrameSize)
          const remaining = Math.min(this.outboundFrameSize, audioData.length - i)
          frame.set(audioData.slice(i, i + remaining))
          
          // Pad with silence if needed (PCM16 silence is 0)
          if (remaining < this.outboundFrameSize) {
            // Already zero-initialized
          }
          
          await this.sendOutboundFrame(frame)
          totalFramesSent++
        }
      } else {
        // μ-law output - send μ-law directly to Twilio
        console.log('[ElevenLabs] ✅ Processing μ-law audio for μ-law output')
        
        // Send μ-law frames directly
        for (let i = 0; i < audioData.length; i += this.outboundFrameSize) {
          const frame = new Uint8Array(this.outboundFrameSize)
          const remaining = Math.min(this.outboundFrameSize, audioData.length - i)
          frame.set(audioData.slice(i, i + remaining))
          
          // Pad with silence if needed (μ-law silence is 0xFF)
          if (remaining < this.outboundFrameSize) {
            frame.fill(0xFF, remaining)
          }
          
          await this.sendOutboundFrame(frame)
          totalFramesSent++
        }
      }
      
      console.log(`[ElevenLabs] Speech complete. Total frames sent: ${totalFramesSent}`)
      
      // Send mark event to signal end of speech
      if (this.streamSid) {
        this.ws.send(JSON.stringify({ 
          event: 'mark', 
          streamSid: this.streamSid, 
          mark: { name: `speech_end_${this.outboundSeq}` }
        }))
      }
      
    } catch (error) {
      console.error('[AIVoiceSession] Error generating speech:', error)
      
      // Try fallback with alternative format
      try {
        const fallbackFormat = this.outboundCodec === AudioCodec.PCM16 ? 'pcm_16000' : 'pcm_8000'
        console.log(`[ElevenLabs] Fallback: Trying ${fallbackFormat} format`)
        
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
          throw new Error(`ElevenLabs fallback failed: ${response.status}`)
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
        
        console.log('[ElevenLabs] Fallback complete')
        
      } catch (fallbackError) {
        console.error('[AIVoiceSession] Fallback also failed:', fallbackError)
      }
    } finally {
      this.turnState = TurnState.LISTENING
    }
  }

  private async sendTestPattern(): Promise<void> {
    console.log('[TEST] Sending diagnostic audio patterns with codec:', this.outboundCodec)
    const samplesPerFrame = 160 // Always 160 samples at 8kHz
    
    // Pattern 1: Pure silence (1 second)
    console.log('[TEST] Pattern 1: Silence')
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
    console.log('[TEST] Pattern 2: 440Hz tone')
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
    console.log('[TEST] Pattern 3: Square wave')
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
    
    console.log('[TEST] All patterns sent')
  }

  private async sendTestTone(): Promise<void> {
    console.log('[AIVoiceSession] Sending test tone to verify audio pipeline')
    console.log('[AIVoiceSession] Using codec:', this.outboundCodec, 'frame size:', this.outboundFrameSize)
    
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
    
    console.log('[AIVoiceSession] Test tone complete')
  }
  
  // Removed duplicate pcmToMulaw - using standard G.711 function
  
  private async startGreeting(): Promise<void> {
    if (this.hasGreeted || !this.streamSid) return // Only start when streamSid is available
    this.hasGreeted = true
    
    console.log('[AIVoiceSession] Starting greeting with streamSid:', this.streamSid)
    
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
  
  console.log('[WebSocket] Starting AI Voice Session for:', businessName)
  
  const { socket, response } = Deno.upgradeWebSocket(req)
  
  socket.onopen = () => {
    console.log('[WebSocket] Connected')
    // Initialize AI session
    new AIVoiceSession(socket, { tenantId, businessName, voiceId, greeting })
  }
  
  return response
})