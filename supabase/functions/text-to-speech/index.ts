import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { text, voice_id } = await req.json();

    if (!text || typeof text !== 'string') {
      throw new Error('Valid text is required');
    }

    if (text.length > 5000) {
      throw new Error('Text too long (max 5000 characters)');
    }

    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Use professional, human-like voices with better settings
    const voiceId = voice_id || 'EXAVITQu4vr4xnSDxMaL'; // Sarah - professional female voice

    console.log(`Generating TTS for: "${text.substring(0, 50)}..." with voice: ${voiceId}`);

    // Generate speech using ElevenLabs API with enhanced settings
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2', // Best quality model
        voice_settings: {
          stability: 0.4,        // More natural variation
          similarity_boost: 0.8, // Higher similarity to original voice
          style: 0.2,           // Slight style enhancement
          use_speaker_boost: true
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('ElevenLabs API error:', response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    // Convert audio to base64 with better error handling
    const arrayBuffer = await response.arrayBuffer();
    
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Empty audio response from ElevenLabs');
    }

    console.log(`Generated audio: ${arrayBuffer.byteLength} bytes`);

    // Convert to base64 in chunks to avoid memory issues
    const uint8Array = new Uint8Array(arrayBuffer);
    let base64Audio = '';
    const chunkSize = 0x8000; // 32KB chunks
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      base64Audio += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    }

    return new Response(
      JSON.stringify({ 
        audioContent: base64Audio,
        contentType: 'audio/mpeg'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('TTS Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});