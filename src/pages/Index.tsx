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
} from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { postWebhook, CONFIG } from "@/lib/webhooks";
import freshaLogo from "@/assets/logos/fresha.svg";
import squareLogo from "@/assets/logos/square.svg";
import vagaroLogo from "@/assets/logos/vagaro.svg";
import acuityLogo from "@/assets/logos/acuity.svg";
import calendlyLogo from "@/assets/logos/calendly.svg";
import outlookLogo from "@/assets/logos/outlook.svg";
import heroImage from "@/assets/hero-ai-receptionist.jpg";
import dashboardPreview from "@/assets/dashboard-preview.jpg";
import featuresShowcase from "@/assets/features-showcase.jpg";
import { getDashboardMetrics } from "@/lib/analytics";
import { openCheckout } from "@/lib/billing";
import AnalyticsPage from "@/pages/AnalyticsPage";
import MessagesPage from "@/pages/MessagesPage";
import KnowledgePage from "@/pages/KnowledgePage";
import OnboardingPage from "@/pages/Onboarding";
import SettingsPage from "@/pages/SettingsPage";
import BillingPage from "@/pages/BillingPage";
import { useSessionState } from "@/hooks/useSessionState";
import { supabase } from "@/lib/supabaseClient";
import DemoPage from "@/pages/Demo";
import MarketingShowcase from "@/components/MarketingShowcase";
// SEO head tags (title, description, canonical)
function SEOHead() {
  React.useEffect(() => {
    const title = "AI Receptionist for Small Businesses | RelayAI";
    const description =
      "RelayAI answers calls, handles FAQs, and books appointments 24/7. Friendly, on‑brand voice with scheduling and summaries.";
    document.title = title;

    // meta description
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);

    // canonical
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


const features = [
  { icon: <Phone className="w-6 h-6" aria-hidden />, title: "Answer Every Call", text: "Friendly, on-brand voice 24/7—never miss a booking." },
  { icon: <CalendarDays className="w-6 h-6" aria-hidden />, title: "Book Appointments", text: "Real-time scheduling with Google/Outlook or your booking app." },
  { icon: <MessageSquare className="w-6 h-6" aria-hidden />, title: "Smart FAQs", text: "Instant answers about pricing, services, hours, and directions." },
  { icon: <Shield className="w-6 h-6" aria-hidden />, title: "Call Summaries", text: "Auto notes + SMS/email follow‑ups to reduce no‑shows." },
  { icon: <Clock className="w-6 h-6" aria-hidden />, title: "After-Hours Magic", text: "Capture nights & weekends callers you’d otherwise miss." },
  { icon: <Bot className="w-6 h-6" aria-hidden />, title: "Industry-Tuned", text: "Prebuilt flows for salons, auto shops, med spas, contractors, and more." },
];

const faqs = [
  { q: "How does it connect to my booking system?", a: "We integrate via API or calendar links with Google Calendar, Outlook, Acuity, Fresha, Vagaro, Square, and more. We map services, durations, and staff availability during onboarding." },
  { q: "Can it transfer a call to a real person?", a: "Yes. Configure business hours and escalation rules; live transfer or voicemail fallback is supported." },
  { q: "Will it sound robotic?", a: "We use natural voices with tuning for pace and tone. Provide sample scripts and we’ll match your brand." },
  { q: "Is my data secure?", a: "All traffic is encrypted. You control retention and redaction options for PII and payment details." },
  { q: "Do you support Spanish or other languages?", a: "Yes—multilingual support is part of our Premium plan." },
];

const tiers = [
  { name: "Starter", price: "$49", period: "/mo", badge: "Best for solos", points: ["Business‑hours call answering", "Voicemail + transcription", "Basic FAQ responses", "Email/SMS summaries (daily)"], cta: "Start free trial" },
  { name: "Standard", price: "$149", period: "/mo", badge: "Most popular", points: ["24/7 call coverage", "Live appointment booking", "Calendar/booking integrations", "Automated reminders"], highlighted: true as const, cta: "Start free trial" },
  { name: "Premium", price: "$349", period: "/mo", badge: "Scale & multilocation", points: ["Unlimited calls/minutes", "Analytics & CRM sync", "Multilingual + custom voice", "White‑label & SLAs"], cta: "Talk to sales" },
];

function SectionHeader({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <div className="max-w-3xl mx-auto text-center">
      {kicker && <p className="uppercase tracking-widest text-sm text-muted-foreground mb-2">{kicker}</p>}
      <h2 className="text-3xl md:text-4xl font-semibold leading-tight">{title}</h2>
      {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export default function AIReceptionistApp() {
  const [tab] = useHashTab("overview");
  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] text-foreground">
      <SEOHead />
      <SEOJsonLD />
      <NavBar />
      <main>
        {(!tab || tab === 'overview') && (
          <>
            <Hero />
            <TrustLogos />
            <MarketingShowcase />
            <Features />
            <Pricing />
            <Demo />
            <section id="interactive-demo" className="px-4 py-16 md:py-24 bg-muted/30">
              <div className="text-center mb-10">
                <p className="uppercase tracking-widest text-sm text-muted-foreground mb-2">Interactive Demo</p>
                <h2 className="text-3xl md:text-4xl font-semibold leading-tight">See RelayAI in Action</h2>
                <p className="mt-3 text-muted-foreground">Experience real AI-powered conversations with waveform visualization</p>
              </div>
              <DemoPage />
            </section>
            <GetStarted />
            <FAQ />
            <Security />
            <Legal />
          </>
        )}
        {tab === 'analytics' && <AnalyticsPage />}
        {tab === 'messages' && <MessagesPage />}
        {tab === 'knowledge' && <KnowledgePage />}
        {tab === 'onboarding' && <OnboardingPage />}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'billing' && <BillingPage />}
      </main>
      <Footer />
      <div id="contact" className="fixed bottom-4 right-4"><ContactFloating /></div>
    </div>
  );
}

function NavBar() {
  const session = useSessionState();
  const authed = !!session;
  return (
    <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b">
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
          <a href="#demo" className="hover:opacity-80">Live Demo</a>
          <a href="#faq" className="hover:opacity-80">FAQ</a>
          <a href="#security" className="hover:opacity-80 inline-flex items-center gap-1"><Lock className="w-4 h-4" /> Security</a>
          {authed && (
            <>
              <a href="#app" className="hover:opacity-80 inline-flex items-center gap-1"><LayoutDashboard className="w-4 h-4" /> Dashboard</a>
              <a href="#admin" className="hover:opacity-80">Admin</a>
            </>
          )}
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


function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
      <div>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
          Never miss a call.{" "}
          <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
            Book more appointments.
          </span>
        </motion.h1>
        <p className="mt-5 text-lg text-muted-foreground">
          RelayAI answers calls, handles FAQs, and books appointments for your business—24/7. Built for salons, auto shops, med spas, home services, and more.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="rounded-2xl"><a href="#app" className="inline-flex items-center gap-2">Try it free <ArrowRight className="w-4 h-4" /></a></Button>
          <Button asChild variant="outline" size="lg" className="rounded-2xl"><a href="#demo">Live Demo</a></Button>
          <Button asChild variant="ghost" size="lg" className="rounded-2xl"><a href={`tel:${CONFIG.PHONE}`}>Call sales</a></Button>
        </div>
        <ConsentNote />
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Stars className="w-4 h-4" /><span>Avg. response under 2 seconds • 24/7 coverage</span>
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
            <ChatBubble user name="Caller" text="Hi, do you have any openings for Friday afternoon?" />
            <ChatBubble name="RelayAI" text="Absolutely! For which service and preferred time?" />
            <ChatBubble user name="Caller" text="Full synthetic oil change, around 2pm." />
            <ChatBubble name="RelayAI" text="Got it. I can book you for 2:15pm with Alex. Shall I confirm?" />
            <ChatBubble user name="Caller" text="Yes, please. Also, what’s the price?" />
            <ChatBubble name="RelayAI" text="It’s $79. Includes multi‑point inspection. See you Friday!" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ConsentNote() {
  return (
    <div className="mt-4 text-xs text-muted-foreground max-w-lg">
      <strong>Recording & consent:</strong> When enabled, callers hear a brief notice that calls may be recorded for quality and training. We honor state‑specific consent rules, and you can disable recording anytime.
    </div>
  );
}

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
    <section className="max-w-7xl mx-auto px-4 py-16">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-12"
      >
        <p className="text-muted-foreground font-medium">Trusted by 10,000+ businesses and integrates with</p>
      </motion.div>
      
      <div className="grid grid-cols-3 md:grid-cols-6 gap-8 items-center">
        {logos.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.5 }}
            className="flex items-center justify-center p-6 rounded-2xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300 hover:scale-105 shadow-[var(--shadow-card)]"
          >
            <img 
              src={item.logo} 
              alt={`${item.name} integration`} 
              className="h-8 w-auto opacity-70 hover:opacity-100 transition-opacity duration-300"
            />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function MetricsOverview() {
  const leads = React.useMemo(() => [{ score: 85 }, { score: 60 }, { score: 92 }], []);
  const appointments = React.useMemo(() => [{}, {}], []);
  const messages = React.useMemo(() => Array.from({ length: 7 }, () => ({})), []);
  const metrics = getDashboardMetrics({ leads, appointments, messages });
  return (
    <section className="max-w-6xl mx-auto px-4 pb-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl shadow">
          <div className="text-sm text-gray-500">Conversion Rate</div>
          <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
        </div>
        <div className="p-4 bg-white rounded-xl shadow">
          <div className="text-sm text-gray-500">Hot Leads</div>
          <div className="text-2xl font-bold">{metrics.hotLeads}</div>
        </div>
        <div className="p-4 bg-white rounded-xl shadow">
          <div className="text-sm text-gray-500">Appointments</div>
          <div className="text-2xl font-bold">{metrics.totalAppointments}</div>
        </div>
        <div className="p-4 bg-white rounded-xl shadow">
          <div className="text-sm text-gray-500">Messages</div>
          <div className="text-2xl font-bold">{metrics.totalMessages}</div>
        </div>
      </div>
    </section>
  );
}

function UpgradeCTA() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex justify-center">
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={() => openCheckout("plan_receptionist_crm")}
        >
          Upgrade to Receptionist + CRM
        </button>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="px-4 py-24 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/50 text-accent-foreground text-sm font-medium mb-6">
            <Award className="w-4 h-4" />
            Premium Features
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Everything a receptionist does—
            <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
              {" "}without the overhead
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Configured in minutes. Tuned for your services, hours, and brand voice.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-16 items-center mb-16">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <img 
              src={featuresShowcase} 
              alt="Features showcase" 
              className="rounded-3xl shadow-[var(--shadow-premium)] w-full"
            />
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="space-y-8"
          >
            {features.slice(0, 3).map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.2, duration: 0.6 }}
                viewport={{ once: true }}
                className="flex gap-6"
              >
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-[image:var(--gradient-primary)] text-white grid place-items-center shadow-lg">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.text}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {features.slice(3).map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.2, duration: 0.6 }}
              viewport={{ once: true }}
              className="group p-8 rounded-3xl bg-[image:var(--gradient-card)] backdrop-blur-sm border border-border/50 hover:shadow-[var(--shadow-premium)] transition-all duration-300 hover:scale-105"
            >
              <div className="w-12 h-12 rounded-2xl bg-[image:var(--gradient-primary)] text-white grid place-items-center mb-6 group-hover:scale-110 transition-transform duration-300">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="px-4 py-16 md:py-24 bg-card">
      <SectionHeader kicker="Pricing" title="Simple plans that scale with you" subtitle="No long contracts. Upgrade or cancel anytime." />
      <div className="max-w-6xl mx-auto mt-10 grid md:grid-cols-3 gap-6">
        {tiers.map((t) => (
          <Card key={t.name} className={`rounded-2xl shadow-sm ${t.highlighted ? "ring-2 ring-primary" : ""}`}>
            <CardHeader className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{t.badge}</div>
              <CardTitle className="text-2xl">{t.name}</CardTitle>
              <div className="text-3xl font-bold mt-2">{t.price}<span className="text-base font-normal text-muted-foreground">{t.period}</span></div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-6">
                {t.points.map((p) => (
                  <li key={p} className="flex items-start gap-2"><Check className="w-5 h-5 mt-0.5" /> <span>{p}</span></li>
                ))}
              </ul>
              <Button className="w-full rounded-2xl" variant={t.highlighted ? "default" : "outline"}>{t.cta}</Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground mt-6">Need custom volume pricing or on‑prem? <a className="underline" href="#contact">Talk to sales</a>.</p>
    </section>
  );
}

function Demo() {
  // Build a Cal.com URL from CONFIG (CAL_URL wins, then EVENT_PATH, then HANDLE)
  const ep = (CONFIG.CAL_EVENT_PATH?.trim?.() ? CONFIG.CAL_EVENT_PATH.trim() : "");
  const handle = (CONFIG.CAL_HANDLE?.trim?.() ? CONFIG.CAL_HANDLE.trim() : "");
  const calSrc =
    (CONFIG.CAL_URL?.trim?.() ? CONFIG.CAL_URL.trim() : "") ||
    (ep ? (ep.startsWith("http") ? ep : `https://cal.com/${ep}`) : (handle ? `https://cal.com/${handle}` : ""));

  // Inject Cal.com embed script once so iframe resizes properly
  React.useEffect(() => {
    if (!calSrc) return;
    const id = "cal-embed-script";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.src = "https://cal.com/embed.js";
    document.head.appendChild(s);
  }, [calSrc]);

  return (
    <section id="demo" className="px-4 py-16 md:py-24">
      <SectionHeader kicker="See it in action" title="Book a live demo" subtitle="We’ll tailor the AI and show the CRM dashboard." />
      <div className="max-w-4xl mx-auto mt-10">
        <div className="rounded-2xl overflow-hidden shadow-sm bg-card ring-1 ring-border">

          {calSrc ? (
            // Cal.com embed — works with handle or full event path
            <iframe
              title="Book a demo"
              src={`${calSrc}?embed=1&hide_event_type_details=1`}
              className="w-full h-[720px] cal-embed"
              loading="lazy"
              // Cal.com looks for these attributes for auto-resize/theme
              data-cal-namespace="demo"
              data-cal-link={calSrc.replace("https://cal.com/","")}
              data-cal-config='{"layout":"month_view"}'
            />
          ) : (
            // Clean fallback if not configured yet
            <div className="p-8 text-center">
              <p className="text-muted-foreground">
                Demo scheduling isn’t configured yet. Add your Cal handle in <code>CONFIG.CAL_HANDLE</code> or a direct link in <code>CONFIG.CAL_URL</code>.
              </p>
              <div className="mt-6">
                <Button asChild className="rounded-2xl">
                  <a href="#contact">Contact us</a>
                </Button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Example: <code>CAL_HANDLE: "your-company"</code> or <code>CAL_EVENT_PATH: "your-company/demo"</code>.
              </div>
            </div>
          )}

        </div>
      </div>
    </section>
  );
}

function useLeadForm(defaults: Record<string,string> = {}){
  const [submitting,setSubmitting]=React.useState(false);
  const [done,setDone]=React.useState<string|null>(null);
  const [error,setError]=React.useState<string|null>(null);

  const utm = React.useMemo(()=>{ 
    const p=new URLSearchParams(typeof window!=='undefined'? window.location.search : '');
    return { utm_source:p.get('utm_source')||'', utm_medium:p.get('utm_medium')||'', utm_campaign:p.get('utm_campaign')||'', utm_term:p.get('utm_term')||'', utm_content:p.get('utm_content')||'' };
  },[]);

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
        const withHandle = leadPayload.phone || leadPayload.email || leadPayload.name;
        const { data: th } = await supabase.from("threads").insert({ tenant_id: tenant, with: withHandle, channel: "web" }).select("*").single();
        if (th) {
          await supabase.from("messages").insert({ tenant_id: tenant, thread_id: th.id, from: "lead", text: leadPayload.notes || "New inquiry", sent_at: new Date().toISOString() });
        }
      }
      if (CONFIG.WEBHOOK_URL) {
        await fetch(CONFIG.WEBHOOK_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ...defaults, ...utm, ...payload, page: typeof window!=='undefined'? window.location.href : '' }) });
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

function GetStarted() {
  const { toast } = useToast();
  const [business, setBusiness] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [details, setDetails] = React.useState("");
  const form = useLeadForm({ form: 'trial' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit({ business, email, website, details });
    if (form.error) toast({ title: "Error", description: form.error, variant: "destructive" });
    if (form.done) {
      toast({ title: "Request sent", description: form.done });
      setBusiness(""); setEmail(""); setWebsite(""); setDetails("");
    }
  }

  return (
    <section id="get-started" className="px-4 py-16 md:py-24 bg-card">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 items-center">
        <div>
          <SectionHeader kicker="Launch fast" title="Go live in 1 day" subtitle="We import your services, hours, pricing, and FAQs—then test and tune with you." />
          <ul className="mt-6 space-y-3">
            <li className="flex gap-2"><Check className="w-5 h-5 mt-0.5" /> Onboarding call (30–45 min)</li>
            <li className="flex gap-2"><Check className="w-5 h-5 mt-0.5" /> Connect calendars & booking links</li>
            <li className="flex gap-2"><Check className="w-5 h-5 mt-0.5" /> Import services & staff schedules</li>
            <li className="flex gap-2"><Check className="w-5 h-5 mt-0.5" /> Test calls & live launch</li>
          </ul>
        </div>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle>Start your free trial</CardTitle>
            <p className="text-sm text-muted-foreground">No credit card required. Cancel anytime.</p>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={onSubmit}>
              <Input placeholder="Business name" required value={business} onChange={(e) => setBusiness(e.target.value)} />
              <Input type="email" placeholder="Work email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input placeholder="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <Textarea rows={3} placeholder="Describe your services & hours" value={details} onChange={(e) => setDetails(e.target.value)} />
              <Button className="rounded-2xl" disabled={form.submitting}>{form.submitting ? "Sending..." : "Create my AI receptionist"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section id="faq" className="px-4 py-16 md:py-24">
      <SectionHeader kicker="FAQ" title="Answers to common questions" subtitle="Still curious? Send us a note—we’ll reply fast." />
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

function Security() {
  return (
    <section id="security" className="px-4 py-16 md:py-24 bg-card">
      <SectionHeader kicker="Security" title="How we protect your business and your callers" />
      <div className="max-w-5xl mx-auto mt-10 grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Data protection</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground space-y-2">
            <p>Encryption in transit (TLS 1.2+) and at rest (AES‑256). Separate per‑tenant data isolation with role‑based access controls.</p>
            <p>Secrets managed via a KMS; short‑lived tokens for integrations. Principle of least privilege for internal tooling.</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Privacy & compliance</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground space-y-2">
            <p>Recording consent with state‑aware prompts; toggle per line. Configurable redaction of PII in transcripts and summaries.</p>
            <p>10DLC registration for branded SMS and STIR/SHAKEN for outbound caller ID. Data retention defaults: audio 30 days, transcripts 90 days (customizable).</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><ActivitySquare className="w-5 h-5" /> Reliability & status</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            <p>We target 99.9% availability with active monitoring and vendor failover. For real‑time updates, visit our public status page.</p>
            <p className="mt-2"><a className="underline" href={`https://status.${CONFIG.DOMAIN}`} target="_blank" rel="noreferrer">{`status.${CONFIG.DOMAIN}`}</a></p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function Legal() {
  return (
    <section id="legal" className="px-4 py-16 md:py-24 bg-card">
      <SectionHeader kicker="Legal" title="Plain‑English Terms & Privacy" />
      <div className="max-w-4xl mx-auto mt-8 text-sm text-muted-foreground space-y-4">
        <p><strong>Terms.</strong> By using RelayAI, you agree to use the service lawfully and not submit prohibited content. You retain ownership of your data. We provide the service “as‑is” and limit liability to the fees you’ve paid in the prior 12 months.</p>
        <p><strong>Privacy.</strong> We encrypt data in transit and at rest. You can request deletion of transcripts at any time. We don’t sell your data. See our full policy for details on retention and third‑party processors.</p>
        <p><strong>HIPAA/PCI.</strong> For regulated use cases, talk to sales about our compliant deployment options.</p>
      </div>
    </section>
  );
}

function Footer() {
  const session = useSessionState();
  return (
    <footer className="px-4 pb-12">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6 items-center">
        <div className="text-sm text-muted-foreground">© {new Date().getFullYear()} {CONFIG.COMPANY}. All rights reserved.</div>
        <div className="flex gap-4 justify-start md:justify-end text-sm">
          <a href="#legal" className="underline">Terms</a>
          <a href="#legal" className="underline">Privacy</a>
          <a href="#security" className="underline">Security</a>
          <a href="#app" className="underline">Dashboard</a>
          {session && <a href="#admin" className="underline">Admin</a>}
        </div>
      </div>
    </footer>
  );
}

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

function ContactFloating() {
  const [isOpen, setIsOpen] = React.useState(false);
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const form = useLeadForm({ form: 'contact' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit({ name, email, message });
    if (form.error) toast({ title: "Error", description: form.error, variant: "destructive" });
    if (form.done) {
      toast({ title: "Message sent", description: form.done });
      setName(""); setEmail(""); setMessage("");
      setIsOpen(false); // Close after sending
    }
  }

  return (
    <div className="relative">
      {/* Chat Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="lg"
        className="rounded-full h-14 w-14 shadow-lg hover:shadow-xl transition-all duration-200"
      >
        <MessageSquare className="w-6 h-6" />
      </Button>

      {/* Contact Form - Only show when open */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          className="absolute bottom-16 right-0 w-80"
        >
          <Card className="rounded-2xl shadow-xl">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4" /> Talk to us
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8 p-0"
                >
                  ×
                </Button>
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

function SEOJsonLD() {
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TODO_company",
    url: "https://www.TODO_domain",
    logo: "https://www.TODO_domain/logo.png",
    contactPoint: [{ "@type": "ContactPoint", telephone: "+1-555-555-5555", contactType: "sales", areaServed: "US" }],
  } as const;
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "RelayAI Receptionist",
    description: "AI receptionist that answers calls, handles FAQs, and books appointments 24/7.",
    brand: { "@type": "Brand", name: "RelayAI" },
    offers: tiers.map((t) => ({ "@type": "Offer", price: t.price.replace("$", ""), priceCurrency: "USD" })),
  } as const;
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } as const;
  const local = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "TODO_company",
    address: { "@type": "PostalAddress", streetAddress: "TODO street", addressLocality: "Morrisville", addressRegion: "NC", postalCode: "27560", addressCountry: "US" },
    areaServed: "Triangle, NC",
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday"], opens: "09:00", closes: "18:00" }],
    telephone: "+1-555-555-5555",
  } as const;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(product) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(local) }} />
    </>
  );
}
