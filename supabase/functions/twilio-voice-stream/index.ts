import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// WAV parsing utilities
function findChunk(bytes: Uint8Array, fourcc: string, start = 12): number {
  for (let i = start; i < bytes.length - 8; ) {
    const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    const size = (bytes[i + 4]) | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)
    if (id === fourcc) return i
    i += 8 + size + (size % 2) // chunks are word aligned
  }
  return -1
}

function parseWav(wavBytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; pcm: Int16Array } {
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  // Basic RIFF/WAVE check
  const riff = String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3])
  const wave = String.fromCharCode(wavBytes[8], wavBytes[9], wavBytes[10], wavBytes[11])
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Invalid WAV header')

  const fmtIdx = findChunk(wavBytes, 'fmt ')
  if (fmtIdx < 0) throw new Error('fmt chunk not found')
  const audioFormat = view.getUint16(fmtIdx + 8, true)
  const channels = view.getUint16(fmtIdx + 10, true)
  const sampleRate = view.getUint32(fmtIdx + 12, true)
  const bitsPerSample = view.getUint16(fmtIdx + 22, true)
  if (audioFormat !== 1 || bitsPerSample !== 16) throw new Error('Only PCM16 supported')

  const dataIdx = findChunk(wavBytes, 'data')
  if (dataIdx < 0) throw new Error('data chunk not found')
  const dataSize = view.getUint32(dataIdx + 4, true)
  const dataStart = dataIdx + 8
  const samples = new Int16Array(wavBytes.buffer, wavBytes.byteOffset + dataStart, dataSize / 2)

  // Downmix to mono if needed
  let mono: Int16Array
  if (channels === 1) {
    mono = new Int16Array(samples)
  } else {
    const frames = Math.floor(samples.length / channels)
    mono = new Int16Array(frames)
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += samples[i * channels + c]
      mono[i] = (sum / channels) | 0
    }
  }

  return { sampleRate, channels, bitsPerSample, pcm: mono }
}

function resamplePcm16(src: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return new Int16Array(src)
  const ratio = toRate / fromRate
  const dstLen = Math.floor(src.length * ratio)
  const dst = new Int16Array(dstLen)
  for (let i = 0; i < dstLen; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = srcPos - i0
    const sample = (1 - frac) * src[i0] + frac * src[i1]
    dst[i] = sample | 0
  }
  return dst
}

// 16-bit linear PCM to μ-law
function linearToMulaw(pcm: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  let sign = 0
  if (pcm < 0) { sign = 0x80; pcm = -pcm }
  pcm += BIAS
  if (pcm > CLIP) pcm = CLIP
  let exponent = 7
  for (let expLut = 0x4000; (pcm & ~expLut) === 0 && exponent > 0; expLut >>= 1) exponent--
  const mantissa = (pcm >> (exponent + 3)) & 0x0F
  return (~(sign | (exponent << 4) | mantissa)) & 0xFF
}

function pcm16ToMulawBytes(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = linearToMulaw(pcm[i])
  return out
}

async function ttsToMulawChunks(text: string): Promise<Uint8Array[]> {
  // Get WAV from OpenAI TTS
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', input: text, voice: 'alloy', response_format: 'wav' }),
  })
  if (!resp.ok) throw new Error(`TTS failed: ${await resp.text()}`)
  const wavBytes = new Uint8Array(await resp.arrayBuffer())

  const { sampleRate, pcm } = parseWav(wavBytes)
  // Resample to 8kHz for Twilio Media Streams
  const pcm8k = resamplePcm16(pcm, sampleRate, 8000)
  const mulaw = pcm16ToMulawBytes(pcm8k)

  // Split into 20ms chunks => 160 samples at 8kHz
  const CHUNK = 160
  const chunks: Uint8Array[] = []
  for (let i = 0; i < mulaw.length; i += CHUNK) {
    chunks.push(mulaw.subarray(i, Math.min(i + CHUNK, mulaw.length)))
  }
  return chunks
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  // deno-lint-ignore no-explicit-any
  return (btoa as any)(binary)
}

async function sendMulawChunksOverTwilio(chunks: Uint8Array[], streamSid: string, socket: WebSocket) {
  for (const bytes of chunks) {
    const payload = base64FromBytes(bytes)
    const media = { event: 'media', streamSid, media: { payload } }
    socket.send(JSON.stringify(media))
    await new Promise((r) => setTimeout(r, 20)) // 20ms pacing
  }
}

serve(async (req) => {
  console.log('🎵 VOICE STREAM FUNCTION CALLED')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 })
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(req)

    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    const callSid = url.searchParams.get('call_sid')
    console.log('📋 Parameters:', { tenantId, callSid })

    let streamSid = ''

    socket.onopen = () => {
      console.log('✅ WebSocket opened successfully!')
    }

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        const evt = data.event
        if (!evt) return
        console.log('📨 Event from Twilio:', evt)

        if (evt === 'connected') {
          console.log('🔌 Twilio connected')
        }

        if (evt === 'start') {
          streamSid = data.start?.streamSid || data.streamSid
          console.log('▶️ Stream started. streamSid=', streamSid)

          // Send a protocol-valid mark event
          socket.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'greeting_start' } }))

          // Generate greeting via TTS -> WAV -> 8kHz PCM -> μ-law -> 20ms chunks
          const greeting = "Hello! You're connected to the AI receptionist. How can I help you today?"
          try {
            const chunks = await ttsToMulawChunks(greeting)
            await sendMulawChunksOverTwilio(chunks, streamSid, socket)
            console.log(`🎤 Sent greeting in ${chunks.length} chunks`)
          } catch (e) {
            console.error('TTS pipeline failed:', e)
          }

          socket.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'greeting_done' } }))
        }

        if (evt === 'media') {
          // We receive caller μ-law audio here as base64 in data.media.payload
          // For now, just acknowledge with a mark to keep the stream alive during testing
          if (data.media?.payload) {
            // no-op
          }
        }

        if (evt === 'stop') {
          console.log('🛑 Stream stopped')
        }
      } catch (err) {
        console.error('❌ Error handling message:', err)
        console.error('Raw:', event.data)
      }
    }

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    socket.onclose = (event) => {
      console.log('🔒 WebSocket closed:', event.code, event.reason)
    }

    return response
  } catch (error) {
    console.error('❌ Error setting up WebSocket:', error)
    return new Response('WebSocket upgrade failed', { status: 500 })
  }
})
