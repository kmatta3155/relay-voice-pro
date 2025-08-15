/*
  ElevenLabs TTS proxy for the Demo page (keeps your key server-side)

  Supabase → Project Settings → Functions → Secrets:
    ELEVENLABS_API_KEY = <your_service_account_key>
    ELEVEN_MODEL_ID    = eleven_flash_v2_5   (optional)

  Deploy:
    supabase functions deploy voice
*/
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const XI_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const ENV_MODEL = Deno.env.get("ELEVEN_MODEL_ID");
const DEFAULT_MODEL = ENV_MODEL || "eleven_multilingual_v2";
const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"; // safe default

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
  // Always handle CORS preflight FIRST
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    if (!XI_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing ELEVENLABS_API_KEY secret. Configure it in Supabase Functions secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bodyIn = await req.json();
    // Accept legacy names from the working version
    const text = bodyIn?.text;
    const voiceId = bodyIn?.voiceId || bodyIn?.voice || DEFAULT_VOICE;
    const modelId = bodyIn?.modelId || bodyIn?.model || DEFAULT_MODEL;
    const clientFmt = (bodyIn?.output_format || bodyIn?.format || "mp3") as string;

    if (!text) throw new Error("Missing text");
    if (!voiceId) throw new Error("Missing voiceId/voice");

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
      output_format: elevenFormat, // <-- ensure server returns the format we expect
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        "Accept": elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });

    if (!r.ok) {
      const errorText = await r.text();
      throw new Error(`ElevenLabs ${r.status}: ${errorText}`);
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    const response = {
      audioBase64: toBase64(buf),
      contentType: elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMessage = String(e?.message ?? e);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
