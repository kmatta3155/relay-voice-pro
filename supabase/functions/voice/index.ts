/*
  ElevenLabs TTS proxy for the Demo page (keeps your key server-side)

  Supabase → Project Settings → Functions → Secrets:
    ELEVENLABS_API_KEY = <your_service_account_key>
    ELEVEN_MODEL_ID    = eleven_flash_v2_5   (optional; default below)

  Deploy:
    supabase functions deploy voice
*/
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const XI_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const DEFAULT_MODEL = Deno.env.get("ELEVEN_MODEL_ID") ?? "eleven_multilingual_v2";

function toBase64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // deno-lint-ignore no-explicit-any
  return (btoa as any)(s);
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("OK");
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Voice function called");
    
    if (!XI_KEY) {
      console.error("Missing ELEVENLABS_API_KEY secret");
      throw new Error("Missing ELEVENLABS_API_KEY secret. Please configure it in Supabase Functions secrets.");
    }
    
    const bodyIn = await req.json();
    console.log("Request body:", JSON.stringify(bodyIn, null, 2));
    
    // Accept both `format` and `output_format` from client; prefer `output_format`.
    const {
      text,
      voiceId,
      modelId = DEFAULT_MODEL,
      output_format,
      format,
      voice_settings,
    } = bodyIn || {};
    
    if (!text || !voiceId) {
      console.error("Missing required fields:", { text: !!text, voiceId: !!voiceId });
      throw new Error("Missing text or voiceId");
    }
    
    console.log(`Processing TTS: voice=${voiceId}, model=${modelId}, text="${text.slice(0, 50)}..."`);
    
    // Validate voice ID format (should be alphanumeric, ~20 chars)
    if (!/^[a-zA-Z0-9]{15,25}$/.test(voiceId)) {
      console.warn("Voice ID format looks suspicious:", voiceId);
    }

    // Map our friendly formats to ElevenLabs output_format
    const fmt = (output_format || format || "mp3") as string;
    const elevenFormat =
      fmt === "ulaw_8000" ? "ulaw_8000" : "mp3_44100_128"; // mp3 for browser; u-law for PSTN realism

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
    const requestBody = {
      text,
      model_id: modelId,
      output_format: elevenFormat,
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.85,
        style: 0.25,
        use_speaker_boost: true,
        ...voice_settings,
      },
    };

    console.log("Calling ElevenLabs API:", url);
    console.log("Request body:", JSON.stringify(requestBody, null, 2));
    
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });
    
    console.log(`ElevenLabs response: ${r.status} ${r.statusText}`);
    
    if (!r.ok) {
      const errorText = await r.text();
      console.error(`ElevenLabs API error: ${r.status} - ${errorText}`);
      throw new Error(`ElevenLabs ${r.status}: ${errorText}`);
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    console.log(`Audio buffer received: ${buf.length} bytes`);
    
    const response = {
      audioBase64: toBase64(buf),
      contentType: elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
    };
    
    console.log(`Returning audio, base64 length: ${response.audioBase64.length}`);
    
    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Voice function error:", e);
    const errorMessage = String(e?.message ?? e);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});