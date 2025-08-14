// ===============================================
// FILE: src/pages/Demo.tsx
// (Marketing-grade Voice Demo with Waveform + Voice picker)
// ===============================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// =====================
// Voice config (names → recommended roles)
// =====================
// We'll auto-map these **names** to real voice IDs from your ElevenLabs account.
// If a name isn't found, we'll pick a close language fallback.
const RECOMMENDED_NAMES = {
  // Receptionist voices (neutral, clear)
  ai_en: "Rachel",     // EN receptionist
  ai_es: "Sofia",      // ES receptionist
  ai_fr: "Antoine",    // FR receptionist
  ai_pt: "Camila",     // PT receptionist

  // Callers (contrast in timbre)
  caller_f: "Bella",   // EN female caller
  caller_m: "Adam",    // EN male caller
  caller_es: "Elena",  // ES caller
  caller_fr: "Isabelle", // FR caller
  caller_pt: "Bruno",  // PT caller
} as const;

// Fall-back placeholder (used only if we can't find a voice yet)
const DEFAULT_VOICES: Record<keyof typeof RECOMMENDED_NAMES, string> = {
  ai_en: "VOICE_ID_AI_EN",
  ai_es: "VOICE_ID_AI_ES",
  ai_fr: "VOICE_ID_AI_FR",
  ai_pt: "VOICE_ID_AI_PT",
  caller_f: "VOICE_ID_CALLER_F",
  caller_m: "VOICE_ID_CALLER_M",
  caller_es: "VOICE_ID_CALLER_ES",
  caller_fr: "VOICE_ID_CALLER_FR",
  caller_pt: "VOICE_ID_CALLER_PT",
};

// Delivery style
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.6,
  similarity_boost: 0.7,
  style: 0.15,
};

type Line = { who: "ring" | "ai" | "caller"; text?: string; voice?: keyof typeof DEFAULT_VOICES; pause?: number };
type Scenario = { id: string; name: string; phone: string; lang: "EN"|"ES"|"BI"|"FR"|"PT"; desc: string; sub: string; lines: Line[] };

// =====================
// Scenarios (curated)
// =====================

const SCENARIO_SPA: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Thanks for calling Serenity Spa, this is your virtual receptionist. How can I help you today?", voice: "ai_en", pause: 420 },
  { who: "caller", text: "Hi! I'd like to book a ninety-minute massage for Friday afternoon, if possible.", voice: "caller_f", pause: 320 },
  { who: "ai", text: "Absolutely—Friday we have two openings, two fifteen or four thirty. Which works better?", voice: "ai_en", pause: 280 },
  { who: "caller", text: "Two fifteen, please. And can I request Maya?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "You got it—two fifteen with Maya. What's your full name and mobile number to confirm?", voice: "ai_en", pause: 260 },
  { who: "caller", text: "Jamie Patel, and my number is nine one nine, five five five, zero one nine eight.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Perfect, Jamie. You're all set for Friday at two fifteen with Maya. I'll text a confirmation and reminder.", voice: "ai_en", pause: 400 },
];

const SCENARIO_RESTAURANT_ES: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Gracias por llamar a Bella Vista. ¿En qué puedo ayudarle?", voice: "ai_es", pause: 360 },
  { who: "caller", text: "Buenas tardes. Quisiera una reserva para cuatro personas el sábado a las siete.", voice: "caller_es", pause: 280 },
  { who: "ai", text: "Con gusto. El sábado a las siete tenemos mesa disponible en la terraza. ¿Le parece bien?", voice: "ai_es", pause: 260 },
  { who: "caller", text: "Sí, perfecto. A nombre de Ana Rivera.", voice: "caller_es", pause: 260 },
  { who: "ai", text: "Reserva confirmada: cuatro personas, sábado a las siete, a nombre de Ana Rivera. Le enviaré un mensaje de confirmación. ¡Gracias!", voice: "ai_es", pause: 420 },
];

