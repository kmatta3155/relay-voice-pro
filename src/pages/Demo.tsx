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

// ---------- Hard-mapped ElevenLabs Voice IDs (replace with your real IDs) ----------
const VOICE_AI_EN = "21m00Tcm4TlvDq8ikWAM"; // Rachel – calm, expressive female voice (EN)
const VOICE_AI_ES = "9BWtsMINqrJLrRacOk9x"; // Aria – expressive female voice (works well in Spanish)
const VOICE_CALLER_F = "Xb7hH8MSUJpSbSDYk0k2"; // Alice – confident female British
const VOICE_CALLER_M = "pqHfZKP75CvOlQylNhV4"; // Bill – trustworthy older male
const VOICE_CALLER_ES = "9BWtsMINqrJLrRacOk9x"; // Aria – Spanish-optimized voice for callers

// Default delivery settings (subtle, human)
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.75,
  similarity_boost: 0.85,
  style: 0.25,
  use_speaker_boost: true,
};

// Spanish-optimized voice settings
const SPANISH_VOICE_SETTINGS = {
  stability: 0.80,
  similarity_boost: 0.90,
  style: 0.30,
  use_speaker_boost: true,
};

type Line = {
  who: "ring" | "ai" | "caller";
  text?: string;
  voiceId?: string;
  pause?: number; // ms gap after audio
};

type Scenario = {
  id: string;
  name: string;
  phone: string;
  lang: "EN" | "ES" | "BI" | "FR" | "PT";
  desc: string;
  sub: string;
  lines: Line[];
  aiThinking?: boolean;
  tags?: string[];
};

// ---------- Scenarios (curated, multilingual, market-ready) ----------
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

// New Instant Training Scenarios
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

// Catalog with new Instant Training scenarios
const SCENARIOS: Scenario[] = [
  { 
    id: "hair_instant", 
    name: "Elite Hair Studio", 
    phone: "(555) 847-HAIR", 
    lang: "EN", 
    desc: "Instant Training Demo", 
    sub: "AI trained from website in real-time", 
    lines: HAIR_SALON_INSTANT,
    aiThinking: true,
    tags: ["Instant Training", "Live Data"]
  },
  { 
    id: "cafe_multilingual", 
    name: "Café Luna", 
    phone: "(555) 726-LUNA", 
    lang: "ES", 
    desc: "Multilingual + Training", 
    sub: "Same knowledge, Spanish responses", 
    lines: CAFE_MULTILINGUAL,
    aiThinking: true,
    tags: ["Multilingual", "Smart Learning"]
  },
  { id: "spa", name: "Serenity Spa", phone: "(555) 123-RELAX", lang: "EN", desc: "Appointment Booking", sub: "Massage & confirmation", lines: SPA_EN },
  { id: "restaurant", name: "Bella Vista", phone: "(555) 456-DINE", lang: "ES", desc: "Reserva (Español)", sub: "Reserva en español", lines: RESTAURANT_ES },
  { id: "support_bi", name: "Premier Services", phone: "(555) 789-HELP", lang: "BI", desc: "Support (EN↔ES)", sub: "Bilingual service call", lines: SUPPORT_BI },
  { id: "auto", name: "Triangle Auto Care", phone: "(555) 274-BRAKE", lang: "EN", desc: "Brake Inspection", sub: "Quote + same-day check", lines: AUTO_EN },
];

// ---------- Playback & audio utils (Lovable/Chrome-safe) ----------
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

