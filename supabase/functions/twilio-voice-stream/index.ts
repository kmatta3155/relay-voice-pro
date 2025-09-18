/*
 * AI Voice Receptionist - Production-Ready Pipeline
 * Architecture: Twilio WebSocket → Jitter Buffer → True Streaming STT → Dialogue Core → Streaming TTS → Twilio
 * Addresses all critical issues: proper TTS streaming, 20ms pacing, rolling STT windows, barge-in, metrics
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders = { 
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null

const VERSION = 'voice-relay-pro@2025-09-18-fixed'

// Configuration
const DEBUG_AUDIO = (Deno.env.get('DEBUG_AUDIO') || 'false').toLowerCase() === 'true'
const DEBUG_STT = (Deno.env.get('DEBUG_STT') || 'true').toLowerCase() === 'true'
const DEBUG_TTS = (Deno.env.get('DEBUG_TTS') || 'true').toLowerCase() === 'true'
const DEBUG_TIMING = (Deno.env.get('DEBUG_TIMING') || 'true').toLowerCase() === 'true'

// Audio processing constants
const FRAME_SIZE = 160 // μ-law bytes per 20ms at 8kHz
const FRAME_DURATION_MS = 20
const SAMPLE_RATE = 8000

// Voice Activity Detection (VAD) settings
const VAD_SILENCE_RMS = parseInt(Deno.env.get('VAD_SILENCE_RMS') || '700')
const VAD_MIN_FRAMES = parseInt(Deno.env.get('VAD_MIN_FRAMES') || '15') // ~300ms minimum utterance
const VAD_END_FRAMES = parseInt(Deno.env.get('VAD_END_FRAMES') || '30') // ~600ms silence to end turn
const VAD_MAX_FRAMES = parseInt(Deno.env.get('VAD_MAX_FRAMES') || '400') // ~8s max utterance

// Streaming STT settings
const STT_WINDOW_MS = 300 // Rolling window for streaming transcription
const STT_OVERLAP_MS = 50 // Overlap between windows
const STT_UPDATE_INTERVAL_MS = 150 // How often to check for STT updates

// Turn states
enum TurnState {
  LISTENING = 'LISTENING',
  THINKING = 'THINKING', 
  SPEAKING = 'SPEAKING',
  INTERRUPTED = 'INTERRUPTED'
}

// ========== UTILITIES ==========

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getCurrentTime(): number {
  return Date.now()
}

// ========== AUDIO PROCESSING ==========

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

function mulawToPcm(mulaw: number): number {
  mulaw = (~mulaw) & 0xff
  const sign = mulaw & 0x80
  const exponent = (mulaw >> 4) & 0x07
  const mantissa = mulaw & 0x0f
  const sample = ((mantissa | 0x10) << (exponent + 3)) - 0x84
  return sign ? -sample : sample
}

function ulawFramesToPcm16(frames: Uint8Array[]): Int16Array {
  const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0)
  const pcm = new Int16Array(totalLength)
  let offset = 0
  
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      pcm[offset++] = mulawToPcm(frame[i])
    }
  }
  
  return pcm
}

function pcm16ToUlawFrames(pcm: Int16Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  
  for (let i = 0; i < pcm.length; i += FRAME_SIZE) {
    const frame = new Uint8Array(FRAME_SIZE)
    const end = Math.min(i + FRAME_SIZE, pcm.length)
    
    for (let j = i; j < end; j++) {
      frame[j - i] = pcmToMulaw(pcm[j])
    }
    
    // Pad incomplete frames with silence (0xFF in μ-law = silence)
    if (end - i < FRAME_SIZE) {
      frame.fill(0xff, end - i)
    }
    
    frames.push(frame)
  }
  
  return frames
}

function isFrameSilent(frame: Uint8Array): boolean {
  let sumSquares = 0
  for (let i = 0; i < frame.length; i++) {
    const sample = mulawToPcm(frame[i])
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / frame.length)
  return rms < VAD_SILENCE_RMS
}

function createWavFile(pcm: Int16Array, sampleRate = 8000): Uint8Array {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  
  // RIFF header
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + pcm.length * 2, true) // file size
  view.setUint32(8, 0x57415645, false) // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // audio format (PCM)
  view.setUint16(22, 1, true) // number of channels
  view.setUint32(24, sampleRate, true) // sample rate
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  
  // data chunk
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, pcm.length * 2, true) // data size
  
  const wav = new Uint8Array(44 + pcm.length * 2)
  wav.set(new Uint8Array(header), 0)
  
  // Write PCM data
  for (let i = 0; i < pcm.length; i++) {
    wav[44 + i * 2] = pcm[i] & 0xff
    wav[44 + i * 2 + 1] = (pcm[i] >> 8) & 0xff
  }
  
  return wav
}

// ========== JITTER BUFFER ==========

class JitterBuffer {
  private buffer: Array<{ frame: Uint8Array; timestamp: number }> = []
  private readonly maxDepthMs: number
  private readonly targetDelayMs: number
  
  constructor(maxDepthMs = 200, targetDelayMs = 60) {
    this.maxDepthMs = maxDepthMs
    this.targetDelayMs = targetDelayMs
  }
  
  push(frame: Uint8Array): void {
    this.buffer.push({ frame: new Uint8Array(frame), timestamp: getCurrentTime() })
    
    // Drop oldest frames if buffer gets too deep
    const maxFrames = Math.floor(this.maxDepthMs / FRAME_DURATION_MS)
    if (this.buffer.length > maxFrames) {
      this.buffer.splice(0, this.buffer.length - maxFrames)
      if (DEBUG_AUDIO) console.log('[JITTER] Dropped frames, buffer depth:', this.buffer.length)
    }
  }
  
  async *getFrames(): AsyncGenerator<Uint8Array> {
    const targetFrames = Math.floor(this.targetDelayMs / FRAME_DURATION_MS)
    let lastEmitTime = getCurrentTime()
    
    while (true) {
      // Wait for minimum buffer depth before starting
      if (this.buffer.length < targetFrames) {
        await sleep(FRAME_DURATION_MS / 2)
        continue
      }
      
      const now = getCurrentTime()
      if (now - lastEmitTime >= FRAME_DURATION_MS) {
        const item = this.buffer.shift()
        if (item) {
          lastEmitTime = now
          yield item.frame
        }
      } else {
        await sleep(1)
      }
    }
  }
  
  clear(): void {
    this.buffer.length = 0
  }
  
  getDepth(): number {
    return this.buffer.length
  }
}

// ========== TRUE STREAMING STT ==========

class StreamingSTT {
  private audioFrames: Array<{ frame: Uint8Array; timestamp: number }> = []
  private currentTranscript = ''
  private lastTranscriptTime = 0
  private lastProcessTime = 0
  private isProcessing = false
  private readonly openaiKey: string
  private processingTimer?: number
  
  constructor(openaiKey: string) {
    this.openaiKey = openaiKey
    this.startProcessingLoop()
  }
  
  addAudioFrame(frame: Uint8Array): void {
    this.audioFrames.push({ frame: new Uint8Array(frame), timestamp: getCurrentTime() })
    
    // Keep only last 5 seconds of audio for rolling window
    const maxAgeMs = 5000
    const cutoffTime = getCurrentTime() - maxAgeMs
    this.audioFrames = this.audioFrames.filter(item => item.timestamp > cutoffTime)
  }
  
  private startProcessingLoop(): void {
    const loop = async () => {
      try {
        if (!this.isProcessing && this.audioFrames.length > 0) {
          const now = getCurrentTime()
          if (now - this.lastProcessTime >= STT_UPDATE_INTERVAL_MS) {
            await this.processAudioWindow()
            this.lastProcessTime = now
          }
        }
      } catch (error) {
        if (DEBUG_STT) console.error('[STT] Processing loop error:', error)
      }
      
      this.processingTimer = setTimeout(loop, 50) as unknown as number // Check every 50ms
    }
    
    loop()
  }
  
  private async processAudioWindow(): Promise<void> {
    if (this.isProcessing || this.audioFrames.length === 0) return
    
    this.isProcessing = true
    const startTime = getCurrentTime()
    
    try {
      // Create rolling window of recent audio
      const windowMs = STT_WINDOW_MS
      const cutoffTime = getCurrentTime() - windowMs
      const windowFrames = this.audioFrames.filter(item => item.timestamp > cutoffTime)
      
      if (windowFrames.length < 5) { // Need at least ~100ms of audio
        return
      }
      
      // Convert to PCM and create WAV
      const frames = windowFrames.map(item => item.frame)
      const pcm = ulawFramesToPcm16(frames)
      const wavData = createWavFile(pcm, SAMPLE_RATE)
      
      // Call Whisper API
      const formData = new FormData()
      formData.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav')
      formData.append('model', 'whisper-1')
      formData.append('response_format', 'json') // Use json for faster response
      
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`
        },
        body: formData
      })\n      \n      const processingTime = getCurrentTime() - startTime\n      \n      if (!response.ok) {\n        if (DEBUG_STT) console.error('[STT] API error:', response.status, await response.text())\n        return\n      }\n      \n      const result = await response.json()\n      const newText = result.text?.trim() || ''\n      \n      if (newText && newText !== this.currentTranscript) {\n        this.currentTranscript = newText\n        this.lastTranscriptTime = getCurrentTime()\n        \n        if (DEBUG_STT) {\n          console.log(`[STT] Partial (${processingTime}ms): \"${newText}\"`)\n        }\n        \n        if (DEBUG_TIMING && processingTime > 300) {\n          console.warn(`[STT] Slow transcription: ${processingTime}ms`)\n        }\n      }\n      \n    } catch (error) {\n      if (DEBUG_STT) console.error('[STT] Processing error:', error)\n    } finally {\n      this.isProcessing = false\n    }\n  }\n  \n  getCurrentTranscript(): string {\n    return this.currentTranscript\n  }\n  \n  isTranscriptStale(stallTimeMs = 600): boolean {\n    return getCurrentTime() - this.lastTranscriptTime > stallTimeMs\n  }\n  \n  finalizeTranscript(): string {\n    const final = this.currentTranscript\n    this.reset()\n    return final\n  }\n  \n  reset(): void {\n    this.audioFrames.length = 0\n    this.currentTranscript = ''\n    this.lastTranscriptTime = 0\n  }\n  \n  stop(): void {\n    if (this.processingTimer) {\n      clearTimeout(this.processingTimer)\n      this.processingTimer = undefined\n    }\n  }\n}\n\n// ========== DIALOGUE CORE ==========\n\nclass DialogueCore {\n  private readonly openaiKey: string\n  private conversationHistory: Array<{ role: string; content: string }> = []\n  \n  constructor(openaiKey: string) {\n    this.openaiKey = openaiKey\n  }\n  \n  async generateResponse(userText: string, businessName: string, tenantId?: string): Promise<string> {\n    const startTime = getCurrentTime()\n    \n    try {\n      // Get business context from knowledge base\n      const context = await this.getBusinessContext(tenantId, userText)\n      \n      // Build system prompt\n      const systemPrompt = await this.buildSystemPrompt(businessName, tenantId, context)\n      \n      // Add user message to history\n      this.conversationHistory.push({ role: 'user', content: userText })\n      \n      // Keep conversation history manageable\n      if (this.conversationHistory.length > 10) {\n        this.conversationHistory = this.conversationHistory.slice(-8)\n      }\n      \n      // Prepare messages for OpenAI\n      const messages = [\n        { role: 'system', content: systemPrompt },\n        ...this.conversationHistory\n      ]\n      \n      const response = await fetch('https://api.openai.com/v1/chat/completions', {\n        method: 'POST',\n        headers: {\n          'Authorization': `Bearer ${this.openaiKey}`,\n          'Content-Type': 'application/json'\n        },\n        body: JSON.stringify({\n          model: 'gpt-4o', // Using newer model\n          messages,\n          max_tokens: 120, // Keep responses concise for voice\n          temperature: 0.7\n        })\n      })\n      \n      const processingTime = getCurrentTime() - startTime\n      \n      if (!response.ok) {\n        console.error('[DIALOGUE] OpenAI error:', response.status, await response.text())\n        return \"I'm having trouble processing that right now. Could you please repeat your question?\"\n      }\n      \n      const result = await response.json()\n      const assistantReply = result.choices?.[0]?.message?.content?.trim() || ''\n      \n      // Add assistant response to history\n      if (assistantReply) {\n        this.conversationHistory.push({ role: 'assistant', content: assistantReply })\n      }\n      \n      if (DEBUG_TIMING) {\n        console.log(`[DIALOGUE] Response generated in ${processingTime}ms`)\n      }\n      \n      return assistantReply || \"I didn't catch that. Could you please repeat?\"\n      \n    } catch (error) {\n      console.error('[DIALOGUE] Error generating response:', error)\n      return \"I'm sorry, I'm having technical difficulties. Please try again.\"\n    }\n  }\n  \n  private async getBusinessContext(tenantId: string | undefined, query: string): Promise<string> {\n    if (!tenantId || !supabase) return ''\n    \n    try {\n      const { data } = await supabase.rpc('search_knowledge_keywords', {\n        p_tenant: tenantId,\n        p_query: query,\n        p_match_count: 3\n      })\n      \n      if (data && Array.isArray(data) && data.length > 0) {\n        return data.map((item: any) => item.content).join('\\n---\\n')\n      }\n    } catch (error) {\n      console.warn('[DIALOGUE] Knowledge search failed:', error)\n    }\n    \n    return ''\n  }\n  \n  private async buildSystemPrompt(businessName: string, tenantId?: string, context?: string): Promise<string> {\n    let basePrompt = `You are the AI receptionist for ${businessName}. You're friendly, professional, and helpful.`\n    \n    // Try to get agent configuration from database\n    if (tenantId && supabase) {\n      try {\n        const { data: agent } = await supabase\n          .from('ai_agents')\n          .select('system_prompt')\n          .eq('tenant_id', tenantId)\n          .maybeSingle()\n        \n        if (agent?.system_prompt) {\n          basePrompt = agent.system_prompt\n        }\n      } catch (error) {\n        console.warn('[DIALOGUE] Failed to load agent prompt:', error)\n      }\n    }\n    \n    const instructions = `\n${basePrompt}\n\nCONVERSATION RULES:\n- Keep responses to 1-2 sentences maximum for voice calls\n- Never say \"I don't have enough information\" - ask concise follow-up questions instead\n- Be proactive and offer next steps (book appointment, get quote, transfer call)\n- If unsure about specifics like pricing, give typical ranges and offer to confirm\n- Stay in character as a helpful receptionist at all times\n\n${context ? `BUSINESS CONTEXT:\\n${context}` : ''}`\n    \n    return instructions.trim()\n  }\n  \n  reset(): void {\n    this.conversationHistory.length = 0\n  }\n}\n\n// ========== TRUE STREAMING TTS ==========\n\nclass StreamingTTS {\n  private readonly elevenLabsKey: string\n  private isGenerating = false\n  private currentController?: AbortController\n  \n  constructor(elevenLabsKey: string) {\n    this.elevenLabsKey = elevenLabsKey\n  }\n  \n  async *generateSpeech(text: string, voiceId?: string): AsyncGenerator<Uint8Array[]> {\n    if (this.isGenerating) {\n      this.stop() // Cancel any ongoing generation\n    }\n    \n    this.isGenerating = true\n    this.currentController = new AbortController()\n    \n    const startTime = getCurrentTime()\n    let firstChunkTime = 0\n    \n    try {\n      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || 'pNInz6obpgDQGcFmaJgB'}/stream`\n      \n      const response = await fetch(url, {\n        method: 'POST',\n        headers: {\n          'Accept': 'audio/pcm', // Request PCM directly\n          'Content-Type': 'application/json',\n          'xi-api-key': this.elevenLabsKey\n        },\n        body: JSON.stringify({\n          text,\n          model_id: 'eleven_flash_v2_5', // Fast, low-latency model\n          voice_settings: {\n            stability: 0.5,\n            similarity_boost: 0.75,\n            style: 0.0,\n            use_speaker_boost: true\n          },\n          output_format: 'pcm_16000' // 16kHz PCM\n        }),\n        signal: this.currentController.signal\n      })\n      \n      if (!response.ok) {\n        console.error('[TTS] ElevenLabs error:', response.status, await response.text())\n        return\n      }\n      \n      if (!response.body) return\n      \n      const reader = response.body.getReader()\n      let pcmBuffer = new ArrayBuffer(0)\n      \n      try {\n        while (true) {\n          const { done, value } = await reader.read()\n          \n          if (done) {\n            // Process any remaining audio in buffer\n            if (pcmBuffer.byteLength > 0) {\n              const remainingFrames = this.processPcmChunk(pcmBuffer)\n              if (remainingFrames.length > 0) {\n                yield remainingFrames\n              }\n            }\n            break\n          }\n          \n          if (value && !this.currentController?.signal.aborted) {\n            if (firstChunkTime === 0) {\n              firstChunkTime = getCurrentTime()\n              const latency = firstChunkTime - startTime\n              if (DEBUG_TTS || DEBUG_TIMING) {\n                console.log(`[TTS] First audio chunk in ${latency}ms`)\n              }\n              \n              if (DEBUG_TIMING && latency > 350) {\n                console.warn(`[TTS] Slow first audio: ${latency}ms`)\n              }\n            }\n            \n            // Append new data to buffer\n            const newBuffer = new ArrayBuffer(pcmBuffer.byteLength + value.byteLength)\n            const newView = new Uint8Array(newBuffer)\n            newView.set(new Uint8Array(pcmBuffer))\n            newView.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), pcmBuffer.byteLength)\n            pcmBuffer = newBuffer\n            \n            // Process complete frames from buffer (keep remainder for next iteration)\n            const frames = this.processPcmChunk(pcmBuffer, true)\n            if (frames.length > 0) {\n              yield frames\n              \n              // Update buffer to keep only unprocessed remainder\n              const samplesProcessed = frames.length * FRAME_SIZE // 160 samples per frame at 8kHz\n              const bytesProcessed = samplesProcessed * 2 * 2 // *2 for 16->8kHz downsample, *2 for int16\n              pcmBuffer = pcmBuffer.slice(bytesProcessed)\n            }\n          }\n        }\n      } finally {\n        reader.releaseLock()\n      }\n      \n    } catch (error) {\n      if (error.name !== 'AbortError') {\n        console.error('[TTS] Generation error:', error)\n      }\n    } finally {\n      this.isGenerating = false\n      this.currentController = undefined\n    }\n  }\n  \n  private processPcmChunk(buffer: ArrayBuffer, keepRemainder = false): Uint8Array[] {\n    if (buffer.byteLength < 2) return [] // Need at least one int16 sample\n    \n    // Convert to PCM16 array\n    const pcm16 = new Int16Array(buffer)\n    \n    // Downsample from 16kHz to 8kHz\n    const pcm8k = this.downsample16to8(pcm16)\n    \n    // Only process complete frames if keepRemainder is true\n    const samplesPerFrame = FRAME_SIZE // 160 samples per 20ms frame at 8kHz\n    const completeFrames = keepRemainder \n      ? Math.floor(pcm8k.length / samplesPerFrame) \n      : Math.ceil(pcm8k.length / samplesPerFrame)\n    \n    if (completeFrames === 0) return []\n    \n    const samplesToProcess = completeFrames * samplesPerFrame\n    \n    // Create frames with proper padding\n    const processedPcm = new Int16Array(samplesToProcess)\n    processedPcm.set(pcm8k.slice(0, samplesToProcess))\n    \n    // Pad last frame with silence if needed\n    if (samplesToProcess > pcm8k.length) {\n      processedPcm.fill(0, pcm8k.length)\n    }\n    \n    return pcm16ToUlawFrames(processedPcm)\n  }\n  \n  private downsample16to8(input: Int16Array): Int16Array {\n    const output = new Int16Array(Math.floor(input.length / 2))\n    for (let i = 0; i < output.length; i++) {\n      // Simple decimation - take every other sample\n      output[i] = input[i * 2]\n    }\n    return output\n  }\n  \n  stop(): void {\n    if (this.currentController) {\n      this.currentController.abort()\n    }\n    this.isGenerating = false\n  }\n}\n\n// ========== CALL SESSION MANAGEMENT ==========\n\ninterface CallSession {\n  streamSid: string\n  businessName: string\n  tenantId?: string\n  voiceId?: string\n  turnState: TurnState\n  jitterBuffer: JitterBuffer\n  stt: StreamingSTT\n  dialogue: DialogueCore\n  tts: StreamingTTS\n  \n  // VAD state\n  isInUtterance: boolean\n  utteranceFrames: Uint8Array[]\n  silentFrameCount: number\n  speechFrameCount: number\n  \n  // Turn management\n  lastTtsTime: number\n  isSpeaking: boolean\n  lastUserSpeechTime: number\n  \n  // Metrics\n  callStartTime: number\n  turnCount: number\n  metrics: {\n    sttLatencies: number[]\n    ttsFirstAudioLatencies: number[]\n    turnDurations: number[]\n  }\n}\n\n// Outbound frame queue management with precise timing\nconst outboundQueues = new WeakMap<WebSocket, {\n  frames: Uint8Array[]\n  sending: boolean\n  cancelled: boolean\n  startTime?: number\n}>()\n\nasync function sendFramesToTwilio(\n  frames: Uint8Array[], \n  streamSid: string, \n  ws: WebSocket, \n  includeTrack = true\n): Promise<void> {\n  let queue = outboundQueues.get(ws)\n  if (!queue) {\n    queue = { frames: [], sending: false, cancelled: false }\n    outboundQueues.set(ws, queue)\n  }\n  \n  if (queue.cancelled) return\n  \n  queue.frames.push(...frames)\n  \n  if (queue.sending || ws.readyState !== WebSocket.OPEN) return\n  \n  queue.sending = true\n  \n  // Set timing reference for precise 20ms intervals\n  if (!queue.startTime) {\n    queue.startTime = getCurrentTime()\n  }\n  \n  let frameCount = 0\n  \n  try {\n    while (!queue.cancelled && queue.frames.length > 0 && ws.readyState === WebSocket.OPEN) {\n      const frame = queue.frames.shift()!\n      \n      // Encode frame to base64\n      let binaryString = ''\n      for (let i = 0; i < frame.length; i++) {\n        binaryString += String.fromCharCode(frame[i])\n      }\n      const payload = btoa(binaryString)\n      \n      // Send to Twilio with proper track field\n      const message = includeTrack \n        ? {\n            event: 'media',\n            streamSid,\n            track: 'outbound',\n            media: { payload }\n          }\n        : {\n            event: 'media',\n            streamSid,\n            media: { payload }\n          }\n      \n      ws.send(JSON.stringify(message))\n      frameCount++\n      \n      // Precise timing: wait for exact 20ms intervals from start\n      const expectedTime = queue.startTime! + (frameCount * FRAME_DURATION_MS)\n      const currentTime = getCurrentTime()\n      const waitTime = Math.max(0, expectedTime - currentTime)\n      \n      if (waitTime > 0) {\n        await sleep(waitTime)\n      }\n      \n      // Reset timing if we fall too far behind\n      if (currentTime - expectedTime > 100) {\n        if (DEBUG_TIMING) console.warn('[OUTBOUND] Timing reset - fell behind by', currentTime - expectedTime, 'ms')\n        queue.startTime = currentTime\n        frameCount = 0\n      }\n    }\n  } catch (error) {\n    console.error('[OUTBOUND] Error sending frames:', error)\n  } finally {\n    queue.sending = false\n  }\n}\n\nfunction cancelOutboundFrames(ws: WebSocket): void {\n  const queue = outboundQueues.get(ws)\n  if (queue) {\n    queue.cancelled = true\n    queue.frames.length = 0\n    if (DEBUG_AUDIO) console.log('[OUTBOUND] Cancelled outbound frames')\n  }\n}\n\nfunction sendMark(streamSid: string, ws: WebSocket, name: string): void {\n  try {\n    const message = {\n      event: 'mark',\n      streamSid,\n      mark: { name }\n    }\n    ws.send(JSON.stringify(message))\n  } catch (error) {\n    console.error('[MARK] Error:', error)\n  }\n}\n\nasync function sendPreludeSilence(streamSid: string, ws: WebSocket, durationMs = 300): Promise<void> {\n  const numFrames = Math.ceil(durationMs / FRAME_DURATION_MS)\n  const silenceFrames = Array.from({ length: numFrames }, () => {\n    const frame = new Uint8Array(FRAME_SIZE)\n    frame.fill(0xff) // μ-law silence\n    return frame\n  })\n  \n  await sendFramesToTwilio(silenceFrames, streamSid, ws, true)\n}\n\n// ========== AUDIO PROCESSING PIPELINE ==========\n\nasync function processIncomingAudio(frame: Uint8Array, session: CallSession, ws: WebSocket): Promise<void> {\n  const now = getCurrentTime()\n  \n  // Barge-in detection: if user speaks while we're speaking, interrupt\n  const isSilent = isFrameSilent(frame)\n  if (!isSilent) {\n    session.lastUserSpeechTime = now\n    \n    // Interrupt TTS if we're currently speaking\n    if (session.isSpeaking && session.turnState === TurnState.SPEAKING) {\n      if (DEBUG_AUDIO) console.log('[BARGE-IN] User interrupted TTS')\n      session.turnState = TurnState.INTERRUPTED\n      session.tts.stop()\n      cancelOutboundFrames(ws)\n      session.isSpeaking = false\n    }\n  }\n  \n  // Skip processing if we just finished speaking (brief echo guard)\n  if (session.isSpeaking && (now - session.lastTtsTime) < 200) {\n    return\n  }\n  \n  // Add frame to STT rolling buffer\n  session.stt.addAudioFrame(frame)\n  \n  // Voice Activity Detection for turn boundaries\n  if (!isSilent) {\n    if (!session.isInUtterance) {\n      // Start of new utterance\n      session.isInUtterance = true\n      session.speechFrameCount = 0\n      session.silentFrameCount = 0\n      session.utteranceFrames = []\n      if (session.turnState === TurnState.INTERRUPTED) {\n        session.turnState = TurnState.LISTENING\n      }\n      if (DEBUG_AUDIO) console.log('[VAD] Start of utterance')\n    }\n    session.speechFrameCount++\n    session.utteranceFrames.push(new Uint8Array(frame))\n    \n  } else if (session.isInUtterance) {\n    session.silentFrameCount++\n  }\n  \n  // Check for end of utterance using VAD + transcript stall\n  const hasMinSpeech = session.speechFrameCount >= VAD_MIN_FRAMES\n  const hasEndSilence = session.silentFrameCount >= VAD_END_FRAMES\n  const isMaxLength = session.speechFrameCount >= VAD_MAX_FRAMES\n  const transcriptStale = session.stt.isTranscriptStale()\n  \n  if (session.isInUtterance && \n      hasMinSpeech && \n      (hasEndSilence || isMaxLength || (transcriptStale && session.silentFrameCount > 10))) {\n    \n    if (session.turnState === TurnState.LISTENING || session.turnState === TurnState.INTERRUPTED) {\n      await processCompleteTurn(session, ws)\n    }\n  }\n}\n\nasync function processCompleteTurn(session: CallSession, ws: WebSocket): Promise<void> {\n  const turnStartTime = getCurrentTime()\n  \n  console.log(`[TURN] Processing turn ${++session.turnCount} - ${session.speechFrameCount} speech frames, ${session.silentFrameCount} silent frames`)\n  \n  session.turnState = TurnState.THINKING\n  session.isInUtterance = false\n  \n  try {\n    // Get final transcript\n    const transcript = session.stt.finalizeTranscript().trim()\n    \n    if (!transcript) {\n      console.log('[TURN] No transcript generated, ignoring turn')\n      session.turnState = TurnState.LISTENING\n      return\n    }\n    \n    console.log(`[TURN] User said: \"${transcript}\"`)\n    \n    // Generate response\n    const dialogueStartTime = getCurrentTime()\n    const response = await session.dialogue.generateResponse(\n      transcript,\n      session.businessName,\n      session.tenantId\n    )\n    const dialogueTime = getCurrentTime() - dialogueStartTime\n    \n    if (!response) {\n      console.log('[TURN] No response generated')\n      session.turnState = TurnState.LISTENING\n      return\n    }\n    \n    console.log(`[TURN] AI response: \"${response}\"`)\n    \n    // Generate and stream TTS\n    session.turnState = TurnState.SPEAKING\n    session.isSpeaking = true\n    session.lastTtsTime = getCurrentTime()\n    \n    const ttsStartTime = getCurrentTime()\n    let firstAudioTime = 0\n    let framesSent = 0\n    \n    for await (const frames of session.tts.generateSpeech(response, session.voiceId)) {\n      if (session.turnState === TurnState.INTERRUPTED) {\n        console.log('[TURN] Turn interrupted during TTS, stopping')\n        break\n      }\n      \n      if (firstAudioTime === 0) {\n        firstAudioTime = getCurrentTime()\n        const firstAudioLatency = firstAudioTime - ttsStartTime\n        session.metrics.ttsFirstAudioLatencies.push(firstAudioLatency)\n        \n        if (DEBUG_TIMING) {\n          console.log(`[TTS] First audio frames ready in ${firstAudioLatency}ms`)\n        }\n      }\n      \n      await sendFramesToTwilio(frames, session.streamSid, ws, true)\n      framesSent += frames.length\n      session.lastTtsTime = getCurrentTime()\n    }\n    \n    if (session.turnState === TurnState.SPEAKING) {\n      session.isSpeaking = false\n      session.turnState = TurnState.LISTENING\n      \n      const turnDuration = getCurrentTime() - turnStartTime\n      session.metrics.turnDurations.push(turnDuration)\n      \n      console.log(`[TURN] Completed in ${turnDuration}ms (${framesSent} frames sent)`)\n    }\n    \n  } catch (error) {\n    console.error('[TURN] Processing error:', error)\n    session.turnState = TurnState.LISTENING\n    session.isSpeaking = false\n    \n    // Send error response\n    try {\n      const errorFrames = []\n      for await (const frames of session.tts.generateSpeech(\n        \"I'm sorry, I didn't catch that. Could you please repeat?\", \n        session.voiceId\n      )) {\n        errorFrames.push(...frames)\n        if (errorFrames.length > 100) break // Limit error response length\n      }\n      if (errorFrames.length > 0) {\n        await sendFramesToTwilio(errorFrames, session.streamSid, ws, true)\n      }\n    } catch (ttsError) {\n      console.error('[TURN] Error TTS failed:', ttsError)\n    }\n  }\n}\n\n// ========== MAIN WEBSOCKET HANDLER ==========\n\nserve(async (req) => {\n  if (req.method === 'OPTIONS') {\n    return new Response('OK', { headers: corsHeaders })\n  }\n  \n  const upgrade = req.headers.get('upgrade')?.toLowerCase()\n  if (upgrade !== 'websocket') {\n    return new Response('Expected WebSocket upgrade', { status: 426 })\n  }\n  \n  // Handle WebSocket protocol negotiation properly\n  const protocolHeader = req.headers.get('sec-websocket-protocol') || ''\n  const protocols = protocolHeader.split(',').map(p => p.trim()).filter(Boolean)\n  const preferredProtocols = ['audio', 'audio.stream.v1']\n  const selectedProtocol = protocols.find(p => preferredProtocols.includes(p)) || protocols[0]\n  \n  const { socket, response } = selectedProtocol \n    ? Deno.upgradeWebSocket(req, { protocol: selectedProtocol })\n    : Deno.upgradeWebSocket(req)\n  \n  let session: CallSession | null = null\n  let keepAliveTimer: number | undefined\n  \n  socket.onopen = () => {\n    console.log(`[WS] Connection opened - ${VERSION}`)\n  }\n  \n  socket.onmessage = async (event) => {\n    try {\n      const data = JSON.parse(event.data)\n      \n      if (data.event === 'start') {\n        // Initialize call session\n        const streamSid = data.start?.streamSid || data.streamSid || 'unknown'\n        const businessName = data.start?.customParameters?.businessName || 'this business'\n        const tenantId = data.start?.customParameters?.tenantId || data.start?.customParameters?.tenant_id\n        const voiceId = data.start?.customParameters?.voiceId || data.start?.customParameters?.voice_id\n        \n        console.log(`[CALL] Starting session - Stream: ${streamSid}, Business: ${businessName}`)\n        \n        // Get API keys\n        const openaiKey = Deno.env.get('OPENAI_API_KEY')\n        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')\n        \n        if (!openaiKey) {\n          console.error('[ERROR] OPENAI_API_KEY not configured')\n          socket.close(1011, 'Server configuration error')\n          return\n        }\n        \n        if (!elevenLabsKey) {\n          console.error('[ERROR] ELEVENLABS_API_KEY not configured')\n          socket.close(1011, 'Server configuration error')\n          return\n        }\n        \n        session = {\n          streamSid,\n          businessName,\n          tenantId,\n          voiceId,\n          turnState: TurnState.LISTENING,\n          jitterBuffer: new JitterBuffer(),\n          stt: new StreamingSTT(openaiKey),\n          dialogue: new DialogueCore(openaiKey),\n          tts: new StreamingTTS(elevenLabsKey),\n          \n          isInUtterance: false,\n          utteranceFrames: [],\n          silentFrameCount: 0,\n          speechFrameCount: 0,\n          \n          lastTtsTime: 0,\n          isSpeaking: false,\n          lastUserSpeechTime: 0,\n          \n          callStartTime: getCurrentTime(),\n          turnCount: 0,\n          metrics: {\n            sttLatencies: [],\n            ttsFirstAudioLatencies: [],\n            turnDurations: []\n          }\n        }\n        \n        // Send prelude silence to prime the stream\n        await sendPreludeSilence(streamSid, socket, 300)\n        sendMark(streamSid, socket, 'ready')\n        \n        // Start keepalive timer\n        keepAliveTimer = setInterval(() => {\n          if (session && socket.readyState === WebSocket.OPEN) {\n            sendMark(session.streamSid, socket, 'keepalive')\n          }\n        }, 10000) as unknown as number\n        \n        // Start processing jitter buffer in background\n        ;(async () => {\n          try {\n            for await (const frame of session.jitterBuffer.getFrames()) {\n              if (!session || socket.readyState !== WebSocket.OPEN) break\n              await processIncomingAudio(frame, session, socket)\n            }\n          } catch (error) {\n            console.error('[JITTER] Processing error:', error)\n          }\n        })()\n        \n      } else if (data.event === 'media' && data.media?.payload) {\n        if (!session) return\n        \n        // Decode incoming μ-law frame\n        const binaryString = atob(data.media.payload)\n        const frame = new Uint8Array(binaryString.length)\n        for (let i = 0; i < binaryString.length; i++) {\n          frame[i] = binaryString.charCodeAt(i)\n        }\n        \n        // Verify frame size\n        if (frame.length !== FRAME_SIZE) {\n          if (DEBUG_AUDIO) console.warn(`[MEDIA] Unexpected frame size: ${frame.length}`)\n        }\n        \n        // Add to jitter buffer for stable processing\n        session.jitterBuffer.push(frame)\n        \n      } else if (data.event === 'stop') {\n        console.log('[CALL] Stream stopped')\n        if (session) {\n          const duration = getCurrentTime() - session.callStartTime\n          const avgTurnTime = session.metrics.turnDurations.length > 0 \n            ? session.metrics.turnDurations.reduce((a, b) => a + b) / session.metrics.turnDurations.length \n            : 0\n          const avgTtsLatency = session.metrics.ttsFirstAudioLatencies.length > 0\n            ? session.metrics.ttsFirstAudioLatencies.reduce((a, b) => a + b) / session.metrics.ttsFirstAudioLatencies.length\n            : 0\n            \n          console.log(`[METRICS] Call: ${duration}ms, Turns: ${session.turnCount}, Avg turn: ${avgTurnTime.toFixed(0)}ms, Avg TTS latency: ${avgTtsLatency.toFixed(0)}ms`)\n          \n          session.stt.stop()\n          session.tts.stop()\n        }\n      }\n      \n    } catch (error) {\n      console.error('[WS] Message processing error:', error)\n    }\n  }\n  \n  socket.onerror = (error) => {\n    console.error('[WS] WebSocket error:', error)\n  }\n  \n  socket.onclose = () => {\n    console.log('[WS] Connection closed')\n    \n    // Clean up\n    if (session) {\n      session.stt.stop()\n      session.tts.stop()\n      const queue = outboundQueues.get(socket)\n      if (queue) {\n        queue.cancelled = true\n        queue.frames.length = 0\n      }\n    }\n    \n    if (keepAliveTimer) {\n      clearInterval(keepAliveTimer)\n    }\n  }\n  \n  return response\n})\n\nconsole.log(`AI Voice Receptionist started - ${VERSION}`)\nconsole.log(`Configuration: VAD_MIN=${VAD_MIN_FRAMES}, VAD_END=${VAD_END_FRAMES}, STT_WINDOW=${STT_WINDOW_MS}ms`)