const SCENARIO_SUPPORT_BI: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Premier Services, virtual receptionist speaking. How can I help today?", voice: "ai_en", pause: 360 },
  { who: "caller", text: "Hi, my water heater stopped working this morning.", voice: "caller_m", pause: 260 },
  { who: "ai", text: "I'm sorry to hear that. I can get a technician out today. May I have your service address?", voice: "ai_en", pause: 260 },
  { who: "caller", text: "Sure, 214 Oakwood Drive in Morrisville. También hablo español si es más fácil.", voice: "caller_m", pause: 320 },
  { who: "ai", text: "Claro. ¿A qué hora le viene mejor, entre dos y cuatro de la tarde?", voice: "ai_es", pause: 260 },
  { who: "caller", text: "A las tres estaría bien. Gracias.", voice: "caller_m", pause: 260 },
  { who: "ai", text: "Agendado para las tres. Le enviaremos un mensaje con el nombre y la foto del técnico. ¡Hasta pronto!", voice: "ai_es", pause: 420 },
];

const SCENARIO_AUTO: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Thanks for calling Triangle Auto Care. This is your AI receptionist. How can I help?", voice: "ai_en", pause: 350 },
  { who: "caller", text: "Hi, my car's brakes are squealing. Can I get a quote and book a checkup?", voice: "caller_m", pause: 260 },
  { who: "ai", text: "We can do a same-day inspection. There's a forty-nine dollar diagnostic fee applied to any repair. Does two-thirty today work?", voice: "ai_en", pause: 300 },
  { who: "caller", text: "Two-thirty is good. It's a 2016 Honda Civic.", voice: "caller_m", pause: 260 },
  { who: "ai", text: "Great—two-thirty today. What's your name and number?", voice: "ai_en", pause: 260 },
  { who: "caller", text: "Marcus Lee, nine one nine, five five five, zero one one zero.", voice: "caller_m", pause: 260 },
  { who: "ai", text: "All set, Marcus. I'll text directions. Please arrive five minutes early.", voice: "ai_en", pause: 380 },
];

const SCENARIO_SALON: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Glow Studio Salon—virtual receptionist. How can I help you shine today?", voice: "ai_en", pause: 350 },
  { who: "caller", text: "Hi, I'm looking for a balayage color and a trim next week. How long does it take?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Balayage with a cut is about two hours. We have Tuesday at ten or Thursday at one. Any preference?", voice: "ai_en", pause: 300 },
  { who: "caller", text: "Thursday at one works. What's the price range?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Typically one-eighty to two-twenty depending on length. May I have your name and number to confirm?", voice: "ai_en", pause: 260 },
  { who: "caller", text: "Ana Rivera, nine eight four, five five five, zero one four two.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Thanks, Ana—booked for Thursday at one. You'll get a confirmation text and prep tips.", voice: "ai_en", pause: 380 },
];

const SCENARIO_DENTAL: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Maple Dental—virtual receptionist. How can I help?", voice: "ai_en", pause: 360 },
  { who: "caller", text: "Hi, I'm a new patient. Do you take Delta Dental PPO?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Yes, we're in-network with Delta PPO. I can schedule your cleaning and X-rays. Monday at nine or Wednesday at eleven?", voice: "ai_en", pause: 300 },
  { who: "caller", text: "Wednesday at eleven, please.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Got it. Could I have your full name and date of birth to start your chart?", voice: "ai_en", pause: 260 },
  { who: "caller", text: "Jamie Patel, January twelfth, nineteen ninety-two.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Thanks, Jamie. I'll text new-patient forms. See you Wednesday at eleven!", voice: "ai_en", pause: 380 },
];

