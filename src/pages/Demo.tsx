import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Reliable ElevenLabs voice IDs
const VOICES = {
  receptionist: "EXAVITQu4vr4xnSDxMaL", // Sarah - clear female voice
  caller_female: "XB0fDUnXU5powFXDhCwa", // Charlotte - natural female voice  
  caller_male: "JBFqnCBsd6RMkjVDRZzb", // George - professional male voice
};

const VOICE_SETTINGS = {
  stability: 0.6,
  similarity_boost: 0.7,
  style: 0.15,
};

type Line = { 
  who: "ring" | "receptionist" | "caller"; 
  text?: string; 
  voice?: keyof typeof VOICES; 
  pause?: number 
};

type Scenario = { 
  id: string; 
  name: string; 
  phone: string; 
  desc: string; 
  lines: Line[] 
};

const SCENARIOS: Scenario[] = [
  {
    id: "spa",
    name: "Serenity Spa",
    phone: "(555) 123-RELAX",
    desc: "Appointment Booking",
    lines: [
      { who: "ring" },
      { who: "ring" },
      { who: "receptionist", text: "Thank you for calling Serenity Spa. This is your AI assistant, how may I help you today?", voice: "receptionist", pause: 400 },
      { who: "caller", text: "Hi! I'd like to book a massage for Friday afternoon.", voice: "caller_female", pause: 300 },
      { who: "receptionist", text: "I'd be happy to help you book a massage for Friday. What time works best for you?", voice: "receptionist", pause: 300 },
      { who: "caller", text: "Around 2 PM would be perfect.", voice: "caller_female", pause: 250 },
      { who: "receptionist", text: "Perfect! I have 2:15 PM available. May I have your name and phone number?", voice: "receptionist", pause: 350 },
      { who: "caller", text: "It's Sarah Chen, 555-0156.", voice: "caller_female", pause: 250 },
      { who: "receptionist", text: "Thank you Sarah! You're all set for Friday at 2:15 PM. I'll send a confirmation text.", voice: "receptionist", pause: 400 },
    ]
  },
  {
    id: "auto",
    name: "Triangle Auto Care", 
    phone: "(555) 274-BRAKE",
    desc: "Service Appointment",
    lines: [
      { who: "ring" },
      { who: "ring" },
      { who: "receptionist", text: "Thank you for calling Triangle Auto Care. This is your AI assistant. How can I help?", voice: "receptionist", pause: 350 },
      { who: "caller", text: "My car's brakes are squealing. Can I book a checkup?", voice: "caller_male", pause: 300 },
      { who: "receptionist", text: "I can schedule a brake inspection today. There's a $49 diagnostic fee. Does 2:30 PM work?", voice: "receptionist", pause: 350 },
      { who: "caller", text: "That works perfectly. It's a 2016 Honda Civic.", voice: "caller_male", pause: 250 },
      { who: "receptionist", text: "Great! May I have your name and number for the appointment?", voice: "receptionist", pause: 300 },
      { who: "caller", text: "Marcus Lee, 919-555-0110.", voice: "caller_male", pause: 250 },
      { who: "receptionist", text: "Perfect Marcus. You're scheduled for 2:30 PM today. I'll text you directions.", voice: "receptionist", pause: 400 },
    ]
  },
  {
    id: "dental",
    name: "Maple Dental",
    phone: "(555) 350-TEETH", 
    desc: "New Patient Booking",
    lines: [
      { who: "ring" },
      { who: "ring" },
      { who: "receptionist", text: "Maple Dental, this is your AI assistant. How can I help you today?", voice: "receptionist", pause: 350 },
      { who: "caller", text: "Hi, I'm a new patient. Do you take Delta Dental insurance?", voice: "caller_female", pause: 300 },
      { who: "receptionist", text: "Yes, we're in-network with Delta PPO. I can schedule your cleaning. Monday at 9 AM or Wednesday at 11 AM?", voice: "receptionist", pause: 350 },
      { who: "caller", text: "Wednesday at 11 works great.", voice: "caller_female", pause: 250 },
      { who: "receptionist", text: "Perfect! Could I have your full name and date of birth to start your chart?", voice: "receptionist", pause: 300 },
      { who: "caller", text: "Jamie Patel, January 12th, 1992.", voice: "caller_female", pause: 250 },
      { who: "receptionist", text: "Thank you Jamie. You're all set for Wednesday at 11 AM. I'll text the new patient forms.", voice: "receptionist", pause: 400 },
    ]
  }
];

class AudioQueue {
  private q: (() => Promise<void>)[] = [];
  private running = false;
  constructor(private setStatus: (s: string) => void) {}
  async add(task: () => Promise<void>) { 
    this.q.push(task); 
    if (!this.running) this.run(); 
  }
  private async run() {
    this.running = true;
    while (this.q.length) { 
      const fn = this.q.shift()!; 
      await fn(); 
    }
    this.running = false;
    this.setStatus("Ready");
  }
}

async function ringOnce(ms = 1200) {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const g = ctx.createGain(); 
  g.connect(ctx.destination); 
  g.gain.value = 0.05;
  const o1 = ctx.createOscillator(); 
  o1.frequency.value = 440; 
  o1.connect(g);
  const o2 = ctx.createOscillator(); 
  o2.frequency.value = 480; 
  o2.connect(g);
  o1.start(); 
  o2.start(); 
  await new Promise((r) => setTimeout(r, ms));
  o1.stop(); 
  o2.stop(); 
  g.disconnect(); 
  ctx.close();
}

