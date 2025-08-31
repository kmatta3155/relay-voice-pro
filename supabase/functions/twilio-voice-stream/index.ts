import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

// Version for tracking deployments
const VERSION = 'tts-or-convai@2025-08-31-01'

// Feature flag: use ElevenLabs Conversational AI audio stream
// Set TWILIO_USE_AGENT_AUDIO=false to force TTS-only pipeline
const USE_CONVAI = (Deno.env.get('TWILIO_USE_AGENT_AUDIO') ?? 'true').toLowerCase() === 'true'

// Standard G.711 μ-law encoding
function pcmToMulaw(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  
  let sign = 0
  if (sample < 0) {
    sign = 0x80
    sample = -sample
  }
  if (sample > CLIP) sample = CLIP
  
  sample = sample + BIAS
  
  let exponent = 7
  let expMask = 0x4000
  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--
    expMask >>= 1
  }
  
  const mantissaShift = (exponent === 0) ? 4 : (exponent + 3)
  const mantissa = (sample >> mantissaShift) & 0x0f
  
  return (~(sign | (exponent << 4) | mantissa)) & 0xff
}

function mulawToPcm(mu: number): number {
  mu = (~mu) & 0xff
  const sign = mu & 0x80
  const exponent = (mu >> 4) & 0x07
  const mantissa = mu & 0x0f
  const sample = ((mantissa << 3) + 0x84) << (exponent + 3)
  return sign ? (0x84 - sample) : (sample - 0x84)
}

// Convert Twilio μ-law 8kHz to PCM16 16kHz for ElevenLabs agent
function convertMulawToPcm16(mulawData: Uint8Array): Uint8Array {
  // Step 1: Convert μ-law to PCM16 at 8kHz
  const pcm8k = new Int16Array(mulawData.length)
  for (let i = 0; i < mulawData.length; i++) {
    pcm8k[i] = mulawToPcm(mulawData[i])
  }
  
  // Step 2: Upsample from 8kHz to 16kHz (2:1 interpolation)
  const pcm16k = new Int16Array(pcm8k.length * 2)
  for (let i = 0; i < pcm8k.length; i++) {
    const sample = pcm8k[i]
    pcm16k[i * 2] = sample
    // Linear interpolation for smoother upsampling
    pcm16k[i * 2 + 1] = i < pcm8k.length - 1 ? 
      Math.round((sample + pcm8k[i + 1]) / 2) : sample
  }
  
  // Step 3: Convert to bytes (little-endian)
  const bytes = new Uint8Array(pcm16k.length * 2)
  for (let i = 0; i < pcm16k.length; i++) {
    const sample = pcm16k[i]
    bytes[i * 2] = sample & 0xff
    bytes[i * 2 + 1] = (sample >> 8) & 0xff
  }
  
  return bytes
}

// Outbound audio queue for strict 20ms pacing
const twilioOutboundQueue: Uint8Array[] = []
let twilioIsSending = false

async function sendAudioToTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  // Add all chunks to queue
  for (const chunk of chunks) {
    twilioOutboundQueue.push(chunk)
  }
  
  // Start sender loop if not already running
  if (!twilioIsSending && socket.readyState === WebSocket.OPEN) {
    twilioIsSending = true
    console.log(`[OUTBOUND] Starting queue with ${twilioOutboundQueue.length} chunks`)
    
    try {
      while (twilioOutboundQueue.length > 0 && socket.readyState === WebSocket.OPEN) {
        const chunk = twilioOutboundQueue.shift()!
        
        if (chunk.length !== 160) {
          console.warn(`[WARN] Chunk size mismatch: ${chunk.length} bytes (expected 160)`)
        }
        
        // Binary-safe base64 encoding
        let binary = ''
        for (let j = 0; j < chunk.length; j++) {
          binary += String.fromCharCode(chunk[j])
        }
        const base64Payload = btoa(binary)
        
        // Twilio-compliant outbound message (simplified format)
        const message = {
          event: 'media',
          streamSid,
          media: {
            payload: base64Payload
          }
        }
        
        socket.send(JSON.stringify(message))
        
        // Precise 20ms pacing for 8kHz μ-law
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    } catch (e) {
      console.error('[ERROR] Error in outbound queue:', e)
    } finally {
      twilioIsSending = false
      console.log('[SUCCESS] Outbound queue completed')
    }
  }
}

// Wait until the outbound queue fully drains
async function waitForQueueDrain(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now()
  while (twilioIsSending || twilioOutboundQueue.length > 0) {
    if (Date.now() - start > timeoutMs) {
      console.warn(`[TIMEOUT] Queue drain timeout after ${timeoutMs}ms (remaining: ${twilioOutboundQueue.length})`)
      return false
    }
    await new Promise(r => setTimeout(r, 25))
  }
  console.log('[SUCCESS] Outbound queue fully drained')
  return true
}

