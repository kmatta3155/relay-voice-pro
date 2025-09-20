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

// Audio constants for Twilio μ-law format
const FRAME_SIZE = 160 // μ-law bytes per 20ms at 8kHz
const FRAME_DURATION_MS = 20
const SAMPLE_RATE = 8000

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
    }
    
    this.ws.onerror = (error) => {
      console.error('[AIVoiceSession] WebSocket error:', error)
    }
  }
  
  private async handleTwilioMessage(message: any): Promise<void> {
    switch (message.event) {
      case 'connected':
        console.log('[AIVoiceSession] Connected to Twilio')
        // Fallback: if no start event within 1 second, trigger greeting anyway
        setTimeout(() => {
          if (!this.isReady && !this.hasGreeted) {
            console.log('[AIVoiceSession] Starting greeting without start event')
            this.isReady = true
            this.startGreeting()
          }
        }, 1000)
        break
        
      case 'start':
        console.log('[AIVoiceSession] Call started - streamSid:', message.start?.streamSid)
        // Capture streamSid from start event
        if (message.start?.streamSid) {
          this.streamSid = message.start.streamSid
          console.log('[AIVoiceSession] StreamSid captured:', this.streamSid)
        }
        // Extract custom parameters if provided
        if (message.start?.customParameters) {
          const params = message.start.customParameters
          if (params.tenantId) this.tenantId = params.tenantId
          if (params.businessName) this.businessName = params.businessName
          if (params.voiceId) this.voiceId = params.voiceId
          if (params.greeting) this.greeting = params.greeting
        }
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
      
      // Convert μ-law to PCM
      const pcmData = new Int16Array(this.audioBuffer.length * FRAME_SIZE)
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
    this.turnState = TurnState.SPEAKING
    
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.elevenLabsKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: 'ulaw_8000' // Twilio-compatible format
        })
      })
      
      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`)
      }
      
      if (!response.body) {
        throw new Error('No audio response from ElevenLabs')
      }
      
      // Stream audio back to Twilio
      const reader = response.body.getReader()
      const audioBuffer: number[] = [] // Buffer for accumulating audio bytes
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Send any remaining buffered audio
            while (audioBuffer.length >= FRAME_SIZE) {
              const frame = audioBuffer.splice(0, FRAME_SIZE)
              await this.sendAudioFrame(new Uint8Array(frame))
            }
            // Pad and send final frame if needed
            if (audioBuffer.length > 0) {
              const frame = new Uint8Array(FRAME_SIZE)
              frame.set(new Uint8Array(audioBuffer))
              await this.sendAudioFrame(frame)
            }
            break
          }
          
          if (value) {
            // Add incoming audio to buffer
            audioBuffer.push(...Array.from(value))
            
            // Send complete 160-byte frames
            while (audioBuffer.length >= FRAME_SIZE) {
              const frame = audioBuffer.splice(0, FRAME_SIZE)
              await this.sendAudioFrame(new Uint8Array(frame))
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      
    } catch (error) {
      console.error('[AIVoiceSession] Error generating speech:', error)
    } finally {
      this.turnState = TurnState.LISTENING
    }
  }
  
  private async sendAudioFrame(frame: Uint8Array): Promise<void> {
    if (!this.streamSid) {
      console.warn('[AIVoiceSession] No streamSid available, skipping frame')
      return
    }
    
    // Ensure frame is exactly 160 bytes
    if (frame.length !== FRAME_SIZE) {
      console.warn(`[AIVoiceSession] Frame size mismatch: ${frame.length} bytes (expected ${FRAME_SIZE})`)
      const paddedFrame = new Uint8Array(FRAME_SIZE)
      paddedFrame.set(frame.slice(0, FRAME_SIZE))
      frame = paddedFrame
    }
    
    // Convert to base64
    const base64Audio = btoa(String.fromCharCode(...frame))
    
    // Send properly formatted audio frame to Twilio
    this.ws.send(JSON.stringify({
      event: 'media',
      streamSid: this.streamSid,
      sequenceNumber: String(this.sequenceNumber++),
      media: {
        payload: base64Audio,
        track: 'outbound'
      }
    }))
    
    // Pace frames at 20ms intervals
    await new Promise(resolve => setTimeout(resolve, FRAME_DURATION_MS))
  }
  
  private async startGreeting(): Promise<void> {
    if (this.hasGreeted || !this.isReady) return
    this.hasGreeted = true
    
    // Small delay to ensure stream is fully ready
    setTimeout(async () => {
      const greetingText = this.greeting || `Hello! Thank you for calling ${this.businessName}. How can I help you today?`
      await this.speakResponse(greetingText)
    }, 200)
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
  const url = new URL(req.url)
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