async function playTTS(text: string, voiceId: string): Promise<void> {
  console.log(`🎵 Playing TTS: "${text.slice(0, 50)}..." with voice: ${voiceId}`);
  
  try {
    const { data, error } = await supabase.functions.invoke("voice", {
      body: { 
        text, 
        voiceId, 
        voice_settings: VOICE_SETTINGS, 
        output_format: "mp3" 
      },
      headers: { "Content-Type": "application/json" },
    });

    if (error) {
      console.error("❌ TTS Error:", error);
      throw error;
    }

    if (!data?.audioBase64) {
      console.error("❌ No audio data received");
      throw new Error("No audio data received");
    }

    console.log(`✅ Received audio data: ${data.audioBase64.length} chars`);

    const audioDataUrl = `data:audio/mpeg;base64,${data.audioBase64}`;
    const audio = new Audio(audioDataUrl);
    audio.volume = 0.8;

    await new Promise<void>((resolve, reject) => {
      audio.oncanplaythrough = () => {
        console.log("🔊 Audio ready to play");
        audio.play()
          .then(() => console.log("▶️ Audio playback started"))
          .catch(reject);
      };
      
      audio.onended = () => {
        console.log("✅ Audio playback finished");
        resolve();
      };
      
      audio.onerror = (e) => {
        console.error("❌ Audio playback error:", e);
        reject(new Error("Audio playback failed"));
      };
      
      audio.load();
    });

  } catch (error) {
    console.error("❌ TTS playback failed:", error);
    throw error;
  }
}

export default function DemoPage() {
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(SCENARIOS[0]);
  const [status, setStatus] = useState("Ready");
  const [playing, setPlaying] = useState(false);
  const [transcript, setTranscript] = useState<{ who: string; text: string }[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const qRef = useRef<AudioQueue | null>(null);

  useEffect(() => { 
    qRef.current = new AudioQueue(setStatus); 
  }, []);

  function reset() {
    setPlaying(false); 
    setStatus("Ready"); 
    setTranscript([]); 
    setProgress({ current: 0, total: 0 });
    qRef.current = new AudioQueue(setStatus);
  }

  async function startDemo() {
    reset();
    setPlaying(true);
    const q = qRef.current!;
    const lines = selectedScenario.lines;
    setProgress({ current: 0, total: lines.length });

    const addTranscript = (who: string, text: string) => {
      setTranscript((prev) => [...prev, { who, text }]);
      setTimeout(() => {
        const el = document.getElementById("transcript-scroll");
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    };

    let currentStep = 0;

    for (const line of lines) {
      if (line.who === "ring") {
        await q.add(async () => { 
          setStatus("Phone ringing..."); 
          await ringOnce(1000); 
          setProgress({ current: ++currentStep, total: lines.length }); 
        });
        continue;
      }

      const whoLabel = line.who === "receptionist" ? "AI Receptionist" : "Caller";
      const voiceKey = (line.voice ?? (line.who === "receptionist" ? "receptionist" : "caller_female")) as keyof typeof VOICES;
      const text = line.text || "";
      const delayAfter = line.pause ?? 250;

      await q.add(async () => {
        setStatus(`${whoLabel} speaking...`);
        addTranscript(whoLabel, text);
        
        try {
          await playTTS(text, VOICES[voiceKey]);
          await new Promise((r) => setTimeout(r, delayAfter));
        } catch (error) {
          console.error(`Failed to play TTS for: ${text}`, error);
        }
        
        setProgress({ current: ++currentStep, total: lines.length });
      });
    }

    await q.add(async () => { 
      setStatus("Call complete"); 
    });
    setPlaying(false);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>AI Receptionist Voice Demo</CardTitle>
          <div className="text-sm text-muted-foreground">
            Experience realistic AI-powered phone conversations with ElevenLabs voices
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <label className="text-sm font-medium">Choose a Business Scenario</label>
            <div className="grid md:grid-cols-3 gap-3">
              {SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => {
                    setSelectedScenario(scenario);
                    reset();
                  }}
                  className={`text-left p-4 rounded-xl border transition ${
                    selectedScenario.id === scenario.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card hover:bg-muted border-border"
                  }`}
                >
                  <div className="text-xs opacity-80">{scenario.phone}</div>
                  <div className="font-semibold">{scenario.name}</div>
                  <div className="text-sm opacity-90">{scenario.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button 
              onClick={startDemo} 
              disabled={playing}
              className="flex-1"
            >
              {playing ? "Call in Progress..." : "Start Demo Call"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={playing}>
              Reset
            </Button>
          </div>

          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-sm font-medium">{status}</div>
            <div className="text-xs text-muted-foreground">
              Step {progress.current} of {progress.total}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>Live Call Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            id="transcript-scroll"
            className="h-64 overflow-auto space-y-2 p-4 bg-muted/30 rounded-xl"
          >
            {transcript.length === 0 ? (
              <div className="h-full grid place-items-center text-muted-foreground text-sm">
                Select a scenario and press "Start Demo Call" to begin
              </div>
            ) : (
              transcript.map((entry, i) => (
                <div key={i} className={`flex ${entry.who === "AI Receptionist" ? "justify-start" : "justify-end"}`}>
                  <div className={`px-3 py-2 rounded-xl text-sm shadow-sm max-w-[80%] ${
                    entry.who === "AI Receptionist"
                      ? "bg-primary/10 text-primary-foreground border border-primary/20"
                      : "bg-secondary text-secondary-foreground"
                  }`}>
                    <div className="text-[10px] opacity-70 mb-1">{entry.who}</div>
                    <div>{entry.text}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground">
        Powered by ElevenLabs • High-quality AI voices • Real-time conversation simulation
      </div>
    </div>
  );
}