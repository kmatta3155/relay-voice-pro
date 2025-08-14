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
  try {
    if (!XI_KEY) throw new Error("Missing ELEVENLABS_API_KEY secret.");
    const bodyIn = await req.json();
    // Accept both `format` and `output_format` from client; prefer `output_format`.
    const {
      text,
      voiceId,
      modelId = DEFAULT_MODEL,
      output_format,
      format,
      voice_settings,
    } = bodyIn || {};
    if (!text || !voiceId) throw new Error("Missing text or voiceId");

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

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": XI_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);

    const buf = new Uint8Array(await r.arrayBuffer());
    return new Response(
      JSON.stringify({
        audioBase64: toBase64(buf),
        contentType: elevenFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 400 });
  }
});