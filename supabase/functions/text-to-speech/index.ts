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

    // Convert directly to base64 using built-in browser API
    // This is the correct way to handle binary audio data
    const uint8Array = new Uint8Array(audioBuffer)
    
    // Use TextDecoder for proper binary to base64 conversion
    let binary = ''
    const len = uint8Array.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    
    const base64Audio = btoa(binary)
    console.log(`Base64 audio created successfully, length: ${base64Audio.length}`)
    
    // Validate the base64
    try {
      atob(base64Audio.substring(0, 100)) // Test decode a small portion
      console.log('Base64 validation passed')
    } catch (e) {
      console.error('Base64 validation failed:', e)
      throw new Error('Generated base64 is invalid')
    }

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