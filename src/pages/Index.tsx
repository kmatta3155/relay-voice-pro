import React from "react";
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
  Sparkles,
  Play,
  Brain,
  Users,
  Settings,
} from "lucide-react";
import { motion } from "framer-motion";
import { CONFIG } from "@/lib/webhooks";

/* =========================
   Chat Bubble Component
   ========================= */
function ChatBubble({ user, name, text }: { user?: boolean; name: string; text: string }) {
  return (
    <div className={`flex gap-3 ${user ? 'justify-end' : ''}`}>
      {!user && <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Bot className="w-4 h-4" />
      </div>}
      <div className={`max-w-[80%] ${user ? 'text-right' : ''}`}>
        <div className="text-xs text-muted-foreground mb-1">{name}</div>
        <div className={`p-3 rounded-2xl text-sm ${user ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}>
          {text}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Trust Logos Component
   ========================= */
function TrustLogos() {
  const logos = [
    { src: freshaLogo, alt: "Fresha", name: "Fresha" },
    { src: squareLogo, alt: "Square", name: "Square" },
    { src: vagaroLogo, alt: "Vagaro", name: "Vagaro" },
    { src: acuityLogo, alt: "Acuity", name: "Acuity" },
    { src: calendlyLogo, alt: "Calendly", name: "Calendly" },
    { src: outlookLogo, alt: "Outlook", name: "Outlook" },
  ];

  return (
    <section className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <p className="text-sm text-muted-foreground uppercase tracking-wider">Integrates with your existing tools</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-8 opacity-60">
        {logos.map((logo) => (
          <img key={logo.name} src={logo.src} alt={logo.alt} className="h-8 w-auto grayscale hover:grayscale-0 transition-all" />
        ))}
      </div>
    </section>
  );
}

/* =========================
   Features Component
   ========================= */
function Features() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-4 py-16 md:py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-semibold mb-4">Everything you need to never miss a call</h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          From instant training to multilingual support, our AI receptionist adapts to your business needs.
        </p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {features.map((feature, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            viewport={{ once: true }}
            className="group"
          >
            <Card className="h-full hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    {feature.icon}
                  </div>
                  <h3 className="font-semibold">{feature.title}</h3>
                </div>
                <p className="text-muted-foreground">{feature.text}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* =========================
   Pricing Component
   ========================= */
function Pricing() {
  return (
    <section id="pricing" className="max-w-6xl mx-auto px-4 py-16 md:py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-semibold mb-4">Simple, transparent pricing</h2>
        <p className="text-lg text-muted-foreground">Start free, upgrade when you're ready. No hidden fees.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-8">
        {tiers.map((tier, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            viewport={{ once: true }}
          >
            <Card className={`h-full ${tier.highlighted ? 'ring-2 ring-primary shadow-xl scale-105' : ''}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{tier.name}</CardTitle>
                  {tier.badge && (
                    <div className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
                      {tier.badge}
                    </div>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground">{tier.period}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  {tier.points.map((point, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{point}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className="w-full rounded-2xl" 
                  variant={tier.highlighted ? "default" : "outline"}
                >
                  {tier.cta}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
import freshaLogo from "@/assets/logos/fresha.svg";
import squareLogo from "@/assets/logos/square.svg";
import vagaroLogo from "@/assets/logos/vagaro.svg";
import acuityLogo from "@/assets/logos/acuity.svg";
import calendlyLogo from "@/assets/logos/calendly.svg";
import outlookLogo from "@/assets/logos/outlook.svg";
import { useSessionState } from "@/hooks/useSessionState";
import DemoPage from "@/pages/Demo";
import MarketingShowcase from "@/components/MarketingShowcase";

/* =========================
   SEO
   ========================= */
function SEOHead() {
  React.useEffect(() => {
    const title = "AI Receptionist that Trains from Your Website | RelayAI";
    const description =
      "Instant-training AI receptionist: answer every call, book appointments, and handle FAQs 24/7. Demo shows onboarding → training → live call → analytics.";
    document.title = title;

    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);

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
   Features
   ========================= */
const features = [
  {
    icon: <Brain className="w-6 h-6" aria-hidden />,
    title: "Instant Training",
    text: "Paste your website. We auto-learn services, hours, pricing, and FAQs in minutes—no long setup."
  },
  {
    icon: <Phone className="w-6 h-6" aria-hidden />,
    title: "Answer Every Call",
    text: "Friendly, on-brand voice 24/7. Recover missed calls and capture bookings automatically."
  },
  {
    icon: <CalendarDays className="w-6 h-6" aria-hidden />,
    title: "Book & Confirm",
    text: "Live scheduling with Google/Outlook or your booking app. Optional SMS confirmations & reminders."
  },
  {
    icon: <MessageSquare className="w-6 h-6" aria-hidden />,
    title: "Smart FAQs",
    text: "Accurate answers about pricing, services, directions—grounded in your trained knowledge."
  },
  {
    icon: <Globe className="w-6 h-6" aria-hidden />,
    title: "Multilingual",
    text: "Serve callers in English & Spanish out of the box—keep the same knowledge, switch the language."
  },
  {
    icon: <TrendingUp className="w-6 h-6" aria-hidden />,
    title: "Post-Call Intelligence",
    text: "Summaries, analytics, and CRM sync—see revenue impact and conversion trends from day one."
  },
];

/* =========================
   Pricing
   ========================= */
const tiers = [
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    badge: "Best for solos",
    points: [
      "Business-hours call answering",
      "Voicemail + transcription",
      "Smart FAQs (from website)",
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
      "Multilingual reception (EN/ES)",
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
    <header className="sticky top-0 z-40 backdrop-blur border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.div initial={{ rotate: -15, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200 }} className="p-2 rounded-2xl bg-primary text-primary-foreground shadow">
            <Bot className="w-5 h-5" />
          </motion.div>
          <span className="font-semibold tracking-tight">RelayAI Receptionist</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="#features" className="hover:opacity-80">Features</a>
          <a href="#pricing" className="hover:opacity-80">Pricing</a>
          <a href="#interactive-demo" className="hover:opacity-80">Interactive Demo</a>
          <a href="#faq" className="hover:opacity-80">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          {!authed ? (
            <>
              <Button asChild variant="ghost"><a href="#signin">Sign in</a></Button>
              <Button asChild className="rounded-2xl"><a href="#app">Get started</a></Button>
            </>
          ) : (
            <Button asChild className="rounded-2xl"><a href="#app">Open dashboard</a></Button>
          )}
        </div>
      </div>
    </header>
  );
}

/* =========================
   Hero
   ========================= */
function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
      <div>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
          AI receptionist that{" "}
          <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
            trains itself from your website
          </span>
        </motion.h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Paste your URL → watch it learn services, hours, and pricing → see it book real appointments. The interactive demo shows the full flow.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="rounded-2xl">
            <a href="#interactive-demo" className="inline-flex items-center gap-2">
              Run instant-training demo <Play className="w-4 h-4" />
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-2xl"><a href="#demo">Book a live walkthrough</a></Button>
        </div>
      </div>
      <div className="relative">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-3xl p-6 bg-card shadow-xl ring-1 ring-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-primary text-primary-foreground"><Phone className="w-5 h-5" /></div>
            <div>
              <div className="font-semibold">Live call preview</div>
              <div className="text-sm text-muted-foreground">What your callers experience</div>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <ChatBubble user name="Caller" text="Hi, any openings for Friday afternoon?" />
            <ChatBubble name="RelayAI" text="Absolutely! Which service and time works best?" />
            <ChatBubble user name="Caller" text="Full synthetic oil change, around 2pm." />
            <ChatBubble name="RelayAI" text="Great—2:15pm with Alex is available. Shall I confirm?" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =========================
   Page Export
   ========================= */
export default function AIReceptionistApp() {
  const [tab] = useHashTab("overview");
  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] text-foreground">
      <SEOHead />
      <NavBar />
      <main>
        {(!tab || tab === 'overview') && (
          <>
            <Hero />
            <TrustLogos />
            <MarketingShowcase />
            <section id="interactive-demo" className="px-4 py-16 md:py-24 bg-muted/30">
              <div className="text-center mb-10">
                <h2 className="text-3xl md:text-4xl font-semibold">Run the end-to-end receptionist demo</h2>
                <p className="mt-3 text-muted-foreground">See onboarding → instant training → call routing → live call → analytics.</p>
              </div>
              <DemoPage />
            </section>
            <Features />
            <Pricing />
          </>
        )}
      </main>
    </div>
  );
}