async function tts(
  text: string,
  voiceId: string,
  format: "mp3" | "ulaw_8000" = "mp3",
  voiceSettings?: any,
  onEnded?: () => void,
  attachToWave?: (el: HTMLAudioElement) => void
) {
  if (!text?.trim()) {
    console.log("TTS: Empty text, skipping");
    return;
  }

  console.log(`TTS: Starting synthesis for voice ${voiceId}, text: "${text.slice(0, 50)}..."`);

  try {
    // 🔄 UPDATED: send output_format and optional voice_settings (server maps "mp3" → mp3_44100_128)
    const { data, error } = await supabase.functions.invoke("tts-voice", {
      body: { 
        text, 
        voiceId,
        modelId: "eleven_multilingual_v2",
        output_format: format,
        voice_settings: voiceSettings ?? DEFAULT_VOICE_SETTINGS,
      },
    });

    console.log("Voice function response:", { data, error });

    if (error) {
      console.error("TTS: Supabase function error:", error);
      throw new Error(`Voice function error: ${error.message || JSON.stringify(error)}`);
    }

    if (!data?.audioBase64) {
      console.error("TTS: No audio received in response:", data);
      throw new Error("No audio received from voice service");
    }

    const contentType = data.contentType || (format === "ulaw_8000" ? "audio/basic" : "audio/mpeg");
    console.log(`TTS: ElevenLabs success! type=${contentType} size=${data.audioBase64.length} chars`);

    await playAudioSegment(data.audioBase64, contentType, attachToWave);
    onEnded?.();
    
  } catch (error) {
    console.error("TTS: ElevenLabs failed:", error);
    
    // Fallback: Play a short beep and continue instead of stopping
    console.log("TTS: Using fallback audio beep");
    try {
      await ringOnce(300); // Short beep as fallback
      console.log("TTS: Fallback beep played, continuing...");
      onEnded?.();
    } catch (fallbackError) {
      console.error("TTS: Even fallback failed:", fallbackError);
      onEnded?.();
    }
  }
}

// 🔄 UPDATED: respect returned contentType and wire up waveform analyser
const playAudioSegment = (audioBase64: string, contentType: string, attachToWave?: (el: HTMLAudioElement) => void): Promise<void> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();

    const onEnded = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      reject(new Error("Audio playback failed"));
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // Attach to waveform visualizer if provided
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

// ---------- Waveform (simple Analyser visual on a Canvas) ----------
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

    // Cleanup previous
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