const SCENARIO_HVAC_ES: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "ClimaPlus Soporte. ¿En qué puedo ayudarle?", voice: "ai_es", pause: 360 },
  { who: "caller", text: "Hola, el aire acondicionado no enfría y hace mucho calor.", voice: "caller_es", pause: 260 },
  { who: "ai", text: "Lo siento. Podemos enviar un técnico hoy. La visita de diagnóstico es de sesenta dólares. ¿Le sirve entre dos y cuatro de la tarde?", voice: "ai_es", pause: 300 },
  { who: "caller", text: "Sí, entre dos y cuatro está bien. La dirección es 512 Willow Street, apartamento B.", voice: "caller_es", pause: 260 },
  { who: "ai", text: "Perfecto. ¿Me confirma su nombre y teléfono?", voice: "ai_es", pause: 260 },
  { who: "caller", text: "Carlos Méndez, nueve uno nueve, cinco cinco cinco, cero cero nueve nueve.", voice: "caller_es", pause: 260 },
  { who: "ai", text: "Agendado para hoy. Recibirá un mensaje con el estado del técnico. ¡Gracias!", voice: "ai_es", pause: 420 },
];

const SCENARIO_VET: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Oak Veterinary Clinic—virtual receptionist. How can I help?", voice: "ai_en", pause: 350 },
  { who: "caller", text: "Hi, my dog needs vaccines and a wellness visit. Do you have availability this week?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Yes—Wednesday at two or Friday at nine. Which works better?", voice: "ai_en", pause: 280 },
  { who: "caller", text: "Friday at nine, please. His name is Bruno.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Booked for Friday at nine for Bruno. I'll text the intake forms now.", voice: "ai_en", pause: 380 },
];

const SCENARIO_OPTOMETRY: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "VisionPoint Optometry—virtual receptionist. How can I assist?", voice: "ai_en", pause: 350 },
  { who: "caller", text: "I need an eye exam and new contacts. Do you take VSP?", voice: "caller_m", pause: 260 },
  { who: "ai", text: "We do accept VSP. Next openings are Tuesday at one or Thursday at ten.", voice: "ai_en", pause: 280 },
  { who: "caller", text: "Thursday at ten works for me.", voice: "caller_m", pause: 260 },
  { who: "ai", text: "Great—Thursday at ten is reserved. You'll get a reminder 24 hours before your visit.", voice: "ai_en", pause: 380 },
];

const SCENARIO_REALTY: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Parkside Realty—virtual receptionist. How can I help you today?", voice: "ai_en", pause: 360 },
  { who: "caller", text: "Hi, I saw a listing on Oak Street. Is it still available for a showing this weekend?", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Yes, we can show it Saturday at eleven or Sunday at two. Which do you prefer?", voice: "ai_en", pause: 280 },
  { who: "caller", text: "Sunday at two, please.", voice: "caller_f", pause: 260 },
  { who: "ai", text: "Confirmed for Sunday at two. I'll text the address and agent contact now.", voice: "ai_en", pause: 380 },
];

const SCENARIO_CAFE_FR: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Café Lumière, réceptionniste virtuelle à l'appareil. Comment puis‑je vous aider ?", voice: "ai_fr", pause: 360 },
  { who: "caller", text: "Bonjour, prenez‑vous des réservations pour le brunch dimanche ?", voice: "caller_fr", pause: 260 },
  { who: "ai", text: "Oui, nous avons de la place à onze heures ou midi. Préférez‑vous onze heures ou midi ?", voice: "ai_fr", pause: 280 },
  { who: "caller", text: "Midi, s'il vous plaît, pour trois personnes.", voice: "caller_fr", pause: 260 },
  { who: "ai", text: "Parfait, réservation confirmée pour dimanche à midi, trois personnes. Merci et à bientôt !", voice: "ai_fr", pause: 420 },
];

const SCENARIO_HOTEL_PT: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Hotel Atlântico, recepcionista virtual. Como posso ajudar?", voice: "ai_pt", pause: 360 },
  { who: "caller", text: "Boa tarde, preciso de um quarto para duas pessoas, sexta a domingo.", voice: "caller_pt", pause: 260 },
  { who: "ai", text: "Temos disponibilidade. Prefere cama queen ou duas de solteiro?", voice: "ai_pt", pause: 280 },
  { who: "caller", text: "Cama queen, por favor.", voice: "caller_pt", pause: 260 },
  { who: "ai", text: "Reserva feita. Um e‑mail de confirmação será enviado em instantes. Obrigado!", voice: "ai_pt", pause: 420 },
];

