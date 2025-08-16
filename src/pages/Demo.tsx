// src/pages/Demo.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Globe, Loader2 } from "lucide-react";
import PostCallIntelligence from "@/components/demo/PostCallIntelligence";
import AnalyticsDashboard from "@/components/demo/AnalyticsDashboard";
import CompetitiveShowcase from "@/components/demo/CompetitiveShowcase";
import ROICalculator from "@/components/demo/ROICalculator";
import IntegrationShowcase from "@/components/demo/IntegrationShowcase";
import { KnowledgeShowcase } from "@/components/demo/KnowledgeShowcase";
import { ragSearch } from "@/lib/rag";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// ---------- Hard-mapped ElevenLabs Voice IDs (as provided; UNCHANGED) ----------
const VOICE_AI_EN = "21m00Tcm4TlvDq8ikWAM"; // Rachel – calm, expressive female voice (EN)
const VOICE_AI_ES = "9BWtsMINqrJLrRacOk9x"; // Aria – expressive female voice (works well in Spanish)
const VOICE_CALLER_F = "Xb7hH8MSUJpSbSDYk0k2"; // Alice – confident female British
const VOICE_CALLER_M = "pqHfZKP75CvOlQylNhV4"; // Bill – trustworthy older male
const VOICE_CALLER_ES = "9BWtsMINqrJLrRacOk9x"; // Aria – Spanish-optimized voice for callers

// ---------- Audio delivery settings (UNCHANGED) ----------
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.75,
  similarity_boost: 0.85,
  style: 0.25,
  use_speaker_boost: true,
};
const SPANISH_VOICE_SETTINGS = {
  stability: 0.80,
  similarity_boost: 0.90,
  style: 0.30,
  use_speaker_boost: true,
};

// ---------- Types ----------
type Line = { who: "ring" | "ai" | "caller"; text?: string; voiceId?: string; pause?: number };
type Scenario = {
  id: string;
  name: string;
  phone: string;
  lang: "EN" | "ES" | "BI";
  desc: string;
  sub: string;
  lines: Line[];
  aiThinking?: boolean;
  tags?: string[];
};

// ---------- Scenarios (existing + instant-training) ----------
const SPA_EN: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Thanks for calling Serenity Spa, this is your virtual receptionist. How can I help you today?", voiceId: VOICE_AI_EN, pause: 420 },
  { who: "caller", text: "Hi! I'd like to book a ninety-minute massage for Friday afternoon, if possible.", voiceId: VOICE_CALLER_F, pause: 320 },
  { who: "ai", text: "Absolutely—Friday we have two openings, two fifteen or four thirty. Which works better?", voiceId: VOICE_AI_EN, pause: 280 },
  { who: "caller", text: "Two fifteen, please. And can I request Maya?", voiceId: VOICE_CALLER_F, pause: 260 },
  { who: "ai", text: "You got it—two fifteen with Maya. What's your full name and mobile number to confirm?", voiceId: VOICE_AI_EN, pause: 260 },
  { who: "caller", text: "Jamie Patel, and my number is nine one nine, five five five, zero one nine eight.", voiceId: VOICE_CALLER_F, pause: 260 },
  { who: "ai", text: "Perfect, Jamie. You're all set for Friday at two fifteen with Maya. I'll text a confirmation and reminder.", voiceId: VOICE_AI_EN, pause: 400 },
];

const RESTAURANT_ES: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Gracias por llamar a Bella Vista. ¿En qué puedo ayudarle?", voiceId: VOICE_AI_ES, pause: 360 },
  { who: "caller", text: "Buenas tardes. Quisiera una reserva para cuatro personas el sábado a las siete.", voiceId: VOICE_CALLER_ES, pause: 280 },
  { who: "ai", text: "Con gusto. El sábado a las siete tenemos mesa disponible en la terraza. ¿Le parece bien?", voiceId: VOICE_AI_ES, pause: 260 },
  { who: "caller", text: "Sí, perfecto. A nombre de Ana Rivera.", voiceId: VOICE_CALLER_ES, pause: 260 },
  { who: "ai", text: "Reserva confirmada: cuatro personas, sábado a las siete, a nombre de Ana Rivera. Le enviaré un mensaje de confirmación. ¡Gracias!", voiceId: VOICE_AI_ES, pause: 420 },
];

const SUPPORT_BI: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Premier Services, virtual receptionist speaking. How can I help today?", voiceId: VOICE_AI_EN, pause: 360 },
  { who: "caller", text: "Hi, my water heater stopped working this morning.", voiceId: VOICE_CALLER_M, pause: 260 },
  { who: "ai", text: "I'm sorry to hear that. I can get a technician out today. May I have your service address?", voiceId: VOICE_AI_EN, pause: 260 },
  { who: "caller", text: "Sure, 214 Oakwood Drive in Morrisville. También hablo español si es más fácil.", voiceId: VOICE_CALLER_M, pause: 320 },
  { who: "ai", text: "Claro. ¿A qué hora le viene mejor, entre dos y cuatro de la tarde?", voiceId: VOICE_AI_ES, pause: 260 },
  { who: "caller", text: "A las tres estaría bien. Gracias.", voiceId: VOICE_CALLER_M, pause: 260 },
  { who: "ai", text: "Agendado para las tres. Le enviaremos un mensaje con el nombre y la foto del técnico. ¡Hasta pronto!", voiceId: VOICE_AI_ES, pause: 420 },
];

