import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const XI_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const DEFAULT_MODEL = Deno.env.get("ELEVEN_MODEL_ID") ?? "eleven_flash_v2_5";

// Optimized base64 encoding for large audio files
function toBase64(buffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192; // Process in chunks to avoid call stack limits
  
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

async function listVoices() {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": XI_KEY! },
  });
  if (!r.ok) throw new Error(`ElevenLabs voices ${r.status}: ${await r.text()}`);
  const json = await r.json();
  // Normalize essentials
  const voices = (json?.voices ?? []).map((v: any) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    language: v.labels?.accent || v.labels?.language || v.language || "",
    labels: v.labels ?? {},
    preview_url: v.preview_url ?? null,
  }));
  return voices;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!XI_KEY) {
      console.error("Missing ELEVENLABS_API_KEY");
      throw new Error("Missing ELEVENLABS_API_KEY secret.");
    }

    const body = await req.json();
    console.log("Request body:", JSON.stringify(body, null, 2));

    // MULTI-ACTION ENTRYPOINT
    if (body?.action === "list_voices") {
      console.log("Listing voices...");
      const voices = await listVoices();
      return new Response(JSON.stringify({ voices }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      text,
      voiceId,
      modelId = DEFAULT_MODEL,
      output_format,
      format,
      voice_settings,
    } = body || {};

    if (!text || !voiceId) {
      console.error("Missing required parameters:", { text: !!text, voiceId: !!voiceId });
      throw new Error("Missing text or voiceId");
    }

    console.log(`Generating TTS for: "${text.slice(0, 50)}..." with voice: ${voiceId}`);

    const fmt = (output_format || format || "mp3") as "mp3" | "ulaw_8000";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
    const payload = {
      text,
      model_id: modelId,
      output_format: fmt === "mp3" ? "mp3_44100_128" : "ulaw_8000",
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.7,
        style: 0.15,
        ...(voice_settings || {}),
      },
    };

    console.log("Calling ElevenLabs API with payload:", JSON.stringify(payload, null, 2));

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        Accept: fmt === "mp3" ? "audio/mpeg" : "audio/basic",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errorText = await r.text();
      console.error(`ElevenLabs API error ${r.status}: ${errorText}`);
      throw new Error(`ElevenLabs ${r.status}: ${errorText}`);
    }

    console.log("Successfully received audio from ElevenLabs");
    const arrayBuffer = await r.arrayBuffer();
    console.log(`Audio buffer size: ${arrayBuffer.byteLength} bytes`);
    
    const audioBase64 = toBase64(arrayBuffer);
    const contentType = fmt === "mp3" ? "audio/mpeg" : "audio/basic";
    
    console.log(`Generated base64 audio: ${audioBase64.length} characters`);

    return new Response(
      JSON.stringify({ audioBase64, contentType }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (e) {
    console.error("Edge function error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }), 
      { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});