const SCENARIOS: Scenario[] = [
  { id: "spa",         name: "Serenity Spa",          phone: "(555) 123‑RELAX",        lang: "EN", desc: "Appointment Booking", sub: "Massage booking & confirmation", lines: SCENARIO_SPA },
  { id: "restaurant",  name: "Bella Vista",           phone: "(555) 456‑DINE",         lang: "ES", desc: "Reserva (Español)",   sub: "Reserva en español", lines: SCENARIO_RESTAURANT_ES },
  { id: "support_bi",  name: "Premier Services",      phone: "(555) 789‑HELP",         lang: "BI", desc: "Support (EN↔ES)",    sub: "Bilingual service call", lines: SCENARIO_SUPPORT_BI },
  { id: "auto",        name: "Triangle Auto Care",    phone: "(555) 274‑BRAKE",        lang: "EN", desc: "Brake Inspection",    sub: "Quote + same‑day check", lines: SCENARIO_AUTO },
  { id: "salon",       name: "Glow Studio Salon",     phone: "(555) 234‑HAIR",         lang: "EN", desc: "Color Consult",       sub: "Pricing + booking", lines: SCENARIO_SALON },
  { id: "dental",      name: "Maple Dental",          phone: "(555) 350‑TEETH",        lang: "EN", desc: "New Patient",         sub: "Insurance + forms", lines: SCENARIO_DENTAL },
  { id: "hvac_es",     name: "ClimaPlus HVAC",        phone: "(555) 420‑FRIO",         lang: "ES", desc: "Emergencia A/C",      sub: "Servicio urgente", lines: SCENARIO_HVAC_ES },
  { id: "vet",         name: "Oak Vet Clinic",        phone: "(555) 900‑PETS",         lang: "EN", desc: "Wellness Visit",      sub: "Vaccines + intake", lines: SCENARIO_VET },
  { id: "optometry",   name: "VisionPoint Optometry", phone: "(555) 800‑EYES",         lang: "EN", desc: "Eye Exam + Contacts", sub: "Insurance + schedule", lines: SCENARIO_OPTOMETRY },
  { id: "realty",      name: "Parkside Realty",       phone: "(555) 700‑SHOW",         lang: "EN", desc: "Property Showing",    sub: "Weekend viewing", lines: SCENARIO_REALTY },
  { id: "cafe_fr",     name: "Café Lumière",          phone: "(+33) 01 23 45 67 89",   lang: "FR", desc: "Réservation",         sub: "Brunch en français", lines: SCENARIO_CAFE_FR },
  { id: "hotel_pt",    name: "Hotel Atlântico",       phone: "(+351) 21 234 5678",     lang: "PT", desc: "Reserva",             sub: "Quarto e confirmação", lines: SCENARIO_HOTEL_PT },
];

// =====================
// Playback + Waveform + Utilities
// =====================
class AudioQueue {
  private q: (() => Promise<void>)[] = [];
  private running = false;
  constructor(private setNow: (s: string) => void) {}
  async add(task: () => Promise<void>) { this.q.push(task); if (!this.running) this.run(); }
  private async run() {
    this.running = true;
    while (this.q.length) { const fn = this.q.shift()!; await fn(); }
    this.running = false;
    this.setNow("Idle");
  }
}

// Oscilloscope waveform
function drawWaveformLoop(canvas: HTMLCanvasElement, analyser: AnalyserNode, rafRef: { id: number | null }) {
  const ctx = canvas.getContext("2d")!;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  function draw() {
    rafRef.id = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
    ctx.beginPath();
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }
  draw();
}