const AUTO_EN: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Thanks for calling Triangle Auto Care. This is your AI receptionist. How can I help?", voiceId: VOICE_AI_EN, pause: 350 },
  { who: "caller", text: "Hi, my car's brakes are squealing. Can I get a quote and book a checkup?", voiceId: VOICE_CALLER_M, pause: 260 },
  { who: "ai", text: "We can do a same-day inspection. There's a forty-nine dollar diagnostic fee applied to any repair. Does two-thirty today work?", voiceId: VOICE_AI_EN, pause: 300 },
  { who: "caller", text: "Two-thirty is good. It's a 2016 Honda Civic.", voiceId: VOICE_CALLER_M, pause: 260 },
  { who: "ai", text: "Great—two-thirty today. What's your name and number?", voiceId: VOICE_AI_EN, pause: 260 },
  { who: "caller", text: "Marcus Lee, nine one nine, five five five, zero one one zero.", voiceId: VOICE_CALLER_M, pause: 260 },
  { who: "ai", text: "All set, Marcus. I'll text directions. Please arrive five minutes early.", voiceId: VOICE_AI_EN, pause: 380 },
];

// Instant Training scenarios
const HAIR_SALON_INSTANT: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "Thank you for calling Elite Hair Studio! This is your AI receptionist. How can I help you today?", voiceId: VOICE_AI_EN, pause: 400 },
  { who: "caller", text: "Hi! I saw online that you do color treatments. What are your prices for highlights?", voiceId: VOICE_CALLER_F, pause: 320 },
  { who: "ai", text: "Absolutely! Based on our current menu, partial highlights start at $120 and full highlights are $180. We use premium Redken products. Would you like to book with one of our colorists?", voiceId: VOICE_AI_EN, pause: 350 },
  { who: "caller", text: "That sounds great! What about your hours? I work until 5 PM.", voiceId: VOICE_CALLER_F, pause: 280 },
  { who: "ai", text: "Perfect timing! We're open Tuesday through Saturday, 9 AM to 8 PM, and Sunday 10 AM to 6 PM. I can get you in this Thursday at 6 PM with Sarah, our senior colorist.", voiceId: VOICE_AI_EN, pause: 320 },
  { who: "caller", text: "Thursday at 6 works perfectly! I'm Jessica Martinez.", voiceId: VOICE_CALLER_F, pause: 260 },
  { who: "ai", text: "Excellent Jessica! You're booked for Thursday at 6 PM with Sarah for partial highlights. I'll send a confirmation text with our address and prep instructions.", voiceId: VOICE_AI_EN, pause: 420 },
];

const CAFE_MULTILINGUAL: Line[] = [
  { who: "ring" }, { who: "ring" },
  { who: "ai", text: "¡Hola! Gracias por llamar a Café Luna. ¿En qué puedo ayudarle?", voiceId: VOICE_AI_ES, pause: 360 },
  { who: "caller", text: "Hola, quisiera saber si tienen espacio para una reunión de trabajo mañana por la tarde.", voiceId: VOICE_CALLER_ES, pause: 300 },
  { who: "ai", text: "¡Por supuesto! Tenemos mesas privadas perfectas para reuniones. ¿Para cuántas personas sería?", voiceId: VOICE_AI_ES, pause: 280 },
  { who: "caller", text: "Somos cuatro personas, y necesitaríamos WiFi y tal vez un proyector.", voiceId: VOICE_CALLER_ES, pause: 280 },
  { who: "ai", text: "Perfecto. Nuestra sala de reuniones tiene WiFi de alta velocidad y proyector incluido. ¿Le parece bien de 2 a 4 de la tarde? El costo es de 25 dólares por hora, mínimo dos horas.", voiceId: VOICE_AI_ES, pause: 380 },
  { who: "caller", text: "Excelente. Reservo de 2 a 4. Soy María González.", voiceId: VOICE_CALLER_ES, pause: 260 },
  { who: "ai", text: "¡Perfecto María! Reserva confirmada para mañana de 2 a 4 PM. Le enviaré los detalles de acceso y menú de café. ¡Hasta mañana!", voiceId: VOICE_AI_ES, pause: 420 },
];

