/*
  ElevenLabs TTS proxy - NEW FUNCTION NAME to force fresh environment
  Updated: Creating tts-voice function to bypass caching issues
  
  Supabase → Project Settings → Functions → Secrets:
    ELEVENLABS_API_KEY = <your_service_account_key>
*/
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function toBase64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // deno-lint-ignore no-explicit-any
  return (btoa as any)(s);
}

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] NEW TTS FUNCTION - Method:`, req.method);
  
  // Always handle CORS preflight FIRST
  if (req.method === "OPTIONS") {
    console.log(`[${requestId}] Handling CORS preflight`);
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.log(`[${requestId}] Non-POST request, returning OK`);
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    // Step 1: Environment Variable Analysis
    const allEnvVars = Object.keys(Deno.env.toObject());
    const XI_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    console.log(`[${requestId}] NEW FUNCTION Environment Analysis:`);
    console.log(`[${requestId}] - Total env vars: ${allEnvVars.length}`);
    console.log(`[${requestId}] - All env vars:`, allEnvVars);
    console.log(`[${requestId}] - ELEVENLABS_API_KEY exists: ${!!XI_KEY}`);
    console.log(`[${requestId}] - ELEVENLABS_API_KEY length: ${XI_KEY ? XI_KEY.length : 0}`);
    
    if (XI_KEY) {
      console.log(`[${requestId}] - API Key first 8 chars: ${XI_KEY.slice(0, 8)}`);
      console.log(`[${requestId}] - API Key last 8 chars: ${XI_KEY.slice(-8)}`);
    }
    
    // Step 2: Critical Check - API Key Validation
    if (!XI_KEY || XI_KEY.trim() === '') {
      console.error(`[${requestId}] CRITICAL: ELEVENLABS_API_KEY is missing or empty in NEW FUNCTION`);
      
      return new Response(
        JSON.stringify({ 
          error: "ELEVENLABS_API_KEY secret is missing or empty in new function",
          debug: {
            requestId,
            functionName: "tts-voice",
            hasKey: !!XI_KEY,
            keyLength: XI_KEY ? XI_KEY.length : 0,
            envVarsCount: allEnvVars.length,
            allEnvVars: allEnvVars,
            timestamp: new Date().toISOString()
          }
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] NEW FUNCTION: API Key found successfully!`);

    // Step 3: Test ElevenLabs API Key
    console.log(`[${requestId}] Testing ElevenLabs API key...`);
    const testResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': XI_KEY,
      },
    });
    
    console.log(`[${requestId}] ElevenLabs API test response status: ${testResponse.status}`);
    
    if (!testResponse.ok) {
      const testError = await testResponse.text();
      console.error(`[${requestId}] ElevenLabs API key test failed:`, testError);
      
      return new Response(
        JSON.stringify({ 
          error: "ElevenLabs API key validation failed",
          debug: {
            requestId,
            functionName: "tts-voice",
            apiTestStatus: testResponse.status,
            apiTestError: testError,
            timestamp: new Date().toISOString()
          }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[${requestId}] NEW FUNCTION: ElevenLabs API key validation successful!`);
    
    // Step 4: Process TTS Request
    const bodyIn = await req.json();
    console.log(`[${requestId}] Request body:`, JSON.stringify(bodyIn, null, 2));
    
    const text = bodyIn?.text;
    const voiceId = bodyIn?.voiceId || bodyIn?.voice || "ZIlrSGI4jZqobxRKprJz"; // Sarah
    const modelId = bodyIn?.modelId || bodyIn?.model || "eleven_multilingual_v2";
    const clientFmt = (bodyIn?.output_format || bodyIn?.format || "mp3") as string;

    console.log(`[${requestId}] Parsed params:`, { 
      textPreview: text?.substring(0, 50), 
      voiceId, 
      modelId, 
      clientFmt 
    });

    if (!text || text.trim() === '') {
      throw new Error("Missing or empty text");
    }

    // Map friendly → ElevenLabs API formats
    const elevenFormat = clientFmt === "ulaw_8000" ? "ulaw_8000" : "mp3_44100_128";

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const requestBody = {
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.85,
        style: 0.25,
        use_speaker_boost: true,
        ...(bodyIn?.voice_settings || {}),
      },
      output_format: elevenFormat,
    };

    console.log(`[${requestId}] Making TTS request to:`, url);

    const ttsResponse = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        "Accept": elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[${requestId}] TTS response status:`, ttsResponse.status);

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error(`[${requestId}] TTS request failed:`, errorText);
      throw new Error(`ElevenLabs TTS ${ttsResponse.status}: ${errorText}`);
    }

    const audioBuffer = new Uint8Array(await ttsResponse.arrayBuffer());
    console.log(`[${requestId}] NEW FUNCTION SUCCESS! Audio buffer size:`, audioBuffer.length);
    
    const response = {
      audioBase64: toBase64(audioBuffer),
      contentType: elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
      debug: {
        requestId,
        functionName: "tts-voice",
        audioBufferSize: audioBuffer.length,
        format: elevenFormat,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`[${requestId}] NEW FUNCTION: Returning audio response, base64 length:`, response.audioBase64.length);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (e) {
    const errorMessage = String(e?.message ?? e);
    console.error(`[${requestId}] NEW FUNCTION error:`, errorMessage);
    console.error(`[${requestId}] Full error:`, e);
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      debug: {
        requestId,
        functionName: "tts-voice",
        hasApiKey: !!Deno.env.get("ELEVENLABS_API_KEY"),
        timestamp: new Date().toISOString(),
        stack: e?.stack
      }
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});