// Generate μ-law tone for testing outbound path (enabled via ENABLE_TONE_TEST env var)
function generateUlawTone(durationMs: number, frequencyHz = 1000): Uint8Array {
  const sampleRate = 8000
  const samples = Math.round((durationMs * sampleRate) / 1000)
  const toneData = new Uint8Array(samples)
  
  for (let i = 0; i < samples; i++) {
    // Generate sine wave
    const sample = Math.sin(2 * Math.PI * frequencyHz * i / sampleRate)
    // Convert to 16-bit PCM, then to μ-law
    const pcm16 = Math.round(sample * 32767)
    toneData[i] = pcmToMulaw(pcm16)
  }
  
  return toneData
}

// Send μ-law silence prelude frames to keep Twilio engaged
async function sendSilencePrelude(streamSid: string, socket: WebSocket, durationMs = 400) {
  const frames = Math.max(1, Math.round(durationMs / 20))
  const chunks: Uint8Array[] = []
  for (let i = 0; i < frames; i++) {
    const chunk = new Uint8Array(160)
    chunk.fill(0xff) // μ-law silence
    chunks.push(chunk)
  }
  await sendAudioToTwilio(chunks, streamSid, socket)
}

// Robust WAV PCM parser + converters for Twilio-compatible μ-law 8kHz
function parseWavPcm(audioData: Uint8Array): {
  formatCode: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  pcmBytes: Uint8Array
} | null {
  if (audioData.length < 12) {
    console.log('[WAV] Audio too short for WAV header, assuming raw PCM16 mono 16000')
    return {
      formatCode: 1,
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      pcmBytes: audioData
    }
  }
  const header = String.fromCharCode(...audioData.slice(0, 4))
  const wave   = String.fromCharCode(...audioData.slice(8, 12))
  if (header !== 'RIFF' || wave !== 'WAVE') {
    console.log('[WAV] No RIFF/WAVE detected, assuming raw PCM16 mono 16000')
    return {
      formatCode: 1,
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      pcmBytes: audioData
    }
  }

  let fmtFound = false
  let dataFound = false
  let formatCode = 1
  let channels = 1
  let sampleRate = 16000
  let bitsPerSample = 16
  let pcmBytes: Uint8Array | null = null

  let offset = 12
  while (offset + 8 <= audioData.length) {
    const chunkId = String.fromCharCode(...audioData.slice(offset, offset + 4))
    const chunkSize = new DataView(audioData.buffer).getUint32(offset + 4, true)
    const next = offset + 8 + chunkSize

    if (chunkId === 'fmt ') {
      fmtFound = true
      const view = new DataView(audioData.buffer, offset + 8, chunkSize)
      formatCode = view.getUint16(0, true)
      channels = view.getUint16(2, true)
      sampleRate = view.getUint32(4, true)
      // byteRate = view.getUint32(8, true)
      // blockAlign = view.getUint16(12, true)
      bitsPerSample = view.getUint16(14, true)
      console.log(`[WAV_FMT] format=${formatCode}, channels=${channels}, rate=${sampleRate}, bits=${bitsPerSample}`)
    } else if (chunkId === 'data') {
      dataFound = true
      const dataStart = offset + 8
      const dataEnd = dataStart + chunkSize
      pcmBytes = audioData.slice(dataStart, dataEnd)
      console.log(`[WAV_DATA] data size: ${pcmBytes.length} bytes`)
    }
    offset = next
  }

  if (!dataFound || !pcmBytes) {
    console.warn('[ERROR] No data chunk found in WAV')
    return null
  }

  if (!fmtFound) {
    console.warn('[WARN] No fmt chunk found in WAV, assuming PCM16 mono 16000')
    return {
      formatCode: 1,
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      pcmBytes
    }
  }

  return { formatCode, channels, sampleRate, bitsPerSample, pcmBytes }
}

function bytesToInt16LE(bytes: Uint8Array): Int16Array {
  // Safe little-endian reader for edge cases
  const samples = new Int16Array(Math.floor(bytes.length / 2))
  for (let i = 0; i < samples.length; i++) {
    const idx = i * 2
    if (idx + 1 < bytes.length) {
      samples[i] = bytes[idx] | (bytes[idx + 1] << 8)
      // Handle sign extension for negative values
      if (samples[i] > 32767) samples[i] -= 65536
    }
  }
  return samples
}

function stereoToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels === 1) return samples
  const frames = Math.floor(samples.length / channels)
  const mono = new Int16Array(frames)
  for (let i = 0; i < frames; i++) {
    let acc = 0
    for (let c = 0; c < channels; c++) acc += samples[i * channels + c]
    mono[i] = Math.max(-32768, Math.min(32767, Math.round(acc / channels)))
  }
  return mono
}

function resamplePcm16Linear(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input
  const ratio = toRate / fromRate
  const outLen = Math.max(1, Math.round(input.length * ratio))
  const output = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = srcPos - i0
    const s0 = input[i0]
    const s1 = input[i1]
    output[i] = Math.round(s0 + (s1 - s0) * frac)
  }
  return output
}

function encodePcm16ToUlaw(samples: Int16Array): Uint8Array {
  const ulaw = new Uint8Array(samples.length)
  for (let i = 0; i < samples.length; i++) ulaw[i] = pcmToMulaw(samples[i])
  return ulaw
}

// Generate reliable TTS greeting -> request PCM, parse WAV, resample to 8kHz, μ-law encode
async function sendReliableGreeting(streamSid: string, socket: WebSocket, businessName: string) {
  try {
    console.log('[TTS] Generating reliable TTS greeting (PCM->μ-law)...')
    const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!elevenLabsKey) {
      console.error('[ERROR] ELEVENLABS_API_KEY missing for greeting')
      return
    }

    // Tone-only debug mode - bypass ElevenLabs entirely
    const enableToneTestOnly = Deno.env.get('ENABLE_TONE_TEST_ONLY') === 'true'
    if (enableToneTestOnly) {
      console.log('[TONE_TEST_ONLY] Sending 1kHz test tone and skipping ElevenLabs...')
      const toneData = generateUlawTone(3000, 1000) // 3 second tone
      const toneChunks: Uint8Array[] = []
      for (let i = 0; i < toneData.length; i += 160) {
        const chunk = new Uint8Array(160)
        const len = Math.min(160, toneData.length - i)
        chunk.set(toneData.subarray(i, i + len), 0)
        if (len < 160) chunk.fill(0xff, len)
        toneChunks.push(chunk)
      }
      await sendAudioToTwilio(toneChunks, streamSid, socket)
      console.log('[TONE_TEST_ONLY] Tone test complete - call should stay open with tone')
      return
    }
    
    // Optional tone test for debugging
    const enableToneTest = Deno.env.get('ENABLE_TONE_TEST') === 'true'
    if (enableToneTest) {
      console.log('[TONE_TEST] Sending 1kHz test tone...')
      const toneData = generateUlawTone(600, 1000)
      const toneChunks: Uint8Array[] = []
      for (let i = 0; i < toneData.length; i += 160) {
        const chunk = new Uint8Array(160)
        const len = Math.min(160, toneData.length - i)
        chunk.set(toneData.subarray(i, i + len), 0)
        if (len < 160) chunk.fill(0xff, len)
        toneChunks.push(chunk)
      }
      await sendAudioToTwilio(toneChunks, streamSid, socket)
      console.log('[TONE_TEST] Tone test complete, proceeding with greeting...')
    }

    // Default to a stable public ElevenLabs voice if not provided
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') || '9BWtsMINqrJLrRacOk9x'
    const text = `Hello! Thank you for calling ${businessName}. How can I help you today?`

    // Prefer PCM request to avoid any container/encoding ambiguity
    let resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        'Content-Type': 'application/json',
        'Accept': 'application/octet-stream'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        output_format: 'pcm_16000' // Request 16k PCM, we will downsample to 8k
      })
    })

    console.log(`[TTS] TTS response status: ${resp.status}`)
    if (!resp.ok) {
      const err = await resp.text()
      console.error('[ERROR] TTS greeting failed (pcm_16000):', resp.status, err)
      return
    }

    const audioBuffer = await resp.arrayBuffer()
    const raw = new Uint8Array(audioBuffer)
    console.log(`[TTS] Received ${raw.length} bytes from ElevenLabs (PCM expected)`)

    const parsed = parseWavPcm(raw)
    if (!parsed) {
      console.error('[ERROR] Failed to parse WAV PCM from ElevenLabs response')
      return
    }
    if (parsed.formatCode !== 1 || parsed.bitsPerSample !== 16) {
      console.error(`[ERROR] Unsupported WAV format: code=${parsed.formatCode}, bits=${parsed.bitsPerSample}`)
      return
    }

    // Convert bytes -> Int16, deinterleave to mono if needed
    let samples = bytesToInt16LE(parsed.pcmBytes)
    samples = stereoToMono(samples, parsed.channels)

    // Resample to 8kHz if needed
    const samples8k = resamplePcm16Linear(samples, parsed.sampleRate, 8000)

    // μ-law encode
    const ulawBytes = encodePcm16ToUlaw(samples8k)
    console.log(`[ENCODE] Encoded greeting ${samples8k.length} samples -> ${ulawBytes.length} μ-law bytes`)

    // Chunk into strict 160-byte frames for Twilio
    const chunks: Uint8Array[] = []
    for (let i = 0; i < ulawBytes.length; i += 160) {
      const chunk = new Uint8Array(160)
      const len = Math.min(160, ulawBytes.length - i)
      chunk.set(ulawBytes.subarray(i, i + len), 0)
      if (len < 160) chunk.fill(0xff, len)
      chunks.push(chunk)
    }
    console.log(`[CHUNK] Created ${chunks.length} greeting chunks`)
    await sendAudioToTwilio(chunks, streamSid, socket)
    console.log('[SUCCESS] Reliable greeting sent to Twilio')
  } catch (e) {
    console.error('[ERROR] Error in reliable greeting:', e)
  }
}