async function ringOnce(ms = 1200) {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const g = ctx.createGain(); g.connect(ctx.destination); g.gain.value = 0.07;
  const o1 = ctx.createOscillator(); o1.frequency.value = 440; o1.connect(g);
  const o2 = ctx.createOscillator(); o2.frequency.value = 480; o2.connect(g);
  o1.start(); o2.start(); await new Promise((r)=> setTimeout(r, ms));
  o1.stop(); o2.stop(); g.disconnect(); ctx.close();
}

// TTS through Edge Function + visualized playback; returns last audio Blob for replay/export
async function playTTS(
  text: string,
  voiceId: string,
  voice_settings: any,
  format: "mp3" | "ulaw_8000",
  audioCtxRef: React.MutableRefObject<AudioContext | null>,
  analyserRef: React.MutableRefObject<AnalyserNode | null>,
  sourceRef: React.MutableRefObject<MediaElementAudioSourceNode | null>,
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  rafRef: React.MutableRefObject<{ id: number | null }>
): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke("voice", {
    body: { text, voiceId, voice_settings, output_format: format },
    headers: { "Content-Type": "application/json" },
  });
  if (error) throw error;

  const b64 = (data as any).audioBase64 as string;
  const contentType = (data as any).contentType as string | undefined;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: contentType || (format === "mp3" ? "audio/mpeg" : "audio/basic") } as any);
  const url = URL.createObjectURL(blob);

  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  const audio = new Audio(url);
  audio.crossOrigin = "anonymous";

  const ctx = audioCtxRef.current!;
  if (!analyserRef.current) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
  }
  if (sourceRef.current) {
    try { sourceRef.current.disconnect(); } catch {}
  }
  const src = ctx.createMediaElementSource(audio);
  sourceRef.current = src;
  src.connect(analyserRef.current!);
  analyserRef.current!.connect(ctx.destination);

  if (canvasRef.current) {
    if (rafRef.current.id) cancelAnimationFrame(rafRef.current.id);
    drawWaveformLoop(canvasRef.current, analyserRef.current!, rafRef.current);
  }

  await audio.play();
  await new Promise<void>((res) => (audio.onended = () => res()));
  URL.revokeObjectURL(url);
  return blob;
}

