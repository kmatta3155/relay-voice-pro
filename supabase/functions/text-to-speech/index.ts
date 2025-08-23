import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, voice_id } = await req.json()

    if (!text) {
      throw new Error('Text is required')
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured')
    }

    console.log(`Generating TTS for: "${text.substring(0, 50)}..." with OpenAI`)

    // Generate speech using OpenAI TTS
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice_id || 'alloy',
        response_format: 'mp3',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI TTS API error:', errorText)
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    // Get the audio as array buffer
    const audioBuffer = await response.arrayBuffer()
    console.log(`Generated audio buffer: ${audioBuffer.byteLength} bytes`)

    // Convert to base64 using TextDecoder and btoa properly
    const uint8Array = new Uint8Array(audioBuffer)
    let binaryString = ''
    
    // Process in smaller chunks to avoid stack overflow
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize)
      binaryString += String.fromCharCode.apply(null, Array.from(chunk))
    }
    
    const base64Audio = btoa(binaryString)
    console.log(`Base64 audio length: ${base64Audio.length} characters`)

    return new Response(
      JSON.stringify({ 
        audioContent: base64Audio,
        contentType: 'audio/mpeg',
        size: audioBuffer.byteLength
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('TTS Error:', error.message)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Text-to-speech generation failed'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})