// ---------- Demo Page ----------
export default function DemoPage() {
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

  const qRef = useRef<AudioQueue | null>(null);
  const wave = useWaveform();

  useEffect(()=> { qRef.current = new AudioQueue(setNow); }, []);

  // Ensure Chrome/Lovable allows audio after a click
  async function unlockAudio() {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as any;
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume();
      await ctx.close();
    } catch {}
  }

  function reset() {
    setPlaying(false); setNow("Idle"); setTranscript([]); setCtaShown(false);
    setShowPostCall(false); setCallCompleted(false); setAiThinking(false);
    setKpi({ bookings: 0, timeSavedMin: 0, csat: 4.8 });
    qRef.current = new AudioQueue(setNow);
  }

  async function start() {
    await unlockAudio(); // Important for Lovable/Chrome previews
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
      if (line.who === "ring") {
        await q.add(async ()=> { setNow("Dialing…"); await ringOnce(1100 / pace); });
        continue;
      }
      const whoLabel = line.who === "ai" ? "Receptionist" : "Caller";
      const vId = line.voiceId || VOICE_AI_EN;
      const text = line.text || "";
      const delayAfter = Math.max(50, (line.pause ?? 100) / pace); // Reduced delays for natural flow

      await q.add(async ()=> {
        // Show AI thinking animation for scenarios with aiThinking enabled
        const isAiThinkingMoment = line.who === "ai" && sel.aiThinking && 
          /book|appointment|help|price|hour|reunión|reserva|precio|hora|disponible|espacio|appointment|menu|cost/i.test(text);
        
        if (isAiThinkingMoment) {
          setAiThinking(true);
          setNow("AI retrieving knowledge...");
          
          // Actually perform knowledge search
          try {
            const searchQuery = text.match(/(?:price|cost|menu|hora|precio|disponible|espacio|appointment)/i)?.[0] || "business info";
            console.log("AI Thinking: Searching knowledge base for:", searchQuery);
            const results = await ragSearch("demo-tenant", searchQuery, 3);
            console.log("Knowledge retrieved:", results.length, "items");
          } catch (error) {
            console.warn("Knowledge search failed:", error);
          }
          
          await new Promise(r => setTimeout(r, 800 + Math.random() * 1200)); // Random delay 0.8-2s
          setAiThinking(false);
        }
        
        setNow(`${whoLabel} speaking…`); pushT(whoLabel, text);
        if (line.who === "ai" && /booked|confirm|reserv|agendad|confirmée|reserva|all set/i.test(text)) {
          booked = true;
          setKpi((k)=> ({ ...k, bookings: k.bookings + 1, timeSavedMin: k.timeSavedMin + 6 }));
        }
        
        // Use Spanish-optimized settings for Spanish voices
        const voiceSettings = (vId === VOICE_AI_ES || vId === VOICE_CALLER_ES) 
          ? SPANISH_VOICE_SETTINGS 
          : DEFAULT_VOICE_SETTINGS;
        
        await tts(text, vId, format, voiceSettings, undefined, wave.attach);
        await new Promise((r)=> setTimeout(r, delayAfter));
      });
    }

    await q.add(async ()=> { 
      setNow("Call complete"); 
      setCallCompleted(true);
      if (booked) {
        setCtaShown(true);
        // Simulate post-call processing
        setTimeout(() => setShowPostCall(true), 1000);
      }
    });
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
    alert("✅ Follow-up SMS queued: 'Thanks for calling! Here's your confirmation link: https://example.com/book'");
  }

  const langs = ["ALL","EN","ES","BI"] as const;
  const [langFilter, setLangFilter] = useState<typeof langs[number]>("ALL");
  const visibleScenarios = useMemo(
    ()=> SCENARIOS.filter(s => langFilter==="ALL" ? true : s.lang===langFilter),
    [langFilter]
  );

  // Enhanced demo data for showcasing
  const getPostCallData = () => {
    const baseData = {
      spa: {
        customerData: {
          name: "Jamie Patel",
          phone: "(919) 555-0198",
          service: "90-min Massage",
          urgency: "Medium" as const,
          revenue: 149,
          conversionProb: 92
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: true,
          staffNotified: true
        }
      },
      restaurant: {
        customerData: {
          name: "Ana Rivera",
          phone: "(555) 123-4567",
          service: "Table for 4",
          urgency: "High" as const,
          revenue: 280,
          conversionProb: 88
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: false,
          staffNotified: true
        }
      },
      support_bi: {
        customerData: {
          name: "Customer",
          phone: "(214) 555-0123",
          service: "Water Heater Repair",
          urgency: "High" as const,
          revenue: 320,
          conversionProb: 95
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: false,
          staffNotified: true
        }
      },
      auto: {
        customerData: {
          name: "Marcus Lee",
          phone: "(919) 555-0110",
          service: "Brake Inspection",
          urgency: "Medium" as const,
          revenue: 189,
          conversionProb: 85
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: false,
          staffNotified: true
        }
      },
      hair_instant: {
        customerData: {
          name: "Jessica Martinez",
          phone: "(555) 123-4567",
          service: "Hair Highlights",
          urgency: "Medium" as const,
          revenue: 120,
          conversionProb: 94
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: false,
          staffNotified: true
        }
      },
      cafe_multilingual: {
        customerData: {
          name: "María González",
          phone: "(555) 234-5678",
          service: "Meeting Room Rental",
          urgency: "High" as const,
          revenue: 50,
          conversionProb: 96
        },
        businessImpact: {
          appointmentBooked: true,
          followUpScheduled: true,
          paymentProcessed: true,
          staffNotified: true
        }
      }
    };
    return baseData[sel.id as keyof typeof baseData] || baseData.spa;
  };

  const analyticsData = {
    callsHandled: 1247,
    conversionRate: 87,
    revenueGenerated: 142650,
    timeSaved: 320,
    customerSatisfaction: 4.8,
    missedCallsRecovered: 89
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Main Demo Section */}
      <div className="grid lg:grid-cols-2 gap-6">
      {/* Left: Controls */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle>AI Receptionist — Live Demo</CardTitle>
          <div className="text-sm text-muted-foreground">
            Human-paced, multilingual calls with realistic ring tones, live transcript, KPIs, and a PSTN (μ-law) toggle to prove real-world readiness.
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
              <button key={s.id} onClick={()=> setSel(s)} className={`text-left p-4 rounded-xl border transition ${sel.id===s.id? "bg-primary text-primary-foreground border-primary":"bg-card hover:bg-accent"}`}>
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

          {/* Controls */}
          <div className="flex gap-2">
            <Button className="rounded-2xl" onClick={start} disabled={playing}>{playing ? "Dialing…" : "Start Demo Call"}</Button>
            <Button variant="outline" className="rounded-2xl" onClick={reset} disabled={playing}>Reset</Button>
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
              <div className="flex items-center gap-1 text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">AI retrieving knowledge...</span>
              </div>
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
            <div className="p-3 rounded-xl bg-card shadow-sm">
              <div className="text-xs text-muted-foreground">Bookings captured</div>
              <div className="text-2xl font-semibold">{kpi.bookings}</div>
            </div>
            <div className="p-3 rounded-xl bg-card shadow-sm">
              <div className="text-xs text-muted-foreground">Time saved (min)</div>
              <div className="text-2xl font-semibold">{kpi.timeSavedMin}</div>
            </div>
            <div className="p-3 rounded-xl bg-card shadow-sm">
              <div className="text-xs text-muted-foreground">CSAT (demo)</div>
              <div className="text-2xl font-semibold">{kpi.csat.toFixed(1)}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={exportTxt} disabled={transcript.length===0}>Export transcript</Button>
            <Button variant="outline" className="rounded-2xl" onClick={simulateFollowUp} disabled={playing}>Simulate follow-up SMS</Button>
            {ctaShown && (
              <a href="#get-started" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Start Free Trial</a>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground mt-3">
            Voices by ElevenLabs • Toggle between <b>MP3</b> and <b>μ-law telephony</b> to show real-world readiness.
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Enhanced Post-Call Analytics Section */}
      {showPostCall && (
        <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
          <div className="text-center py-6 border-t border-dashed">
            <h2 className="text-2xl font-bold mb-2">Post-Call Intelligence & Business Impact</h2>
            <p className="text-muted-foreground">See how your AI receptionist drives real business results</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <PostCallIntelligence 
              scenario={sel.name}
              customerData={getPostCallData().customerData}
              businessImpact={getPostCallData().businessImpact}
            />
            <IntegrationShowcase />
          </div>

          <AnalyticsDashboard metrics={analyticsData} />

           <div className="grid lg:grid-cols-2 gap-6">
             <ROICalculator />
             <CompetitiveShowcase />
           </div>

           <KnowledgeShowcase />

          {/* Success Story Section */}
          <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="p-8 text-center">
              <h3 className="text-2xl font-bold text-blue-900 mb-4">
                Transform Your Business Like 2,500+ Companies
              </h3>
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div>
                  <div className="text-3xl font-bold text-blue-700">94%</div>
                  <div className="text-blue-600">Fewer Missed Calls</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-blue-700">$47K</div>
                  <div className="text-blue-600">Avg. Annual Revenue Increase</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-blue-700">24h</div>
                  <div className="text-blue-600">Setup Time</div>
                </div>
              </div>
              <div className="flex gap-4 justify-center">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Start Your Free Trial
                </Button>
                <Button size="lg" variant="outline" className="border-blue-300 text-blue-700">
                  Schedule Expert Demo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Call-to-Action for completed calls without booking */}
      {callCompleted && !ctaShown && (
        <Card className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
          <CardContent className="p-6 text-center">
            <h3 className="text-xl font-bold text-orange-900 mb-2">
              Even Non-Bookings Create Value
            </h3>
            <p className="text-orange-700 mb-4">
              This call still generated lead intelligence, customer insights, and brand touchpoints that traditional systems miss.
            </p>
            <Button className="bg-orange-600 hover:bg-orange-700">
              See How We Capture Every Opportunity
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