// =====================
// Demo Page
// =====================
export default function DemoPage() {
  const [voices, setVoices] = useState(DEFAULT_VOICES);
  const [voiceOptions, setVoiceOptions] = useState<{id:string;name:string;language:string}[]>([]);
  const [sel, setSel] = useState<Scenario>(SCENARIOS[0]);
  const [now, setNow] = useState("Idle");
  const [playing, setPlaying] = useState(false);
  const [pace, setPace] = useState(1);
  const [format, setFormat] = useState<"mp3" | "ulaw_8000">("mp3");
  const [transcript, setTranscript] = useState<{ who: string; text: string }[]>([]);
  const [kpi, setKpi] = useState({ bookings: 0, timeSavedMin: 0, csat: 4.8 });
  const [ctaShown, setCtaShown] = useState(false);
  const [progress, setProgress] = useState({ i: 0, total: 0 });
  const [lastBlobUrl, setLastBlobUrl] = useState<string | null>(null);

  const qRef = useRef<AudioQueue | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<{ id: number | null }>({ id: null });

  useEffect(()=> { qRef.current = new AudioQueue(setNow); }, []);

  // Fetch voices from ElevenLabs via the proxy
  async function fetchVoices() {
    const { data, error } = await supabase.functions.invoke("voice", {
      body: { action: "list_voices" },
      headers: { "Content-Type": "application/json" },
    });
    if (error) { console.error(error); return; }
    const opts = (data?.voices ?? []).map((v: any) => ({ id: v.id, name: v.name, language: v.language || "" }));
    setVoiceOptions(opts);
  }
  useEffect(()=> { fetchVoices(); }, []);

  function nameToId(name: string): string | null {
    const v = voiceOptions.find(v => v.name?.toLowerCase() === name.toLowerCase());
    return v?.id ?? null;
  }

  async function useRecommended() {
    // Try to map by recommended names; if not found, leave current value
    const next = { ...voices };
    (Object.keys(RECOMMENDED_NAMES) as (keyof typeof RECOMMENDED_NAMES)[]).forEach((k) => {
      const id = nameToId(RECOMMENDED_NAMES[k]);
      if (id) next[k] = id;
    });
    setVoices(next);
  }

  function reset() {
    setPlaying(false); setNow("Idle"); setTranscript([]); setCtaShown(false);
    setKpi({ bookings: 0, timeSavedMin: 0, csat: 4.8 });
    setProgress({ i: 0, total: 0 });
    qRef.current = new AudioQueue(setNow);
    if (rafRef.current.id) cancelAnimationFrame(rafRef.current.id);
    try { sourceRef.current?.disconnect(); } catch {}
  }

  async function start() {
    reset();
    setPlaying(true);
    const q = qRef.current!;
    const lines = sel.lines;
    setProgress({ i: 0, total: lines.length });

    const pushT = (who: string, text: string) => {
      setTranscript((t) => [...t, { who, text }]);
      setTimeout(()=> {
        const el = document.getElementById("demo-transcript");
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    };

    let booked = false;
    let i = 0;

    for (const line of lines) {
      if (line.who === "ring") {
        await q.add(async ()=> { setNow("Dialing…"); await ringOnce(1100 / pace); setProgress({ i: ++i, total: lines.length }); });
        continue;
      }
      const whoLabel = line.who === "ai" ? "Receptionist" : "Caller";
      const vkey = (line.voice ?? (line.who === "ai" ? "ai_en" : "caller_f")) as keyof typeof DEFAULT_VOICES;
      const text = line.text || "";
      const delayAfter = Math.max(180, (line.pause ?? 260) / pace);

      await q.add(async ()=> {
        setNow(`${whoLabel} speaking…`); pushT(whoLabel, text);
        if (line.who === "ai" && /booked|confirm|reserv|agendad|confirmée|reserva/i.test(text)) {
          booked = true;
          setKpi((k)=> ({ ...k, bookings: k.bookings + 1, timeSavedMin: k.timeSavedMin + 6 }));
        }
        const blob = await playTTS(
          text,
          voices[vkey],
          DEFAULT_VOICE_SETTINGS,
          format,
          audioCtxRef, analyserRef, sourceRef, canvasRef, rafRef
        );
        setLastBlobUrl(URL.createObjectURL(blob));
        await new Promise((r)=> setTimeout(r, delayAfter));
        setProgress({ i: ++i, total: lines.length });
      });
    }

    await q.add(async ()=> { setNow("Call complete"); if (booked) setCtaShown(true); });
    setPlaying(false);
  }

  function exportTxt() {
    const body = transcript.map(t=> `${t.who}: ${t.text}`).join("\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `relayai-call-${sel.id}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  function simulateFollowUp() {
    alert("✅ Follow-up SMS queued: \"Thanks for calling! Here's your confirmation link: https://example.com/book\"");
  }

  function replayLast() {
    if (!lastBlobUrl) return;
    const a = new Audio(lastBlobUrl);
    a.play();
  }

  function downloadLast() {
    if (!lastBlobUrl) return;
    const a = document.createElement("a");
    a.href = lastBlobUrl;
    a.download = `relayai-utterance-${Date.now()}.${format==="mp3"?"mp3":"ulaw"}`;
    a.click();
  }

  const langs = ["ALL","EN","ES","BI","FR","PT"] as const;
  const [langFilter, setLangFilter] = useState<typeof langs[number]>("ALL");
  const visibleScenarios = useMemo(()=> SCENARIOS.filter(s => langFilter==="ALL" ? true : s.lang===langFilter), [langFilter]);

  // HiDPI canvas sizing
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  });

  return (
    <div className="max-w-6xl mx-auto p-6 grid lg:grid-cols-2 gap-6">
      {/* LEFT: Picker & Controls */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle>AI Receptionist — Live Demo</CardTitle>
          <div className="text-sm text-slate-500">
            Human‑paced • Multilingual • Booking + Follow‑up • <b>Waveform</b> shows <i>MP3 vs μ‑law</i>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Language filter */}
          <div className="flex flex-wrap gap-2">
            {langs.map(l=> (
              <Button key={l} variant={langFilter===l?"default":"outline"} className="rounded-2xl" onClick={()=> setLangFilter(l)}>{l}</Button>
            ))}
          </div>

          {/* Scenario picker */}
          <div className="grid md:grid-cols-2 gap-3">
            {visibleScenarios.map((s)=> (
              <button key={s.id} onClick={()=> setSel(s)} className={`text-left p-4 rounded-xl border transition ${sel.id===s.id? "bg-slate-900 text-white border-slate-900":"bg-white hover:bg-slate-50"}`}>
                <div className="text-xs opacity-80">{s.phone} • {s.lang}</div>
                <div className="font-semibold">{s.name}</div>
                <div className="text-sm opacity-90">{s.desc}</div>
                <div className="text-xs opacity-70">{s.sub}</div>
              </button>
            ))}
          </div>

          {/* Pace + Format */}
          <div className="grid md:grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-sm font-medium">Playback pace</label>
              <input type="range" min={0.8} max={1.3} step={0.05} value={pace} onChange={(e)=> setPace(parseFloat(e.target.value))} className="w-full"/>
              <div className="text-xs text-slate-500">{pace.toFixed(2)}× (lower = slower, more human)</div>
            </div>
            <div>
              <label className="text-sm font-medium">Output format</label>
              <select value={format} onChange={(e)=> setFormat(e.target.value as any)} className="w-full border rounded-lg p-2">
                <option value="mp3">MP3 (High‑quality web demo)</option>
                <option value="ulaw_8000">μ‑law 8000Hz (Telephony‑grade)</option>
              </select>
              <div className="text-xs text-slate-500 mt-1">
                {format==="mp3"
                  ? "Rich, natural audio — perfect for web & marketing."
                  : "8kHz μ‑law — exactly what phone lines deliver."}
              </div>
            </div>
          </div>

          {/* Voice selectors + Recommended mapping */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-sm">Voices (auto-mapped by name from your ElevenLabs account)</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-3">
              {(Object.keys(voices) as (keyof typeof voices)[]).map((k) => (
                <div key={k}>
                  <label className="block text-xs font-medium mb-1">{k} {RECOMMENDED_NAMES[k as keyof typeof RECOMMENDED_NAMES] ? `• suggested: ${RECOMMENDED_NAMES[k as keyof typeof RECOMMENDED_NAMES]}`:""}</label>
                  {/* Dropdown by name (from account), falls back to free text ID */}
                  <select
                    className="w-full border rounded-lg p-2 mb-1"
                    value={voices[k]}
                    onChange={(e)=> setVoices({ ...voices, [k]: e.target.value })}
                  >
                    <option value={voices[k]}>— Select from your voices —</option>
                    {voiceOptions.map(v => (
                      <option key={v.id} value={v.id}>{v.name} {v.language ? `(${v.language})`:""}</option>
                    ))}
                  </select>
                  <Input
                    value={voices[k]}
                    onChange={(e)=> setVoices({ ...voices, [k]: e.target.value })}
                    placeholder="Or paste a voice_id"
                  />
                  <div className="mt-1 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async ()=> {
                        const sample = k.toString().includes("ai")
                          ? "Thanks for calling. How can I help you today?"
                          : "Hi there! I'd like to book an appointment.";
                        const blob = await playTTS(sample, voices[k], DEFAULT_VOICE_SETTINGS, format,
                          audioCtxRef, analyserRef, sourceRef, canvasRef, rafRef);
                        setLastBlobUrl(URL.createObjectURL(blob));
                      }}
                    >
                      Test
                    </Button>
                  </div>
                </div>
              ))}
              <div className="md:col-span-2">
                <Button variant="outline" onClick={useRecommended}>Use Recommended Voices (auto-map by name)</Button>
                <Button variant="outline" className="ml-2" onClick={fetchVoices}>Refresh Voice List</Button>
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <div className="flex gap-2">
            <Button className="rounded-2xl" onClick={start} disabled={playing}>{playing ? "Dialing…" : "Start Demo Call"}</Button>
            <Button variant="outline" className="rounded-2xl" onClick={reset} disabled={playing}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      {/* RIGHT: Waveform + Transcript + KPIs */}
      <Card className="rounded-2xl shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_30%_20%,rgba(15,23,42,0.06),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(15,23,42,0.04),transparent_35%)]" />
        <CardHeader>
          <CardTitle>Live Call Experience</CardTitle>
          <div className="text-xs text-slate-500">
            {now} • Step {Math.min(progress.i, progress.total)} / {progress.total}
          </div>
        </CardHeader>
        <CardContent>
          {/* Waveform */}
          <div className="mb-3">
            <div className="text-xs text-slate-500 mb-1">
              Waveform (format: <b>{format === "mp3" ? "MP3 44.1k" : "μ‑law 8k"}</b>)
            </div>
            <div className="w-full h-24 rounded-lg border bg-white overflow-hidden">
              <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={replayLast} disabled={!lastBlobUrl}>Replay last utterance</Button>
              <Button variant="outline" size="sm" onClick={downloadLast} disabled={!lastBlobUrl}>Download last utterance</Button>
            </div>
          </div>

          {/* Transcript */}
          <div id="demo-transcript" className="h-64 overflow-auto space-y-2 p-1 bg-white/60 rounded-xl">
            {transcript.length===0 ? (
              <div className="h-full grid place-items-center text-slate-500 text-sm">
                Pick a scenario and press <b>Start Demo Call</b>.
              </div>
            ) : transcript.map((t,i)=> (
              <div key={i} className={`flex ${t.who==="Receptionist" ? "justify-start":"justify-end"}`}>
                <div className={`px-3 py-2 rounded-xl text-sm shadow ${t.who==="Receptionist"?"bg-slate-100":"bg-slate-900 text-white"}`}>
                  <div className="text-[10px] opacity-70 mb-1">{t.who}</div>
                  <div>{t.text}</div>
                </div>
              </div>
            ))}
          </div>

          {/* KPIs */}
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl bg-white shadow-sm">
              <div className="text-xs text-slate-500">Bookings captured</div>
              <div className="text-2xl font-semibold">{kpi.bookings}</div>
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm">
              <div className="text-xs text-slate-500">Time saved (min)</div>
              <div className="text-2xl font-semibold">{kpi.timeSavedMin}</div>
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm">
              <div className="text-xs text-slate-500">CSAT (demo)</div>
              <div className="text-2xl font-semibold">{kpi.csat.toFixed(1)}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={exportTxt} disabled={transcript.length===0}>Export transcript</Button>
            <Button variant="outline" className="rounded-2xl" onClick={simulateFollowUp} disabled={playing}>Simulate follow‑up SMS</Button>
            <Button className="rounded-2xl" onClick={()=> setCtaShown(true)} disabled={playing || ctaShown}>Show booking CTA</Button>
          </div>

          {/* CTA */}
          {ctaShown && (
            <div className="mt-4 p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="font-semibold">Book instantly</div>
                <div className="text-xs opacity-80">We'll text your confirmation & reminders</div>
              </div>
              <a href="#get-started" className="px-4 py-2 rounded-lg bg-white text-slate-900 text-sm">Start Free Trial</a>
            </div>
          )}

          <div className="text-[11px] text-slate-500 mt-3">
            Voices by ElevenLabs • Key stays server‑side • Compare <b>MP3 vs μ‑law</b> live • Recommended voices auto‑mapped by name.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}