// Get signed URL for ElevenLabs Conversational AI
async function getSignedConvAIUrl(agentId: string, apiKey: string): Promise<string | null> {
  try {
    console.log('[CONVAI] Requesting signed URL for ConvAI agent...')
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      }
    )
    
    if (!response.ok) {
      const error = await response.text()
      console.error('[ERROR] Failed to get signed URL:', response.status, error)
      return null
    }
    
    const data = await response.json()
    console.log('[SUCCESS] Got signed URL for ConvAI')
    return data.signed_url
  } catch (e) {
    console.error('[ERROR] Error getting signed URL:', e)
    return null
  }
}

serve(async (req) => {
  console.log(`[START] TWILIO CONVERSATIONAL AI STREAM - ${VERSION}`)
  console.log(`[DEBUG] Request URL: ${req.url}`)
  console.log(`[DEBUG] Request method: ${req.method}`)
  console.log(`[DEBUG] Request headers:`, Object.fromEntries(req.headers.entries()))
  console.log('[WS] Checking WebSocket upgrade...')
  
  if (req.method === 'OPTIONS') {
    console.log('[CORS] Returning CORS response')
    return new Response('ok', { headers: corsHeaders })
  }
  
  const upgrade = req.headers.get('upgrade') || ''
  console.log(`[DEBUG] Upgrade header: "${upgrade}"`)
  if (upgrade.toLowerCase() !== 'websocket') {
    console.log('[ERROR] Not a WebSocket request - rejecting')
    return new Response('Expected Websocket', { status: 426 })
  }
  
  const protocolHeader = req.headers.get('sec-websocket-protocol') || ''
  const protocols = protocolHeader.split(',').map(p => p.trim()).filter(Boolean)
  console.log('[WS] Requested WS protocols:', protocols)
  const selectedProtocol = protocols.includes('audio.stream.v1')
    ? 'audio.stream.v1'
    : (protocols[0] || undefined)
  const { socket, response } = Deno.upgradeWebSocket(
    req,
    selectedProtocol ? { protocol: selectedProtocol } : {}
  )
  
  let streamSid = ''
  let phoneNumber = ''
  let tenantId = ''
  let businessName = ''
  let elevenLabsWs: WebSocket | null = null
  let elevenLabsConnected = false
  let conversationStarted = false
  // Fallback buffer for production-ready fallback pipeline
  let fallbackBuffer: Uint8Array[] = [];
  let fallbackActive = false;

  // TTS-only mode state (when USE_CONVAI=false)
  const ttsOnlyMode = !USE_CONVAI
  let ttsFramesBuffer: Uint8Array[] = []
  let ttsProcessing = false
  let isSpeaking = false
  let consecutiveSilenceFrames = 0

  function isUlawSilence(frame: Uint8Array, thresholdRms = 500): boolean {
    // Convert μ-law -> PCM16 and compute RMS to detect silence
    let sumSq = 0
    for (let i = 0; i < frame.length; i++) {
      const s = mulawToPcm(frame[i])
      sumSq += s * s
    }
    const rms = Math.sqrt(sumSq / frame.length)
    return rms < thresholdRms
  }

  function ulawFramesToPcm16(frames: Uint8Array[]): Int16Array {
    const totalSamples = frames.reduce((acc, f) => acc + f.length, 0)
    const out = new Int16Array(totalSamples)
    let idx = 0
    for (const f of frames) {
      for (let i = 0; i < f.length; i++) {
        out[idx++] = mulawToPcm(f[i])
      }
    }
    return out
  }

  function encodeWavFromPcm16(samples: Int16Array, sampleRate = 8000): Uint8Array {
    const header = new ArrayBuffer(44)
    const view = new DataView(header)
    view.setUint32(0, 0x52494646, false) // "RIFF"
    view.setUint32(4, 36 + samples.length * 2, true)
    view.setUint32(8, 0x57415645, false) // "WAVE"
    view.setUint32(12, 0x666d7420, false) // "fmt "
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true) // byte rate
    view.setUint16(32, 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample
    view.setUint32(36, 0x64617461, false) // "data"
    view.setUint32(40, samples.length * 2, true)
    const wav = new Uint8Array(44 + samples.length * 2)
    wav.set(new Uint8Array(header), 0)
    for (let i = 0; i < samples.length; i++) {
      wav[44 + i * 2] = samples[i] & 0xff
      wav[44 + i * 2 + 1] = (samples[i] >> 8) & 0xff
    }
    return wav
  }

  async function transcribeWithWhisper(wavBytes: Uint8Array): Promise<string> {
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.warn('[WHISPER] OPENAI_API_KEY missing, skipping transcription')
      return ''
    }
    try {
      const form = new FormData()
      form.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'audio.wav')
      form.append('model', 'whisper-1')
      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: form
      })
      if (!resp.ok) {
        console.error('[WHISPER] Transcription failed:', await resp.text())
        return ''
      }
      const json = await resp.json()
      const text = json.text || ''
      console.log('[WHISPER] Transcript:', text)
      return text
    } catch (e) {
      console.error('[WHISPER] Error:', e)
      return ''
    }
  }

  async function generateReplyWithChatGPT(transcript: string, business: string): Promise<string> {
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) return ''
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: `You are a helpful AI receptionist for ${business}. Keep replies concise.` },
            { role: 'user', content: transcript }
          ]
        })
      })
      if (!resp.ok) {
        console.error('[CHATGPT] Generation failed:', await resp.text())
        return ''
      }
      const json = await resp.json()
      const reply = json.choices?.[0]?.message?.content || ''
      console.log('[CHATGPT] Reply:', reply)
      return reply
    } catch (e) {
      console.error('[CHATGPT] Error:', e)
      return ''
    }
  }

  async function ttsTextToUlawChunks(text: string, voiceIdOverride?: string): Promise<Uint8Array[]> {
    const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
    const voiceId = voiceIdOverride || Deno.env.get('ELEVENLABS_VOICE_ID') || '9BWtsMINqrJLrRacOk9x'
    const chunks: Uint8Array[] = []
    if (!elevenLabsKey) return chunks
    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': 'application/octet-stream'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          output_format: 'pcm_16000'
        })
      })
      if (!resp.ok) {
        console.error('[TTS] ElevenLabs TTS failed:', resp.status, await resp.text())
        return chunks
      }
      const buf = new Uint8Array(await resp.arrayBuffer())
      // Parse WAV or raw PCM, then downsample and μ-law encode
      const parsed = parseWavPcm(buf)
      if (!parsed) return chunks
      if (parsed.formatCode !== 1 || parsed.bitsPerSample !== 16) return chunks
      let samples = bytesToInt16LE(parsed.pcmBytes)
      samples = stereoToMono(samples, parsed.channels)
      const samples8k = resamplePcm16Linear(samples, parsed.sampleRate, 8000)
      const ulaw = encodePcm16ToUlaw(samples8k)
      for (let i = 0; i < ulaw.length; i += 160) {
        const frame = new Uint8Array(160)
        const len = Math.min(160, ulaw.length - i)
        frame.set(ulaw.subarray(i, i + len), 0)
        if (len < 160) frame.fill(0xff, len)
        chunks.push(frame)
      }
      console.log(`[TTS] Prepared ${chunks.length} μ-law chunks for reply`)
      return chunks
    } catch (e) {
      console.error('[TTS] Error synthesizing:', e)
      return chunks
    }
  }
  
  socket.onopen = () => {
    console.log('[WS] WebSocket connected to Twilio')
  }
  
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('[TWILIO] Twilio event:', data.event)
      
      if (data.event === 'start') {
        console.log('[START] Stream started - initializing ConvAI connection')
        streamSid = data.start?.streamSid || data.streamSid || ''
        phoneNumber = data.start?.customParameters?.phoneNumber || 'unknown'
        tenantId = data.start?.customParameters?.tenantId || ''
        businessName = data.start?.customParameters?.businessName || 'this business'
        
        // Log Twilio media format for diagnostics
        console.log('[DIAGNOSTICS] Twilio mediaFormat:', JSON.stringify(data.start?.mediaFormat || {}))
        console.log(`[CALL] Call: Phone=${phoneNumber}, Tenant=${tenantId}, Business=${businessName}`)
        
        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
        const agentId = Deno.env.get('ELEVENLABS_AGENT_ID')
        console.log(`[CONFIG] ElevenLabs Key: ${!!elevenLabsKey}, Agent ID: ${!!agentId}, USE_CONVAI=${USE_CONVAI}`)
        
        if (!elevenLabsKey) {
          console.error('[ERROR] Missing ELEVENLABS_API_KEY, activating fallback')
          fallbackActive = true;
          return;
        }
        
        // Step 1: Send short μ-law silence prelude
        console.log('[PRELUDE] Sending short μ-law silence prelude...')
        await sendSilencePrelude(streamSid, socket, 400)

        // Step 2: Send immediate reliable greeting
        console.log('[GREETING] Sending immediate greeting...')
        await sendReliableGreeting(streamSid, socket, businessName)
        
        // Step 3: Wait for greeting to complete
        await waitForQueueDrain(10000)
        
        if (USE_CONVAI) {
          // Step 3: Connect to ElevenLabs Conversational AI
          console.log('[CONVAI] Connecting to ElevenLabs Conversational AI...')
          if (!agentId) {
            console.error('[ERROR] ELEVENLABS_AGENT_ID missing; cannot use ConvAI. Staying in TTS-only mode.')
          } else {
            const signedUrl = await getSignedConvAIUrl(agentId, elevenLabsKey)
            if (!signedUrl) {
              console.error('[ERROR] Failed to get ConvAI signed URL')
            } else {
              try {
                elevenLabsWs = new WebSocket(signedUrl)
                elevenLabsWs.onopen = () => {
                  console.log('[SUCCESS] ConvAI WebSocket connected')
                  elevenLabsConnected = true
                  if (elevenLabsWs) {
                    elevenLabsWs.send(JSON.stringify({
                      type: 'conversation_initiation_metadata',
                      conversation_config_override: {
                        audio_output: { format: 'pcm_16000', encoding: 'pcm_s16le' }
                      }
                    }))
                    console.log('[CONFIG] Sent ConvAI config for PCM16 16kHz output')
                  }
                }
                elevenLabsWs.onmessage = async (convaiEvent) => {
                  try {
                    const convaiData = JSON.parse(convaiEvent.data)
                    if (convaiData.type === 'audio') {
                      const audioBase64 = convaiData.audio_event?.audio_base_64
                      if (audioBase64) {
                        const binaryString = atob(audioBase64)
                        const pcm16Bytes = new Uint8Array(binaryString.length)
                        for (let i = 0; i < binaryString.length; i++) pcm16Bytes[i] = binaryString.charCodeAt(i)
                        const pcm16Samples = new Int16Array(pcm16Bytes.buffer)
                        const pcm8kSamples = new Int16Array(Math.floor(pcm16Samples.length / 2))
                        for (let i = 0; i < pcm8kSamples.length; i++) pcm8kSamples[i] = pcm16Samples[i * 2]
                        const ulawBytes = new Uint8Array(pcm8kSamples.length)
                        for (let i = 0; i < pcm8kSamples.length; i++) ulawBytes[i] = pcmToMulaw(pcm8kSamples[i])
                        const chunks: Uint8Array[] = []
                        for (let i = 0; i < ulawBytes.length; i += 160) {
                          const chunk = new Uint8Array(160)
                          const len = Math.min(160, ulawBytes.length - i)
                          chunk.set(ulawBytes.subarray(i, i + len), 0)
                          if (len < 160) for (let j = len; j < 160; j++) chunk[j] = 0xff
                          chunks.push(chunk)
                        }
                        await sendAudioToTwilio(chunks, streamSid, socket)
                        console.log(`[CONVERT] ConvAI ${pcm16Samples.length}->${ulawBytes.length} samples, ${chunks.length} chunks`)
                      }
                    } else if (convaiData.type === 'conversation_started') {
                      console.log('[SUCCESS] ConvAI conversation started')
                      conversationStarted = true
                    } else {
                      console.log(`[CONVAI] ConvAI event: ${convaiData.type}`)
                    }
                  } catch (parseError) {
                    console.error('[ERROR] Error parsing ConvAI message:', parseError)
                  }
                }
                elevenLabsWs.onerror = (error) => {
                  console.error('[ERROR] ConvAI WebSocket error:', error)
                  elevenLabsConnected = false
                }
                elevenLabsWs.onclose = (event) => {
                  console.log(`[WS] ConvAI WebSocket closed: ${event.code} ${event.reason}`)
                  elevenLabsConnected = false
                }
              } catch (wsError) {
                console.error('[ERROR] Failed to create ConvAI WebSocket:', wsError)
              }
            }
          }
        } else {
          console.log('[MODE] TTS-only mode active (TWILIO_USE_AGENT_AUDIO=false)')
        }
      }
      
      else if (data.event === 'media' && data.media?.payload) {
        // Incoming audio from caller
        const binaryString = atob(data.media.payload);
        const mulawBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          mulawBytes[i] = binaryString.charCodeAt(i);
        }
        if (fallbackActive) {
          fallbackBuffer.push(mulawBytes);
          return;
        }
        // Forward to ConvAI agent (if enabled)
        if (USE_CONVAI && elevenLabsConnected && conversationStarted && elevenLabsWs) {
          try {
            // Convert μ-law 8kHz to PCM16 16kHz for ConvAI
            const pcm16Bytes = convertMulawToPcm16(mulawBytes);
            let binary = '';
            for (let i = 0; i < pcm16Bytes.length; i++) {
              binary += String.fromCharCode(pcm16Bytes[i]);
            }
            const audioBase64 = btoa(binary);
            elevenLabsWs.send(JSON.stringify({
              type: 'user_audio_chunk',
              chunk: audioBase64
            }));
            if (Math.random() < 0.01) {
              console.log(`[AUDIO_FORWARD] Forwarded ${mulawBytes.length}->${pcm16Bytes.length} bytes to ConvAI`);
            }
          } catch (audioError) {
            console.error('[ERROR] Error forwarding audio to ConvAI:', audioError);
          }
        } else if (!USE_CONVAI) {
          // TTS-only conversational loop: buffer frames, segment on silence, transcribe + reply
          try {
            ttsFramesBuffer.push(mulawBytes)
            if (isUlawSilence(mulawBytes)) {
              consecutiveSilenceFrames++
            } else {
              consecutiveSilenceFrames = 0
            }
            const haveSpeech = ttsFramesBuffer.length >= 20 // ~400ms
            const endOfUtterance = consecutiveSilenceFrames >= 30 // ~600ms silence
            const maxBufferReached = ttsFramesBuffer.length >= 400 // safety ~8s
            if (haveSpeech && (endOfUtterance || maxBufferReached) && !ttsProcessing && !isSpeaking) {
              ttsProcessing = true
              const framesToProcess = ttsFramesBuffer
              ttsFramesBuffer = []
              consecutiveSilenceFrames = 0
              ;(async () => {
                try {
                  const pcm16 = ulawFramesToPcm16(framesToProcess)
                  const wav = encodeWavFromPcm16(pcm16, 8000)
                  const transcript = await transcribeWithWhisper(wav)
                  if (!transcript) {
                    console.log('[TTS_ONLY] Empty transcript; skipping reply')
                    return
                  }
                  const reply = await generateReplyWithChatGPT(transcript, businessName)
                  const safeReply = reply?.trim() || "I'm sorry, could you please repeat that?"
                  isSpeaking = true
                  const chunks = await ttsTextToUlawChunks(safeReply)
                  if (chunks.length > 0) {
                    await sendAudioToTwilio(chunks, streamSid, socket)
                    await waitForQueueDrain(15000)
                  }
                } catch (e) {
                  console.error('[TTS_ONLY] Error processing speech:', e)
                } finally {
                  isSpeaking = false
                  ttsProcessing = false
                }
              })()
            }
          } catch (e) {
            console.error('[TTS_ONLY] Error buffering media:', e)
          }
        }
      }
      
      else if (data.event === 'stop') {
        console.log('[STOP] Stream stopped')
        if (elevenLabsWs) {
          elevenLabsWs.close()
          elevenLabsWs = null
        }
        elevenLabsConnected = false
        conversationStarted = false
        // Fallback pipeline
        if (fallbackActive && fallbackBuffer.length > 0) {
          try {
            // 1. Concatenate all μ-law audio
            const allMulaw = new Uint8Array(fallbackBuffer.reduce((acc, arr) => acc + arr.length, 0));
            let offset = 0;
            for (const arr of fallbackBuffer) {
              allMulaw.set(arr, offset);
              offset += arr.length;
            }
            // 2. Convert to PCM16 8kHz
            const pcm8k = new Int16Array(allMulaw.length);
            for (let i = 0; i < allMulaw.length; i++) {
              pcm8k[i] = mulawToPcm(allMulaw[i]);
            }
            // 3. Encode as WAV (PCM16 8kHz mono)
            function encodeWav(samples, sampleRate) {
              const header = new ArrayBuffer(44);
              const view = new DataView(header);
              view.setUint32(0, 0x52494646, false); // "RIFF"
              view.setUint32(4, 36 + samples.length * 2, true);
              view.setUint32(8, 0x57415645, false); // "WAVE"
              view.setUint32(12, 0x666d7420, false); // "fmt "
              view.setUint32(16, 16, true);
              view.setUint16(20, 1, true);
              view.setUint16(22, 1, true);
              view.setUint32(24, sampleRate, true);
              view.setUint32(28, sampleRate * 2, true);
              view.setUint16(32, 2, true);
              view.setUint16(34, 16, true);
              view.setUint32(36, 0x64617461, false); // "data"
              view.setUint32(40, samples.length * 2, true);
              const wav = new Uint8Array(44 + samples.length * 2);
              wav.set(new Uint8Array(header), 0);
              for (let i = 0; i < samples.length; i++) {
                wav[44 + i * 2] = samples[i] & 0xff;
                wav[44 + i * 2 + 1] = (samples[i] >> 8) & 0xff;
              }
              return wav;
            }
            const wavBytes = encodeWav(pcm8k, 8000);
            // 4. Transcribe with Whisper API
            const openaiKey = Deno.env.get('OPENAI_API_KEY');
            let transcript = '';
            if (openaiKey) {
              const form = new FormData();
              form.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'audio.wav');
              form.append('model', 'whisper-1');
              const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${openaiKey}` },
                body: form
              });
              if (resp.ok) {
                const json = await resp.json();
                transcript = json.text || '';
                console.log('[WHISPER] Transcript:', transcript);
              } else {
                console.error('[WHISPER] Transcription failed:', await resp.text());
              }
            }
            // 5. Generate response with ChatGPT
            let reply = '';
            if (openaiKey && transcript) {
              const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'gpt-3.5-turbo',
                  messages: [
                    { role: 'system', content: `You are a helpful AI receptionist for ${businessName}.` },
                    { role: 'user', content: transcript }
                  ]
                })
              });
              if (chatResp.ok) {
                const json = await chatResp.json();
                reply = json.choices?.[0]?.message?.content || '';
                console.log('[CHATGPT] Reply:', reply);
              } else {
                console.error('[CHATGPT] Generation failed:', await chatResp.text());
              }
            }
            // 6. Synthesize with ElevenLabs TTS if available
            let ttsAudio = null;
            const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY');
            const agentId = Deno.env.get('ELEVENLABS_AGENT_ID');
            if (elevenLabsKey && agentId) {
              const ttsResp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + agentId, {
                method: 'POST',
                headers: {
                  'xi-api-key': elevenLabsKey,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  text: reply,
                  voice_settings: { stability: 0.5, similarity_boost: 0.7 },
                  output_format: 'pcm_16000'
                })
              });
              if (ttsResp.ok) {
                const arrayBuffer = await ttsResp.arrayBuffer();
                const pcm16 = new Int16Array(arrayBuffer);
                const pcm8k = new Int16Array(Math.floor(pcm16.length / 2));
                for (let i = 0; i < pcm8k.length; i++) {
                  pcm8k[i] = pcm16[i * 2];
                }
                const ulawBytes = new Uint8Array(pcm8k.length);
                for (let i = 0; i < pcm8k.length; i++) {
                  ulawBytes[i] = pcmToMulaw(pcm8k[i]);
                }
                ttsAudio = ulawBytes;
              } else {
                console.error('[TTS] Synthesis failed:', await ttsResp.text());
              }
            }
            // 7. Stream TTS audio back to Twilio
            if (ttsAudio) {
              const chunks = [];
              for (let i = 0; i < ttsAudio.length; i += 160) {
                const chunk = new Uint8Array(160);
                const len = Math.min(160, ttsAudio.length - i);
                chunk.set(ttsAudio.subarray(i, i + len), 0);
                if (len < 160) chunk.fill(0xff, len);
                chunks.push(chunk);
              }
              await sendAudioToTwilio(chunks, streamSid, socket);
              console.log('[FALLBACK] Sent TTS audio to Twilio');
            } else if (reply) {
              socket.send(JSON.stringify({ event: 'say', text: reply }));
              console.log('[FALLBACK] Sent <Say> text to Twilio');
            }
          } catch (fallbackError) {
            console.error('[FALLBACK] Error in fallback pipeline:', fallbackError);
          }
        }
      }
      
    } catch (error) {
      console.error('[ERROR] Error processing Twilio event:', error)
    }
  }
  
  socket.onerror = (error) => {
    console.error('[ERROR] Twilio WebSocket error:', error)
  }
  
  socket.onclose = (event) => {
    console.log(`[WS] Twilio WebSocket closed: ${event.code} ${event.reason}`)
    if (elevenLabsWs) {
      elevenLabsWs.close()
      elevenLabsWs = null
    }
    elevenLabsConnected = false
    conversationStarted = false
  }
  
  return response
})
