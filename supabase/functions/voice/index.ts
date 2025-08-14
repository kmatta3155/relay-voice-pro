// ===============================================
// FILE: supabase/functions/voice/index.ts
// (Supabase Edge Function – ElevenLabs proxy + voice listing)
// ===============================================
// SECRETS (Supabase → Project Settings → Functions → Secrets):
//   ELEVENLABS_API_KEY = <your_eleven_labs_key>
// OPTIONAL:
//   ELEVEN_MODEL_ID = eleven_flash_v2_5
//
// Deploy:
// supabase functions deploy voice
// supabase secrets set ELEVENLABS_API_KEY=xxxxx ELEVEN_MODEL_ID=eleven_flash_v2_5
// -----------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const XI_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const DEFAULT_MODEL = Deno.env.get("ELEVEN_MODEL_ID") ?? "eleven_flash_v2_5";

function toBase64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // deno-lint-ignore no-explicit-any
  return (btoa as any)(s);
}

async function listVoices() {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": XI_KEY },
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
  if (req.method !== "POST") return new Response("OK");
  try {
    if (!XI_KEY) throw new Error("Missing ELEVENLABS_API_KEY secret.");
    const body = await req.json();

    // MULTI-ACTION ENTRYPOINT
    if (body?.action === "list_voices") {
      const voices = await listVoices();
      return new Response(JSON.stringify({ voices }), {
        headers: { "Content-Type": "application/json" },
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

    if (!text || !voiceId) throw new Error("Missing text or voiceId");

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

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        Accept: fmt === "mp3" ? "audio/mpeg" : "audio/basic",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);

    const buf = new Uint8Array(await r.arrayBuffer());
    const contentType = fmt === "mp3" ? "audio/mpeg" : "audio/basic";
    return new Response(
      JSON.stringify({ audioBase64: toBase64(buf), contentType }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 400 });
  }
});