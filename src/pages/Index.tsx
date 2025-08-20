// src/pages/index.tsx
import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  Phone,
  CalendarDays,
  Bot,
  Stars,
  Shield,
  MessageSquare,
  Clock,
  ArrowRight,
  Lock,
  ActivitySquare,
  LayoutDashboard,
  Zap,
  TrendingUp,
  Globe,
  Award,
  Play,
  Brain,
  Users,
  Settings,
  Sparkles,
} from "lucide-react";

import { VoiceRelayLogo } from "@/components/VoiceRelayLogo";
import freshaLogo from "@/assets/logos/fresha.svg";
import squareLogo from "@/assets/logos/square.svg";
import vagaroLogo from "@/assets/logos/vagaro.svg";
import acuityLogo from "@/assets/logos/acuity.svg";
import calendlyLogo from "@/assets/logos/calendly.svg";
import outlookLogo from "@/assets/logos/outlook.svg";
import dashboardPreview from "@/assets/dashboard-preview.jpg"; // ← showcase image (replace with your real screenshot/GIF)
import MarketingShowcase from "@/components/MarketingShowcase";
import DemoPage from "@/pages/Demo";
import { CONFIG } from "@/lib/webhooks";
import { useSessionState } from "@/hooks/useSessionState";
import { supabase } from "@/lib/supabaseClient";

/* =========================
   SEO
   ========================= */
function SEOHead() {
  React.useEffect(() => {
    const title = "Voice Relay Pro — The AI Voice Receptionist That Trains From Your Website";
    const description =
      "Never miss a call again. Voice Relay Pro answers, books, and handles FAQs 24/7 — auto-trained from your website in minutes. See the onboarding → training → live call → dashboard demo.";
    document.title = title;

    const ensureMeta = (name: string, content: string) => {
      let m = document.querySelector(`meta[name="${name}"]`);
      if (!m) {
        m = document.createElement("meta");
        m.setAttribute("name", name);
        document.head.appendChild(m);
      }
      m.setAttribute("content", content);
    };
    ensureMeta("description", description);
    ensureMeta("og:title", title);
    ensureMeta("og:description", description);
    ensureMeta("twitter:card", "summary_large_image");

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    const url = `${window.location.origin}/`;
    link.setAttribute("href", url);
  }, []);
  return null;
}

/* =========================
   Hash Tabs (keeps your internal pages)
   ========================= */