const SCENARIOS: Scenario[] = [
  { id: "hair_instant", name: "Elite Hair Studio", phone: "(555) 847-HAIR", lang: "EN", desc: "Instant Training Demo", sub: "AI trained from website in real-time", lines: HAIR_SALON_INSTANT, aiThinking: true, tags: ["Instant Training", "Live Data"] },
  { id: "cafe_multilingual", name: "Café Luna", phone: "(555) 726-LUNA", lang: "ES", desc: "Multilingual + Training", sub: "Same knowledge, Spanish responses", lines: CAFE_MULTILINGUAL, aiThinking: true, tags: ["Multilingual", "Smart Learning"] },
  { id: "spa", name: "Serenity Spa", phone: "(555) 123-RELAX", lang: "EN", desc: "Appointment Booking", sub: "Massage & confirmation", lines: SPA_EN },
  { id: "restaurant", name: "Bella Vista", phone: "(555) 456-DINE", lang: "ES", desc: "Reserva (Español)", sub: "Reserva en español", lines: RESTAURANT_ES },
  { id: "support_bi", name: "Premier Services", phone: "(555) 789-HELP", lang: "BI", desc: "Support (EN↔ES)", sub: "Bilingual service call", lines: SUPPORT_BI },
  { id: "auto", name: "Triangle Auto Care", phone: "(555) 274-BRAKE", lang: "EN", desc: "Brake Inspection", sub: "Quote + same-day check", lines: AUTO_EN },
];

// ---------- Playback & waveform utils (audio behavior UNCHANGED) ----------
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

// Global handle to currently playing element for pause/stop control
let CURRENT_AUDIO: HTMLAudioElement | null = null;

async function tts(
  text: string,
  voiceId: string,
  format: "mp3" | "ulaw_8000" = "mp3",
  voiceSettings?: any,
  onEnded?: () => void,
  attachToWave?: (el: HTMLAudioElement) => void
) {
  if (!text?.trim()) { return; }
  try {
    const { data, error } = await supabase.functions.invoke("tts-voice", {
      body: {
        text,
        voiceId,
        modelId: "eleven_multilingual_v2",
        output_format: format,
        voice_settings: voiceSettings ?? DEFAULT_VOICE_SETTINGS,
      },
    });
    if (error || !data?.audioBase64) throw new Error(error?.message || "No audio");
    const contentType = data.contentType || (format === "ulaw_8000" ? "audio/basic" : "audio/mpeg");
    await playAudioSegment(data.audioBase64, contentType, attachToWave);
    onEnded?.();
  } catch {
    await ringOnce(300);
    onEnded?.();
  }
}

const playAudioSegment = (audioBase64: string, contentType: string, attachToWave?: (el: HTMLAudioElement) => void): Promise<void> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    CURRENT_AUDIO = audio; // expose for pause/stop
    const onEnded = () => { audio.removeEventListener("ended", onEnded); audio.removeEventListener("error", onError); resolve(); };
    const onError = () => { audio.removeEventListener("ended", onEnded); audio.removeEventListener("error", onError); reject(new Error("Audio playback failed")); };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    try { attachToWave?.(audio); } catch {}
    audio.src = `data:${contentType};base64,${audioBase64}`;
    audio.play().catch(reject);
  });
};

async function ringOnce(ms = 1100) {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") { await ctx.resume(); }
  const g = ctx.createGain(); g.connect(ctx.destination); g.gain.value = 0.06;
  const o1 = ctx.createOscillator(); o1.frequency.value = 440; o1.connect(g);
  const o2 = ctx.createOscillator(); o2.frequency.value = 480; o2.connect(g);
  o1.start(); o2.start(); await new Promise((r)=> setTimeout(r, ms));
  o1.stop(); o2.stop(); g.disconnect(); ctx.close();
}

// Waveform (unchanged)
function useWaveform() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  async function attach(el: HTMLAudioElement) {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
    }
    if (ctx.state === "suspended") { await ctx.resume(); }
    try { srcRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}

    const source = ctx.createMediaElementSource(el);
    srcRef.current = source;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;

    draw();
  }

  function draw() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const c = canvas.getContext("2d")!;
    const w = canvas.width, h = canvas.height;
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      c.clearRect(0,0,w,h);
      c.beginPath();
      c.moveTo(0, h/2);
      for (let i=0;i<w;i++) {
        const v = data[Math.floor(i / w * data.length)] / 128.0 - 1.0;
        const y = (h/2) + v * (h/2 - 4);
        c.lineTo(i, y);
      }
      c.strokeStyle = "hsl(var(--foreground))";
      c.lineWidth = 2;
      c.stroke();
      rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }

  useEffect(()=> () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  return { canvasRef, attach };
}

// ---------- New “stages” + business presets ----------
type Stage = "onboarding" | "training" | "routing" | "call" | "marketing";
type Facts = {
  about?: string;
  services?: string[];
  hours?: Record<string, string>;
  pricingNote?: string;
  phone?: string;
  bookingUrl?: string;
  languages?: string[];
};

const PRESETS = [
  { label: "Serenity Spa", url: "https://serenityspa.example.com", phone: "(919) 555-0198", scenarioId: "spa" },
  { label: "Triangle Auto Care", url: "https://triangleauto.example.com", phone: "(919) 555-0110", scenarioId: "auto" },
  { label: "Elite Hair Studio", url: "https://elitehair.example.com", phone: "(555) 847-HAIR", scenarioId: "hair_instant" },
  { label: "Bella Vista Restaurant", url: "https://bellavista.example.com", phone: "(555) 456-DINE", scenarioId: "restaurant" },
];

export default function DemoPage() {
  // stages
  const [stage, setStage] = useState<Stage>("onboarding");
  const [autoPlay, setAutoPlay] = useState(false);

  // onboarding
  const [bizName, setBizName] = useState("Serenity Spa");
  const [bizUrl, setBizUrl] = useState("https://serenityspa.example.com");
  const [bizPhone, setBizPhone] = useState("(919) 555-0198");
  const [preset, setPreset] = useState(PRESETS[0].label);

  // training
  const [crawlProgress, setCrawlProgress] = useState(0);
  const [facts, setFacts] = useState<Facts | null>(null);

  // routing
  const [forwardEnabled, setForwardEnabled] = useState(true);
  const [afterHoursVM, setAfterHoursVM] = useState(true);
  const [smsConfirm, setSmsConfirm] = useState(true);

  // live call
  const [sel, setSel] = useState<Scenario>(SCENARIOS[0]);
  const [now, setNow] = useState("Idle");
  const [playing, setPlaying] = useState(false);
  const [pace, setPace] = useState(1);
  const [format, setFormat] = useState<"mp3" | "ulaw_8000">("mp3");
  const [transcript, setTranscript] = useState<{ who: string; text: string }[]>([]);
  const [kpi, setKpi] = useState({ bookings: 0, timeSavedMin: 0, csat: 4.8 });
  const [ctaShown, setCtaShown] = useState(false);
  const [showPostCall, setShowPostCall] = useState(false);
  const [callCompleted, setCallCompleted] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);

  // new control refs
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);

  const qRef = useRef<AudioQueue | null>(null);
  const wave = useWaveform();
  useEffect(()=> { qRef.current = new AudioQueue(setNow); }, []);

  // unlock audio on first click (Lovable/Chrome)
  async function unlockAudio() {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as any;
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume();
      await ctx.close();
    } catch {}
  }

  function applyPreset(label: string) {
    setPreset(label);
    const p = PRESETS.find(x => x.label === label)!;
    setBizName(p.label);
    setBizUrl(p.url);
    setBizPhone(p.phone);
    const scen = SCENARIOS.find(s => s.id === p.scenarioId) || SCENARIOS[0];
    setSel(scen);
  }

  async function runTour() {
    setAutoPlay(true);
    await handleStartTraining();
    await new Promise(r=> setTimeout(r, 600));
    setStage("routing");
    await new Promise(r=> setTimeout(r, 600));
    setStage("call");
    await start();
    await new Promise(r=> setTimeout(r, 600));
    setStage("marketing");
    setAutoPlay(false);
  }

  async function handleStartTraining() {
    setStage("training");
    setCrawlProgress(0);
    const steps = [18, 39, 61, 83, 100];
    for (const v of steps) { setCrawlProgress(v); await new Promise(r=> setTimeout(r, 420)); }
    try { await ragSearch("demo-tenant", "services hours pricing", 3); } catch {}
    // Curate facts by selected preset to showcase “trained” content
    const curatedByBiz: Record<string, Facts> = {
      "Serenity Spa": {
        about: "Serenity Spa is a boutique wellness studio specializing in therapeutic and deep-tissue massage with optional aromatherapy.",
        services: ["60-min Massage", "90-min Massage", "Couples Massage", "Facial & Glow", "Hot Stone Add-on"],
        hours: { Mon: "10a–6p", Tue: "10a–6p", Wed: "10a–6p", Thu: "10a–6p", Fri: "10a–7p", Sat: "10a–4p", Sun: "Closed" },
        pricingNote: "90-min typically $150–$180 depending on practitioner.",
        phone: bizPhone,
        bookingUrl: "https://serenityspa.example.com/book",
        languages: ["English", "Spanish"],
      },
      "Triangle Auto Care": {
        about: "Triangle Auto Care offers full-service maintenance and repairs with same-day inspections.",
        services: ["Brake Inspection", "Oil Change", "Tire Rotation", "Battery Check", "AC Service"],
        hours: { Mon: "8a–6p", Tue: "8a–6p", Wed: "8a–6p", Thu: "8a–6p", Fri: "8a–6p", Sat: "9a–2p", Sun: "Closed" },
        pricingNote: "Diagnostics $49.95 applied to any repair.",
        phone: "(919) 555-0110",
        bookingUrl: "https://triangleauto.example.com/booking",
        languages: ["English"],
      },
      "Elite Hair Studio": {
        about: "Elite Hair Studio specializes in color, cuts, and premium treatments using Redken products.",
        services: ["Balayage", "Partial Highlights", "Full Highlights", "Trim & Style", "Keratin"],
        hours: { Tue: "9a–8p", Wed: "9a–8p", Thu: "9a–8p", Fri: "9a–8p", Sat: "9a–6p", Sun: "10a–6p", Mon: "Closed" },
        pricingNote: "Partial highlights from $120; full from $180.",
        phone: "(555) 847-HAIR",
        bookingUrl: "https://elitehair.example.com/book",
        languages: ["English"],
      },
      "Bella Vista Restaurant": {
        about: "Bella Vista serves modern Latin cuisine with terrace seating and group accommodations.",
        services: ["Dinner Reservations", "Group Seating", "Catering Inquiry", "Private Room"],
        hours: { Mon: "5p–10p", Tue: "5p–10p", Wed: "5p–10p", Thu: "5p–10p", Fri: "5p–11p", Sat: "5p–11p", Sun: "Closed" },
        pricingNote: "Average dinner check $35–$45 per person.",
        phone: "(555) 456-DINE",
        bookingUrl: "https://bellavista.example.com/reserve",
        languages: ["Spanish", "English"],
      },
    };
    setFacts(curatedByBiz[preset] || curatedByBiz["Serenity Spa"]);
  }

  function reset() {
    setPlaying(false); setNow("Idle"); setTranscript([]); setCtaShown(false);
    setShowPostCall(false); setCallCompleted(false); setAiThinking(false);
    setKpi({ bookings: 0, timeSavedMin: 0, csat: 4.8 });
    isPausedRef.current = false;
    isCancelledRef.current = false;
    if (CURRENT_AUDIO) { try { CURRENT_AUDIO.pause(); CURRENT_AUDIO.currentTime = 0; } catch {} }
    qRef.current = new AudioQueue(setNow);
  }

  async function recordBookingOrLead() {
    try {
      const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const { error } = await supabase
        .from("appointments")
        .insert([{ title: "Massage – Maya", customer: "Jamie Patel", start_at: startAt.toISOString(), end_at: endAt.toISOString(), staff: "Maya" }]);
      if (error) throw error;
      return true;
    } catch {
      return false;
    }
  }

  // ---- NEW: playback flow with pause/stop support (no audio setting changes) ----
  function pauseCall() {
    isPausedRef.current = true;
    if (CURRENT_AUDIO) { try { CURRENT_AUDIO.pause(); } catch {} }
    setNow("Paused");
    setPlaying(false);
  }

  async function resumeCall() {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    if (CURRENT_AUDIO) { try { await CURRENT_AUDIO.play(); } catch {} }
    setPlaying(true);
  }

  function stopCall() {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    if (CURRENT_AUDIO) { try { CURRENT_AUDIO.pause(); CURRENT_AUDIO.currentTime = 0; } catch {} }
    setPlaying(false);
    setNow("Stopped");
  }

  function waitIfPaused(): Promise<void> {
    return new Promise((resolve) => {
      if (!isPausedRef.current) return resolve();
      const i = setInterval(() => {
        if (!isPausedRef.current) {
          clearInterval(i);
          resolve();
        }
      }, 120);
    });
  }

  async function start() {
    await unlockAudio();
    isCancelledRef.current = false;
    isPausedRef.current = false;
    reset();
    setPlaying(true);
    const q = qRef.current!;
    const lines = sel.lines;
    let booked = false;

    const pushT = (who: string, text: string) => {
      setTranscript((t) => [...t, { who, text }]);
      setTimeout(()=> {
        const el = document.getElementById("demo-transcript");
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    };

    for (const line of lines) {
      if (isCancelledRef.current) break;
      await waitIfPaused();
      if (line.who === "ring") {
        await q.add(async ()=> { setNow("Dialing…"); await ringOnce(1100 / pace); });
        continue;
      }
      const whoLabel = line.who === "ai" ? "Receptionist" : "Caller";
      const vId = line.voiceId || VOICE_AI_EN;
      const text = line.text || "";
      const delayAfter = Math.max(50, (line.pause ?? 100) / pace);

      await q.add(async ()=> {
        if (isCancelledRef.current) return;
        // AI thinking flare
        const needsKB = line.who === "ai" && sel.aiThinking &&
          /book|appointment|help|price|hour|reunión|reserva|precio|hora|disponible|espacio|menu|cost/i.test(text);
        if (needsKB) {
          setAiThinking(true);
          try { await ragSearch("demo-tenant", text.slice(0, 64), 3); } catch {}
          await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
          setAiThinking(false);
        }

        setNow(`${whoLabel} speaking…`); pushT(whoLabel, text);
        if (line.who === "ai" && /booked|confirm|reserv|agendad|confirmée|reserva|all set/i.test(text)) {
          booked = true;
          setKpi((k)=> ({ ...k, bookings: k.bookings + 1, timeSavedMin: k.timeSavedMin + 6 }));
        }

        const voiceSettings = (vId === VOICE_AI_ES || vId === VOICE_CALLER_ES) ? SPANISH_VOICE_SETTINGS : DEFAULT_VOICE_SETTINGS;
        await waitIfPaused();
        if (isCancelledRef.current) return;
        await tts(text, vId, format, voiceSettings, undefined, wave.attach);
        await waitIfPaused();
        if (isCancelledRef.current) return;
        await new Promise((r)=> setTimeout(r, delayAfter));
      });
    }

    if (!isCancelledRef.current) {
      const saved = await recordBookingOrLead();
      if (!saved) {
        alert("✅ Booking captured (simulated). In production this writes to your Appointments table.");
      } else if (smsConfirm) {
        alert("✅ Booking saved. SMS confirmation sent to the caller.");
      }

      await q.add(async ()=> {
        setNow("Call complete");
        setCallCompleted(true);
        if (booked) {
          setCtaShown(true);
          setTimeout(() => setShowPostCall(true), 900);
        }
      });
      setPlaying(false);
    }
  }

  function exportTxt() {
    const body = transcript.map(t=> `${t.who}: ${t.text}`).join("\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `relayai-call-${sel.id}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  function simulateFollowUp() {
    alert("✅ Follow-up SMS queued: 'Thanks for calling! Here's your confirmation link: https://example.com/book'");
  }

  const langs = ["ALL","EN","ES","BI"] as const;
  const [langFilter, setLangFilter] = useState<typeof langs[number]>("ALL");
  const visibleScenarios = useMemo(()=> SCENARIOS.filter(s => langFilter==="ALL" ? true : s.lang===langFilter), [langFilter]);

  const analyticsData = { callsHandled: 1247, conversionRate: 87, revenueGenerated: 142650, timeSaved: 320, customerSatisfaction: 4.8, missedCallsRecovered: 89 };

  const postCallMap: Record<string, any> = {
    spa: { customerData: { name: "Jamie Patel", phone: "(919) 555-0198", service: "90-min Massage", urgency: "Medium", revenue: 149, conversionProb: 92 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: true, staffNotified: true } },
    restaurant: { customerData: { name: "Ana Rivera", phone: "(555) 123-4567", service: "Table for 4", urgency: "High", revenue: 280, conversionProb: 88 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: false, staffNotified: true } },
    support_bi: { customerData: { name: "Customer", phone: "(214) 555-0123", service: "Water Heater Repair", urgency: "High", revenue: 320, conversionProb: 95 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: false, staffNotified: true } },
    auto: { customerData: { name: "Marcus Lee", phone: "(919) 555-0110", service: "Brake Inspection", urgency: "Medium", revenue: 189, conversionProb: 85 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: false, staffNotified: true } },
    hair_instant: { customerData: { name: "Jessica Martinez", phone: "(555) 123-4567", service: "Hair Highlights", urgency: "Medium", revenue: 120, conversionProb: 94 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: false, staffNotified: true } },
    cafe_multilingual: { customerData: { name: "María González", phone: "(555) 234-5678", service: "Meeting Room Rental", urgency: "High", revenue: 50, conversionProb: 96 }, businessImpact: { appointmentBooked: true, followUpScheduled: true, paymentProcessed: true, staffNotified: true } },
  };
  const getPostCallData = () => postCallMap[sel.id] || postCallMap["spa"];

  // -------------------- UI Blocks --------------------
  function OnboardingCard() {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Welcome — Let’s set up your AI Receptionist</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* NEW: business presets picker */}
          <div className="grid md:grid-cols-4 gap-2">
            {PRESETS.map(p => (
              <Button key={p.label}
                variant={preset===p.label ? "default" : "outline"}
                onClick={()=> applyPreset(p.label)}
                className="justify-start">
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div><label className="text-sm font-medium">Business Name</label><Input value={bizName} onChange={e=> setBizName(e.target.value)} placeholder="Acme Dental" /></div>
            <div><label className="text-sm font-medium">Website</label><Input value={bizUrl} onChange={e=> setBizUrl(e.target.value)} placeholder="https://…" /></div>
            <div><label className="text-sm font-medium">Business Phone</label><Input value={bizPhone} onChange={e=> setBizPhone(e.target.value)} placeholder="(555) 555-1234" /></div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleStartTraining}>Start Auto-Training</Button>
            <Button variant="outline" onClick={runTour}>Play full tour</Button>
          </div>
          <div className="text-[11px] text-muted-foreground">No credit card. 3-minute setup. Key details discovered automatically.</div>
        </CardContent>
      </Card>
    );
  }

  function TrainingCard() {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Auto-Training — Learning your business</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">Scanning <b>{bizUrl}</b> for services, hours, pricing, contact, FAQs…</div>
          <div className="w-full h-2 rounded bg-slate-200 overflow-hidden"><div className="h-full bg-slate-900 transition-all" style={{ width: `${crawlProgress}%` }} /></div>
          {facts && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-card shadow-sm"><div className="text-xs text-muted-foreground mb-1">About</div><div className="text-sm">{facts.about}</div></div>
              <div className="p-3 rounded-xl bg-card shadow-sm"><div className="text-xs text-muted-foreground mb-1">Top Services</div><ul className="text-sm list-disc ml-4">{facts.services?.map(s=> <li key={s}>{s}</li>)}</ul></div>
              <div className="p-3 rounded-xl bg-card shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Hours</div>
                <div className="grid grid-cols-2 gap-x-4 text-sm">
                  {Object.entries(facts.hours || {}).map(([d,h])=> <div key={d} className="flex justify-between"><span>{d}</span><span>{h}</span></div>)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-card shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Other</div>
                <div className="text-sm">Pricing: {facts.pricingNote}</div>
                <div className="text-sm">Languages: {(facts.languages || []).join(", ")}</div>
                <div className="text-sm">Booking: {facts.bookingUrl}</div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={()=> setStage("routing")}>Continue to Call Routing</Button>
            {!autoPlay && <Button variant="outline" onClick={runTour}>Play full tour</Button>}
          </div>
        </CardContent>
      </Card>
    );
  }

  function RoutingCard() {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Call Routing & Confirmation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><div className="font-medium">Forward business number</div><div className="text-xs text-muted-foreground">Route {bizPhone} to your AI receptionist first</div></div>
            <Switch checked={forwardEnabled} onCheckedChange={setForwardEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div><div className="font-medium">After-hours voicemail → transcript</div><div className="text-xs text-muted-foreground">Capture every lead even when closed</div></div>
            <Switch checked={afterHoursVM} onCheckedChange={setAfterHoursVM} />
          </div>
          <div className="flex items-center justify-between">
            <div><div className="font-medium">SMS confirmations</div><div className="text-xs text-muted-foreground">Automatic confirmations & reminders after booking</div></div>
            <Switch checked={smsConfirm} onCheckedChange={setSmsConfirm} />
          </div>
          <div className="flex gap-2">
            <Button onClick={()=> setStage("call")}>Continue to Live Call</Button>
            {!autoPlay && <Button variant="outline" onClick={runTour}>Play full tour</Button>}
          </div>
        </CardContent>
      </Card>
    );
  }

  // -------------------- RENDER --------------------
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Stage header */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>Relay Voice — End-to-End Demo</CardTitle>
          <div className="text-sm text-muted-foreground">Onboarding → Training → Call Routing → Live Call → Post-Call & Marketing</div>
        </CardHeader>
      </Card>

      {stage === "onboarding" && <OnboardingCard />}
      {stage === "training" && <TrainingCard />}
      {stage === "routing" && <RoutingCard />}

      {(stage === "call" || stage === "marketing") && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Controls (AUDIO SETTINGS UNCHANGED) */}
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle>AI Receptionist — Live Demo</CardTitle>
              <div className="text-sm text-muted-foreground">
                Human-paced, multilingual calls with realistic ring tones, live transcript, KPIs, and a PSTN (μ-law) toggle.
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Language filter */}
              <div className="flex flex-wrap gap-2">
                {(["ALL","EN","ES","BI"] as const).map(l=> (
                  <Button key={l} variant={langFilter===l?"default":"outline"} className="rounded-2xl" onClick={()=> setLangFilter(l)}>{l}</Button>
                ))}
              </div>

              {/* Scenario picker */}
              <div className="grid md:grid-cols-2 gap-3">
                {visibleScenarios.map((s)=> (
                  <button key={s.id} onClick={()=> setSel(s)}
                    className={`text-left p-4 rounded-xl border transition ${sel.id===s.id? "bg-primary text-primary-foreground border-primary":"bg-card hover:bg-accent"}`}>
                    <div className="text-xs opacity-80">{s.phone} • {s.lang}</div>
                    <div className="font-semibold flex items-center gap-2">
                      {s.name}
                      {s.aiThinking && <Brain className="w-3 h-3 opacity-70" />}
                    </div>
                    <div className="text-sm opacity-90">{s.desc}</div>
                    <div className="text-xs opacity-70">{s.sub}</div>
                    {s.tags && (
                      <div className="flex gap-1 mt-2">
                        {s.tags.map((tag, i) => (
                          <span key={i} className={`text-[10px] px-2 py-1 rounded-full ${sel.id===s.id? "bg-primary-foreground/20":"bg-primary/20"} flex items-center gap-1`}>
                            {tag === "Instant Training" && <Brain className="w-2 h-2" />}
                            {tag === "Multilingual" && <Globe className="w-2 h-2" />}
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Pace + Format */}
              <div className="grid md:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-sm font-medium">Playback pace</label>
                  <input type="range" min={0.8} max={1.3} step={0.05} value={pace} onChange={(e)=> setPace(parseFloat(e.target.value))} className="w-full"/>
                  <div className="text-xs text-muted-foreground">{pace.toFixed(2)}× (lower = slower, more human)</div>
                </div>
                <div>
                  <label className="text-sm font-medium">Output format</label>
                  <select value={format} onChange={(e)=> setFormat(e.target.value as any)} className="w-full border rounded-lg p-2 bg-background">
                    <option value="mp3">MP3 (High-quality web)</option>
                    <option value="ulaw_8000">μ-law 8000Hz (Telephony)</option>
                  </select>
                  <div className="text-xs text-muted-foreground mt-1">
                    {format==="mp3" ? "Rich, natural audio — perfect for web demos." : "8kHz μ-law — exactly what phone lines deliver."}
                  </div>
                </div>
              </div>

              {/* Controls — NEW: Play / Pause / Stop */}
              <div className="flex gap-2">
                <Button className="rounded-2xl" onClick={start} disabled={playing || isPausedRef.current}>{playing ? "Dialing…" : isPausedRef.current ? "Resuming…" : "Start Demo Call"}</Button>
                <Button variant="outline" className="rounded-2xl" onClick={resumeCall} disabled={playing || !isPausedRef.current}>▶ Play</Button>
                <Button variant="outline" className="rounded-2xl" onClick={pauseCall} disabled={!playing}>⏸ Pause</Button>
                <Button variant="outline" className="rounded-2xl" onClick={stopCall}>⏹ Stop</Button>
                <Button variant="outline" className="rounded-2xl" onClick={()=> setStage("onboarding")} disabled={playing}>Restart Tour</Button>
              </div>
            </CardContent>
          </Card>

          {/* Right: Transcript + Waveform + KPIs */}
          <Card className="rounded-2xl shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-accent/20 to-transparent" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Live Call Experience
                {aiThinking && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">AI retrieving knowledge…</span>
                  </span>
                )}
              </CardTitle>
              <div className="text-xs text-muted-foreground">{now}</div>
            </CardHeader>
            <CardContent>
              {/* Waveform */}
              <div className="mb-3 rounded-xl bg-card/70 p-2 border">
                <canvas ref={wave.canvasRef} width={800} height={80} style={{ width: "100%", height: 80 }} />
              </div>

              {/* Transcript */}
              <div id="demo-transcript" className="h-72 overflow-auto space-y-2 p-1 bg-card/60 rounded-xl">
                {transcript.length===0 ? (
                  <div className="h-full grid place-items-center text-muted-foreground text-sm">
                    Pick a scenario and press <b>Start Demo Call</b>.
                  </div>
                ) : transcript.map((t,i)=> (
                  <div key={i} className={`flex ${t.who==="Receptionist" ? "justify-start":"justify-end"}`}>
                    <div className={`px-3 py-2 rounded-xl text-sm shadow ${t.who==="Receptionist"?"bg-secondary text-secondary-foreground":"bg-primary text-primary-foreground"}`}>
                      <div className="text-[10px] opacity-70 mb-1">{t.who}</div>
                      <div>{t.text}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* KPI strip */}
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-card shadow-sm"><div className="text-xs text-muted-foreground">Bookings captured</div><div className="text-2xl font-semibold">{kpi.bookings}</div></div>
                <div className="p-3 rounded-xl bg-card shadow-sm"><div className="text-xs text-muted-foreground">Time saved (min)</div><div className="text-2xl font-semibold">{kpi.timeSavedMin}</div></div>
                <div className="p-3 rounded-xl bg-card shadow-sm"><div className="text-xs text-muted-foreground">CSAT (demo)</div><div className="text-2xl font-semibold">{kpi.csat.toFixed(1)}</div></div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-2xl" onClick={exportTxt} disabled={transcript.length===0}>Export transcript</Button>
                <Button variant="outline" className="rounded-2xl" onClick={simulateFollowUp} disabled={playing}>Simulate follow-up SMS</Button>
                {ctaShown && (<a href="#get-started" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Start Free Trial</a>)}
              </div>

              <div className="text-[11px] text-muted-foreground mt-3">
                Voices by ElevenLabs • Toggle between <b>MP3</b> and <b>μ-law telephony</b> to show real-world readiness.
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Post-Call + Marketing value */}
      {(stage === "marketing" || showPostCall) && (
        <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
          <div className="text-center py-6 border-t border-dashed">
            <h2 className="text-2xl font-bold mb-2">Post-Call Intelligence & Business Impact</h2>
            <p className="text-muted-foreground">See how your AI receptionist drives real business results</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <PostCallIntelligence scenario={sel.name} customerData={getPostCallData().customerData} businessImpact={getPostCallData().businessImpact} />
            <IntegrationShowcase />
          </div>

          <AnalyticsDashboard metrics={analyticsData} />

          <div className="grid lg:grid-cols-2 gap-6">
            <ROICalculator />
            <CompetitiveShowcase />
          </div>

          <KnowledgeShowcase />

          {/* Success Story */}
          <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="p-8 text-center">
              <h3 className="text-2xl font-bold text-blue-900 mb-4">Transform Your Business Like 2,500+ Companies</h3>
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div><div className="text-3xl font-bold text-blue-700">94%</div><div className="text-blue-600">Fewer Missed Calls</div></div>
                <div><div className="text-3xl font-bold text-blue-700">$47K</div><div className="text-blue-600">Avg. Annual Revenue Increase</div></div>
                <div><div className="text-3xl font-bold text-blue-700">24h</div><div className="text-blue-600">Setup Time</div></div>
              </div>
              <div className="flex gap-4 justify-center">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">Start Your Free Trial</Button>
                <Button size="lg" variant="outline" className="border-blue-300 text-blue-700">Schedule Expert Demo</Button>
              </div>
            </CardContent>
          </Card>

          {/* “Even without booking” banner */}
          {callCompleted && !ctaShown && (
            <Card className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
              <CardContent className="p-6 text-center">
                <h3 className="text-xl font-bold text-orange-900 mb-2">Even Non-Bookings Create Value</h3>
                <p className="text-orange-700 mb-4">This call still generated lead intelligence, customer insights, and brand touchpoints that traditional systems miss.</p>
                <Button className="bg-orange-600 hover:bg-orange-700">See How We Capture Every Opportunity</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