function useHashTab(defaultTab: string) {
  const allowed = React.useMemo(
    () => new Set(["overview", "analytics", "messages", "knowledge", "settings", "billing", "onboarding"]),
    []
  );
  const getTabFromHash = () => {
    const raw = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    return allowed.has(raw) ? (raw as string) : defaultTab;
  };
  const [tab, setTab] = React.useState<string>(getTabFromHash);
  React.useEffect(() => {
    const onHash = () => setTab(getTabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [defaultTab, allowed]);
  const go = (t: string) => {
    const next = allowed.has(t) ? t : defaultTab;
    setTab(next);
    if (typeof window !== "undefined") window.location.hash = t;
  };
  return [tab, go] as const;
}

/* =========================
   Micro components
   ========================= */
function ChatBubble({ user = false, name, text }: { user?: boolean; name: string; text: string }) {
  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow ${user ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
        <div className="text-[11px] opacity-70 mb-1">{name}</div>
        <div>{text}</div>
      </div>
    </div>
  );
}

function SectionHeader({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <div className="max-w-3xl mx-auto text-center">
      {kicker && <p className="uppercase tracking-widest text-sm text-muted-foreground mb-2">{kicker}</p>}
      <h2 className="text-3xl md:text-4xl font-semibold leading-tight">{title}</h2>
      {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/* =========================
   Content Data
   ========================= */
const features = [
  { icon: <Phone className="w-6 h-6" aria-hidden />, title: "Answer Every Call", text: "Instant, friendly responses 24/7 — no voicemails, no lost leads." },
  { icon: <CalendarDays className="w-6 h-6" aria-hidden />, title: "Book in Real Time", text: "Live scheduling with your calendars or booking apps." },
  { icon: <Brain className="w-6 h-6" aria-hidden />, title: "Instant Auto-Training", text: "Paste your website; we learn services, prices, hours, FAQs in minutes." },
  { icon: <Globe className="w-6 h-6" aria-hidden />, title: "Multilingual", text: "Serve customers in English & Spanish seamlessly (more on request)." },
  { icon: <TrendingUp className="w-6 h-6" aria-hidden />, title: "Revenue Intelligence", text: "Summaries, outcomes, and dashboards that prove ROI." },
  { icon: <Shield className="w-6 h-6" aria-hidden />, title: "Secure by Design", text: "Encrypted in transit/at rest, role-based access, consent controls." },
];

const tiers = [
  { 
    name: "Starter", 
    price: "$49", 
    period: "/mo", 
    badge: "Best for solos", 
    points: [
      "Business-hours answering", 
      "Voicemail + transcription", 
      "Smart FAQs from website", 
      "Instant Training (1 site/month)",
      "Daily email/SMS summaries"
    ], 
    cta: "Start free trial" 
  },
  { 
    name: "Standard", 
    price: "$149", 
    period: "/mo", 
    badge: "Most popular", 
    points: [
      "24/7 call coverage", 
      "Live appointment booking", 
      "Calendar/booking integrations", 
      "Instant Training (unlimited)",
      "Call transfer & SMS confirmations"
    ], 
    highlighted: true as const, 
    cta: "Start free trial" 
  },
  { 
    name: "Premium", 
    price: "$349", 
    period: "/mo", 
    badge: "Scale & multilocation", 
    points: [
      "Advanced analytics & CRM sync", 
      "Priority support", 
      "Instant Training (unlimited)",
      "Multilingual receptionist (EN/ES)", 
      "White-label options & SLAs"
    ], 
    cta: "Talk to sales" 
  },
];

/* =========================
   Nav
   ========================= */
function NavBar() {
  const session = useSessionState();
  const authed = !!session;
  return (
    <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <VoiceRelayLogo size="md" />
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="#features" className="hover:opacity-80">Features</a>
          <a href="#pricing" className="hover:opacity-80">Pricing</a>
          <a href="#interactive-demo" className="hover:opacity-80">Live Demo</a>
          <a href="#dashboard" className="hover:opacity-80">Dashboard</a>
          <a href="#faq" className="hover:opacity-80">FAQ</a>
          <a href="#security" className="hover:opacity-80 inline-flex items-center gap-1"><Lock className="w-4 h-4" /> Security</a>
          {authed && <a href="/#admin" className="hover:opacity-80">Admin</a>}
        </nav>
        <div className="flex items-center gap-2">
          {!authed ? (
            <>
              <Button asChild variant="ghost"><a href="/#signin">Sign in</a></Button>
              <Button asChild className="rounded-2xl"><a href="/#app">Get started</a></Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost"><a href="/#app">Dashboard</a></Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => { supabase.auth.signOut(); }}>Sign out</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* =========================
   Hero (big promise + risk reversal)
   ========================= */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-[0.12] bg-[radial-gradient(600px_300px_at_20%_10%,theme(colors.primary.DEFAULT),transparent_60%)]" />
      <div className="absolute inset-x-0 top-[-120px] -z-10 h-[300px] bg-[radial-gradient(700px_200px_at_80%_0%,theme(colors.violet.500),transparent_60%)]" />
      <div className="max-w-6xl mx-auto px-4 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05]"
          >
            Never miss a call.
            <br />
            <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
              Book more appointments.
            </span>
          </motion.h1>

          <p className="mt-5 text-lg text-muted-foreground max-w-xl">
            Voice Relay Pro answers, books, and handles FAQs 24/7 — and it{" "}
            <b>auto-trains from your website in minutes</b>. See the end-to-end demo below.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-2xl">
              <a href="#interactive-demo" className="inline-flex items-center gap-2">
                Run Instant-Training Demo <Play className="w-4 h-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-2xl">
              <a href="#demo">Book a live walkthrough</a>
            </Button>
            <Button asChild variant="ghost" size="lg" className="rounded-2xl">
              <a href={`tel:${CONFIG.PHONE}`}>Call sales</a>
            </Button>
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Stars className="w-4 h-4" />
            <span>Avg. response under 2 seconds • 24/7 coverage • No code required</span>
          </div>
        </div>

        {/* Live chat preview */}
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-3xl p-6 bg-card shadow-xl ring-1 ring-border"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-2xl bg-primary text-primary-foreground">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold">Live call preview</div>
                <div className="text-sm text-muted-foreground">What your callers experience</div>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <ChatBubble user name="Caller" text="Hi, can I book a 90-minute massage Friday?" />
              <ChatBubble name="RelayAI" text="Absolutely! We have 2:15pm or 4:30pm — which is best?" />
              <ChatBubble user name="Caller" text="2:15pm. What’s the price?" />
              <ChatBubble name="RelayAI" text="It’s $149. I can confirm and text the details — shall I book it?" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Proof strip */}
      <div className="border-t bg-card/60">
        <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <Stat k="Fewer missed calls" v="94%" />
          <Stat k="Avg. revenue lift" v="$47k" />
          <Stat k="Setup time" v="1 day" />
          <Stat k="Customer CSAT" v="4.8/5" />
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="p-3 rounded-xl bg-background shadow-sm">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="text-2xl font-semibold">{v}</div>
    </div>
  );
}

/* =========================
   Trust Logos
   ========================= */
function TrustLogos() {
  const logos = [
    { name: "Fresha", logo: freshaLogo },
    { name: "Square", logo: squareLogo },
    { name: "Vagaro", logo: vagaroLogo },
    { name: "Acuity", logo: acuityLogo },
    { name: "Calendly", logo: calendlyLogo },
    { name: "Outlook", logo: outlookLogo },
  ];
  return (
    <section className="max-w-7xl mx-auto px-4 py-14">
      <div className="text-center mb-6">
        <p className="text-muted-foreground font-medium">Integrates with your tools</p>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-8 items-center">
        {logos.map((item, i) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4 }}
            viewport={{ once: true }}
            className="flex items-center justify-center p-6 rounded-2xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300 hover:scale-105 shadow-[var(--shadow-card)]"
          >
            <img src={item.logo} alt={`${item.name} integration`} className="h-8 w-auto opacity-70 hover:opacity-100 transition-opacity duration-300" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* =========================
   How It Works (3 steps)
   ========================= */
function HowItWorks() {
  const steps = [
    { icon: <Settings className="w-7 h-7" />, title: "Enter your business URL", text: "No complex setup — just your website and phone number." },
    { icon: <Globe className="w-7 h-7" />, title: "Auto-training kicks in", text: "We learn services, pricing, hours, directions, and FAQs." },
    { icon: <Zap className="w-7 h-7" />, title: "Go live in minutes", text: "Your AI receptionist answers calls and books appointments." },
  ];
  return (
    <section className="px-4 py-16 md:py-24 bg-muted/30">
      <SectionHeader kicker="How it works" title="From website to working receptionist in minutes" subtitle="Instant intelligence — no manuals, no scripts to write." />
      <div className="max-w-6xl mx-auto mt-12 grid md:grid-cols-3 gap-6">
        {steps.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
            viewport={{ once: true }}
            className="p-6 rounded-2xl bg-card shadow-sm border"
          >
            <div className="w-12 h-12 rounded-2xl bg-[image:var(--gradient-primary)] text-white grid place-items-center mb-4">{s.icon}</div>
            <div className="font-semibold mb-1">{s.title}</div>
            <div className="text-sm text-muted-foreground">{s.text}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* =========================
   Interactive Demo (your end-to-end flow)
   ========================= */
function InteractiveDemo() {
  return (
    <section id="interactive-demo" className="px-4 py-16 md:py-24 bg-muted/30">
      <div className="text-center mb-10">
        <p className="uppercase tracking-widest text-sm text-muted-foreground mb-2">Interactive Demo</p>
        <h2 className="text-3xl md:text-4xl font-semibold leading-tight">See Voice Relay Pro learn & book — live</h2>
        <p className="mt-3 text-muted-foreground">
          Experience onboarding → instant training → call routing → live call → analytics.
        </p>
      </div>
      <DemoPage />
    </section>
  );
}

/* =========================
   NEW: Customer Dashboard Showcase
   ========================= */
function DashboardShowcase() {
  const highlights = [
    { icon: <TrendingUp className="w-5 h-5" />, title: "Revenue impact", text: "Track bookings captured, conversion rate, and saved staff time." },
    { icon: <LayoutDashboard className="w-5 h-5" />, title: "Simple at a glance", text: "One place for calls, messages, appointments, and tasks." },
    { icon: <MessageSquare className="w-5 h-5" />, title: "Post-call summaries", text: "Every call summarized with next steps and outcomes." },
    { icon: <Users className="w-5 h-5" />, title: "Lead capture", text: "Auto-create leads, tag hot opportunities, and follow up in clicks." },
    { icon: <CalendarDays className="w-5 h-5" />, title: "Calendar sync", text: "Works with Google/Outlook, Acuity, Fresha, Vagaro, Square, etc." },
    { icon: <Zap className="w-5 h-5" />, title: "Automation-ready", text: "Confirmations, reminders, and CRM sync without extra tools." },
  ];

  const kpis = [
    { k: "Bookings this week", v: "48" },
    { k: "Missed calls recovered", v: "89%" },
    { k: "Avg. handle time", v: "1m 42s" },
    { k: "CSAT", v: "4.8/5" },
  ];

  return (
    <section id="dashboard" className="px-4 py-16 md:py-24">
      <SectionHeader
        kicker="Customer dashboard"
        title="Clarity after every call"
        subtitle="See impact instantly — appointments booked, time saved, top questions, and revenue trends."
      />

      <div className="max-w-7xl mx-auto mt-12 grid lg:grid-cols-2 gap-12 items-center">
        {/* Visual */}
        <motion.div
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="relative"
        >
          <img
            src={dashboardPreview}
            alt="Voice Relay Pro Dashboard Preview"
            className="rounded-3xl shadow-[var(--shadow-premium)] ring-1 ring-border w-full"
          />
          <div className="hidden md:block absolute -bottom-6 -right-6">
            <div className="p-4 rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <div className="text-xs opacity-90">Automation</div>
              <div className="text-sm font-semibold">Reminders enabled</div>
            </div>
          </div>
        </motion.div>

        {/* Copy + KPI + bullets */}
        <motion.div
          initial={{ opacity: 0, x: 28 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {kpis.map((s) => (
              <div key={s.k} className="p-4 rounded-xl bg-card shadow-sm border">
                <div className="text-xs text-muted-foreground">{s.k}</div>
                <div className="text-xl font-semibold">{s.v}</div>
              </div>
            ))}
          </div>

          {/* Highlights */}
          <div className="grid sm:grid-cols-2 gap-4">
            {highlights.map((h) => (
              <div key={h.title} className="p-4 rounded-xl bg-[image:var(--gradient-card)] border border-border/50">
                <div className="flex items-center gap-2 mb-1 text-primary">{h.icon}<span className="font-medium">{h.title}</span></div>
                <div className="text-sm text-muted-foreground">{h.text}</div>
              </div>
            ))}
          </div>

          {/* Value CTA */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="rounded-2xl">
              <a href="#app" className="inline-flex items-center gap-2">Open my dashboard <ArrowRight className="w-4 h-4" /></a>
            </Button>
            <Button asChild variant="outline" className="rounded-2xl">
              <a href="#interactive-demo">Replay the demo</a>
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Pro tip: Tag common questions to auto-answer faster; set reminders to follow up with high-intent leads.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* =========================
   Features Grid (benefit-first)
   ========================= */
function Features() {
  return (
    <section id="features" className="px-4 py-24 bg-card">
      <div className="max-w-7xl mx-auto">
        <SectionHeader
          kicker="Premium features"
          title="Everything a top receptionist does — without the overhead"
          subtitle="Configured in minutes. Tuned for your services, hours, and brand voice."
        />
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.45 }}
              viewport={{ once: true }}
              className="group p-6 rounded-2xl bg-[image:var(--gradient-card)] backdrop-blur-sm border border-border/50 hover:shadow-[var(--shadow-premium)] transition-all duration-300 hover:scale-[1.02]"
            >
              <div className="w-12 h-12 rounded-2xl bg-[image:var(--gradient-primary)] text-white grid place-items-center mb-4">
                {f.icon}
              </div>
              <div className="text-lg font-semibold mb-1">{f.title}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{f.text}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================
   Social Proof: Testimonials
   ========================= */
function Testimonials() {
  const quotes = [
    {
      quote: "We stopped losing weekend calls. Bookings jumped 28% in the first month.",
      who: "Maya B., Spa Owner",
    },
    {
      quote: "Customers think it’s human. It knows our services and prices cold.",
      who: "Chris L., Auto Shop Manager",
    },
    {
      quote: "Setup took minutes. Now our front desk isn’t drowning in calls.",
      who: "Ana R., Salon Director",
    },
  ];
  return (
    <section className="px-4 py-16">
      <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
        {quotes.map((q, i) => (
          <motion.blockquote
            key={q.who}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1, duration: 0.45 }}
            viewport={{ once: true }}
            className="p-6 rounded-2xl bg-card shadow-sm border"
          >
            <Sparkles className="w-5 h-5 text-primary mb-3" />
            <p className="text-lg leading-relaxed">“{q.quote}”</p>
            <footer className="text-sm text-muted-foreground mt-3">— {q.who}</footer>
          </motion.blockquote>
        ))}
      </div>
    </section>
  );
}

/* =========================
   Pricing (teaser with risk reversal)
   ========================= */
function Pricing() {
  return (
    <section id="pricing" className="px-4 py-16 md:py-24 bg-card">
      <SectionHeader kicker="Pricing" title="Simple plans that scale with you" subtitle="No long contracts. Upgrade or cancel anytime." />
      <div className="max-w-7xl mx-auto mt-10 grid md:grid-cols-3 gap-6">
        {tiers.map((t) => (
          <Card key={t.name} className={`rounded-2xl shadow-sm ${t.highlighted ? "ring-2 ring-primary shadow-xl scale-[1.02]" : ""}`}>
            <CardHeader className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{t.badge}</div>
              <CardTitle className="text-2xl">{t.name}</CardTitle>
              <div className="text-3xl font-bold mt-2">
                {t.price}
                <span className="text-base font-normal text-muted-foreground">{t.period}</span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-6">
                {t.points.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <Check className="w-5 h-5 mt-0.5 text-primary" /> <span>{p}</span>
                  </li>
                ))}
              </ul>
              <Button className="w-full rounded-2xl" variant={t.highlighted ? "default" : "outline"}>
                {t.cta}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-3">14-day free trial • No credit card • Cancel anytime</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground mt-6">
        Need custom volume pricing or on-prem? <a className="underline" href="#contact">Talk to sales</a>.
      </p>
    </section>
  );
}

/* =========================
   FAQ
   ========================= */
function FAQ() {
  const faqs = [
    { q: "How does it connect to my booking system?", a: "We integrate with Google/Outlook calendars and platforms like Acuity, Fresha, Vagaro, Square, and Calendly." },
    { q: "Can it transfer a call to a real person?", a: "Yes. Configure business hours and escalation rules; live transfer or voicemail fallback is supported." },
    { q: "Will it sound robotic?", a: "We use natural voices and pacing with on-brand scripts. Hear the demo’s realism yourself." },
    { q: "Is my data secure?", a: "Encrypted in transit and at rest. Per-tenant isolation, consent prompts, and configurable retention." },
    { q: "Do you support Spanish?", a: "Yes — multilingual EN/ES is included on Standard and Premium." },
  ];
  return (
    <section id="faq" className="px-4 py-16 md:py-24">
      <SectionHeader kicker="FAQ" title="Answers to common questions" subtitle="Still curious? Send us a note — we’ll reply fast." />
      <div className="max-w-3xl mx-auto mt-10 divide-y rounded-2xl bg-card shadow-sm">
        {faqs.map((f, i) => (
          <details key={i} className="group p-6">
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <span className="font-medium">{f.q}</span>
              <span className="text-muted-foreground group-open:rotate-180 transition-transform">⌄</span>
            </summary>
            <p className="mt-3 text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* =========================
   Security
   ========================= */
function Security() {
  return (
    <section id="security" className="px-4 py-16 md:py-24 bg-card">
      <SectionHeader kicker="Security" title="How we protect your business and your callers" />
      <div className="max-w-5xl mx-auto mt-10 grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Data protection</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground space-y-2">
            <p>Encryption in transit (TLS 1.2+) and at rest (AES-256). Per-tenant isolation with RBAC.</p>
            <p>Secrets via KMS; least-privilege access for internal tooling.</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Privacy & compliance</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground space-y-2">
            <p>Recording consent with state-aware prompts; optional PII redaction in transcripts.</p>
            <p>10DLC registration for branded SMS; STIR/SHAKEN for outbound caller ID.</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><ActivitySquare className="w-5 h-5" /> Reliability & status</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            <p>Target 99.9% availability with active monitoring and vendor failover.</p>
            <p className="mt-2"><a className="underline" href={`https://status.${CONFIG.DOMAIN}`} target="_blank" rel="noreferrer">{`status.${CONFIG.DOMAIN}`}</a></p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

/* =========================
   Footer + Floating Contact
   ========================= */
function Footer() {
  const session = useSessionState();
  return (
    <footer className="px-4 pb-12">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6 items-center">
        <div className="text-sm text-muted-foreground">© {new Date().getFullYear()} {CONFIG.COMPANY}. All rights reserved.</div>
        <div className="flex gap-4 justify-start md:justify-end text-sm">
          <a href="#security" className="underline">Security</a>
          <a href="#faq" className="underline">FAQ</a>
          <a href="#pricing" className="underline">Pricing</a>
          <a href="#interactive-demo" className="underline">Demo</a>
          <a href="#dashboard" className="underline">Dashboard</a>
        </div>
      </div>
    </footer>
  );
}

function useLeadForm(defaults: Record<string,string> = {}){
  const [submitting,setSubmitting]=React.useState(false);
  const [done,setDone]=React.useState<string|null>(null);
  const [error,setError]=React.useState<string|null>(null);

  async function submit(payload: Record<string,string>){
    setSubmitting(true); setError(null); setDone(null);
    try{
      const { data: sess } = await supabase.auth.getSession();
      let tenant: string | null = null;
      if (sess.session) {
        const { data: prof } = await supabase.from("profiles").select("active_tenant_id").eq("id", sess.session.user.id).single();
        tenant = prof?.active_tenant_id || null;
      }
      if (tenant) {
        const leadPayload = {
          tenant_id: tenant,
          name: payload.name || payload.business || "(no name)",
          phone: payload.phone || payload.mobile || "",
          email: payload.email || "",
          source: defaults.form === "contact" ? "WebContact" : "WebTrial",
          status: "New",
          notes: payload.message || payload.details || payload.description || "",
          created_at: new Date().toISOString()
        } as any;
        await supabase.from("leads").insert(leadPayload);
      }
      if (CONFIG.WEBHOOK_URL) {
        await fetch(CONFIG.WEBHOOK_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ...defaults, ...payload, page: typeof window!=='undefined'? window.location.href : '' }) });
      }
      setDone("Thanks! We'll be in touch shortly.");
    }catch(e:any){
      setError('Something went wrong. Please try again or email us.');
    } finally{
      setSubmitting(false);
    }
  }
  return { submitting, done, error, submit } as const;
}

function ContactFloating() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const form = useLeadForm({ form: 'contact' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit({ name, email, message });
    if (form.done) {
      setName(""); setEmail(""); setMessage("");
      setIsOpen(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="lg"
        className="rounded-full h-14 w-14 shadow-lg hover:shadow-xl transition-all duration-200"
      >
        <MessageSquare className="w-6 h-6" />
      </Button>

      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="absolute bottom-16 right-0 w-80"
        >
          <Card className="rounded-2xl shadow-xl">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4" /> Talk to us
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="h-8 w-8 p-0">×</Button>
              </div>
              <p className="text-xs text-muted-foreground">We usually reply within minutes.</p>
            </CardHeader>
            <CardContent>
              <form className="grid gap-2" onSubmit={onSubmit}>
                <Input placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} />
                <Input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <Textarea rows={3} placeholder="How can we help?" value={message} onChange={(e) => setMessage(e.target.value)} />
                <Button className="rounded-2xl w-full" disabled={form.submitting}>
                  {form.submitting ? "Sending..." : "Send"}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Or email us: <a className="underline" href={`mailto:hello@${CONFIG.DOMAIN}`}>hello@{CONFIG.DOMAIN}</a>
                </p>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

/* =========================
   Page
   ========================= */
export default function AIReceptionistApp() {
  const [tab] = useHashTab("overview");

  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] text-foreground">
      <SEOHead />
      <NavBar />
      <main>
        {(!tab || tab === "overview") && (
          <>
            <Hero />
            <TrustLogos />
            <MarketingShowcase />
            <HowItWorks />
            <InteractiveDemo />
            <DashboardShowcase />
            <Features />
            <Testimonials />
            <Pricing />
            <FAQ />
            <Security />
          </>
        )}
      </main>
      <Footer />
      <ContactFloating />
    </div>
  );
}
