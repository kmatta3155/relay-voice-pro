import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import VoiceRelayLogo from "@/components/VoiceRelayLogo";
import {
  Bot,
  LayoutDashboard,
  Users,
  Calendar as CalendarIcon,
  MessageCircle,
  PhoneCall,
  BarChart3,
  Plus,
  Search,
  Filter,
  Download,
  Trash2,
  Edit,
  Save,
  X,
  Send,
  Zap,
  Check,
  Brain,
  BookOpen,
  Globe,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Building,
  TrendingUp,
  ThumbsUp,
  Clock,
  DollarSign,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import * as repo from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ragSearchEnhanced, ingestWebsite } from "@/lib/rag";
import { followUpLead } from "@/lib/leads";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

import LeadsPage from "@/pages/Leads";
import AppointmentsPage from "@/pages/Appointments";
import CallsPage from "@/pages/Calls";
import MessagesPage from "@/pages/Messages";

/**
 * RelayAI Dashboard — upgraded UI/UX
 * - Matches marketing mock: gradients, rich charts, colorful KPIs, automation banners
 * - Keeps your existing data wiring (supabase + repo + rag)
 * - Adds Demo Mode with seeded data for instant ROI story
 */

export default function Dashboard() {
  const location = useLocation();
  
  // Determine tab from URL path - derived directly, no state needed
  const getTabFromPath = (pathname: string) => {
    const path = pathname.toLowerCase();
    if (path.includes('/leads')) return 'leads';
    if (path.includes('/appointments')) return 'appointments';
    if (path.includes('/messages')) return 'messages';
    if (path.includes('/calls')) return 'calls';
    if (path.includes('/analytics')) return 'analytics';
    if (path.includes('/knowledge')) return 'knowledge';
    if (path.includes('/onboarding')) return 'onboarding';
    return 'overview';
  };
  
  // Derive tab directly from location - no useState needed
  const tab = getTabFromPath(location.pathname);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  const [leads, setLeads] = useState<any[]>([]);
  const [appts, setAppts] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const t = await getActiveTenantId();
      setTenantId(t || null);
      if (!t) {
        // No tenant? Flip to demo automatically.
        const demo = buildDemo();
        setLeads(demo.leads);
        setAppts(demo.appts);
        setThreads(demo.threads);
        setCalls(demo.calls);
        setDemoMode(true);
        setLoading(false);
        return;
      }
      const [L, A, T, C] = await Promise.all([
        repo.listLeads(),
        repo.listAppointments(),
        repo.listThreads(),
        repo.listCalls(),
      ]);
      const empty = !(L?.length || A?.length || T?.length || C?.length);
      if (empty) {
        const demo = buildDemo();
        setLeads(demo.leads);
        setAppts(demo.appts);
        setThreads(demo.threads);
        setCalls(demo.calls);
        setDemoMode(true);
      } else {
        setLeads(L || []);
        setAppts(A || []);
        setThreads(T || []);
        setCalls(C || []);
      }
      setLoading(false);
    })();
  }, []);

  function toggleDemo() {
    if (demoMode) {
      // Try to reload live data
      (async () => {
        setLoading(true);
        try {
          const [L, A, T, C] = await Promise.all([
            repo.listLeads(),
            repo.listAppointments(),
            repo.listThreads(),
            repo.listCalls(),
          ]);
          setLeads(L || []);
          setAppts(A || []);
          setThreads(T || []);
          setCalls(C || []);
          setDemoMode(false);
        } finally {
          setLoading(false);
        }
      })();
    } else {
      const demo = buildDemo();
      setLeads(demo.leads);
      setAppts(demo.appts);
      setThreads(demo.threads);
      setCalls(demo.calls);
      setDemoMode(true);
    }
  }

  if (loading)
    return shell(
      <div className="p-6 text-sm text-slate-600">Loading your workspace…</div>,
      tab,
      demoMode,
      toggleDemo
    );

  if (!tenantId && !demoMode)
    return shell(
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>No workspace selected</CardTitle>
        </CardHeader>
        <CardContent>
          Sign in and ensure your profile has <code>active_tenant_id</code>. Then refresh.
        </CardContent>
      </Card>,
      tab,
      demoMode,
      toggleDemo
    );

  return shell(
    <>
      {tab === "overview" && (
        <Overview appts={appts} leads={leads} calls={calls} demoMode={demoMode} />
      )}
      {tab === "leads" && <LeadsPage />}
      {tab === "appointments" && <AppointmentsPage />}
      {tab === "messages" && <MessagesPage />} 
      {tab === "calls" && <CallsPage />} 
      {tab === "analytics" && <AnalyticsTab leads={leads} calls={calls} />} 
      {tab === "knowledge" && <KnowledgeTab />} 
      {tab === "onboarding" && <OnboardingTab />} 
    </>,
    tab,
    demoMode,
    toggleDemo
  );
}

/* ---------- Layout shell (top nav + sidebar) ---------- */
function shell(
  children: React.ReactNode,
  tab: any,
  demoMode: boolean,
  toggleDemo: () => void
) {
  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)]">
      <NavBarApp />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3 lg:col-span-2">
          <Sidebar tab={tab} demoMode={demoMode} toggleDemo={toggleDemo} />
        </aside>
        <main className="col-span-12 md:col-span-9 lg:col-span-10">{children}</main>
      </div>
    </div>
  );
}

function NavBarApp() {
  const [email, setEmail] = useState<string | undefined>();
  useEffect(() => {
    supabase.auth.getUser().then((r) => setEmail(r.data.user?.email));
  }, []);
  
  async function onSignOut(){ 
    await supabase.auth.signOut(); 
    window.location.href = '/';
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-white/70 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <VoiceRelayLogo size="sm" showText={false} />
          <span className="font-semibold">Voice Relay Pro — Customer Dashboard</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <nav className="flex items-center gap-3">
            <a className="hover:underline" href="/">Home</a>
            <a className="hover:underline" href="/#admin">Admin</a>
          </nav>
          <span className="text-slate-500 hidden md:inline">{email}</span>
          <button className="underline hover:no-underline" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ tab, demoMode, toggleDemo }: { tab: string; demoMode: boolean; toggleDemo: () => void }) {
  const navigate = useNavigate();
  
  const items = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" />, path: "/overview" },
    { id: "leads", label: "Leads", icon: <Users className="w-4 h-4" />, path: "/leads" },
    { id: "appointments", label: "Appointments", icon: <CalendarIcon className="w-4 h-4" />, path: "/appointments" },
    { id: "messages", label: "Messages", icon: <MessageCircle className="w-4 h-4" />, path: "/messages" },
    { id: "calls", label: "Calls", icon: <PhoneCall className="w-4 h-4" />, path: "/calls" },
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" />, path: "/analytics" },
    { id: "knowledge", label: "Knowledge", icon: <Brain className="w-4 h-4" />, path: "/knowledge" },
    { id: "onboarding", label: "Onboarding", icon: <BookOpen className="w-4 h-4" />, path: "/onboarding" },
  ];
  
  const handleClick = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
  
  return (
    <Card className="rounded-2xl shadow-sm sticky top-20 overflow-hidden">
      <CardContent className="p-0">
        <div className="p-3 flex items-center justify-between bg-card/60 border-b">
          <div className="text-xs text-slate-600">Demo mode</div>
          <Button size="sm" variant={demoMode ? "default" : "outline"} className="rounded-xl h-7 px-3" onClick={toggleDemo}>
            {demoMode ? "On" : "Off"}
          </Button>
        </div>
        <nav className="grid p-2">
          {items.map((i) => (
            <a
              key={i.id}
              href={i.path}
              onClick={(e) => handleClick(i.path, e)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-muted transition cursor-pointer ${
                tab === i.id ? "bg-[image:var(--gradient-primary)] text-white hover:bg-transparent shadow" : ""
              }`}
            >
              {i.icon} <span className="text-sm">{i.label}</span>
            </a>
          ))}
        </nav>
        <div className="p-4 pt-0">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4"/>Automation</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600 space-y-1">
              <div>• Recovery SMS after missed calls</div>
              <div>• Appointment reminders</div>
              <div>• CSAT survey after call</div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Overview (marketing-grade) ---------- */
function Overview({ appts, leads, calls, demoMode }: any) {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 6);
  startOfWeek.setHours(0, 0, 0, 0);

  const bookingsThisWeek = useMemo(() => appts.filter((a: any) => +new Date(a.start_at || a.created_at || 0) >= +startOfWeek).length, [appts]);

  const { avgHandle, csatAvg } = useMemo(() => {
    const withDur = calls.filter((c: any) => Number.isFinite(c.duration));
    const avgHandle = withDur.length ? Math.round(withDur.reduce((s: number, c: any) => s + (c.duration || 0), 0) / withDur.length) : 0;
    const withCsat = calls.filter((c: any) => Number.isFinite(c.csat));
    const csatAvg = withCsat.length ? withCsat.reduce((s: number, c: any) => s + (c.csat || 0), 0) / withCsat.length : null;
    return { avgHandle, csatAvg };
  }, [calls]);

  const missedRecoveredPct = useMemo(() => {
    const missed = calls.filter((c: any) => c.missed || /missed|voicemail/.test(String(c.outcome || "").toLowerCase()));
    const recovered = calls.filter((c: any) => /booked|appointment|scheduled|confirmed|recovered/.test(String(c.outcome || "").toLowerCase()));
    if (missed.length === 0) return "—";
    return `${Math.round((recovered.length / missed.length) * 100)}%`;
  }, [calls]);

  // Chart data
  const trend = useMemo(() => buildTrend(calls, appts), [calls, appts]);
  const outcomes = useMemo(() => buildOutcomes(calls), [calls]);
  const csatTrend = useMemo(() => buildCsatTrend(calls), [calls]);

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <Card className="rounded-3xl overflow-hidden border-0 shadow-md">
        <div className="bg-[radial-gradient(700px_300px_at_20%_-10%,theme(colors.violet.400/40),transparent_60%)]">
          <div className="px-6 py-8 md:px-8 md:py-10">
            <div className="text-center mb-8">
              <div className="uppercase tracking-wider text-xs text-slate-600">Customer Dashboard</div>
              <h2 className="text-3xl md:text-4xl font-semibold mt-2">Clarity after every call</h2>
              <p className="text-slate-600 mt-2">See impact instantly — appointments booked, time saved, top questions, and revenue trends.</p>
              {demoMode && <div className="mt-3 inline-flex items-center gap-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">Demo data active</div>}
            </div>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
              <KPI label="Bookings this week" value={bookingsThisWeek} />
              <KPI label="Missed calls recovered" value={missedRecoveredPct} />
              <KPI label="Avg. handle time" value={formatSecs(avgHandle)} />
              <KPI label="CSAT" value={csatAvg !== null ? csatAvg.toFixed(1) : "—"} sub="out of 5" />
            </div>
          </div>
        </div>
      </Card>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4"/>Bookings & revenue</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="bookings" strokeWidth={2} />
                <Line type="monotone" dataKey="revenue" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Outcomes mix</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>
                  {outcomes.map((_, i) => (<Cell key={i} />))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Two-up: Revenue + Summaries */}
      <div className="grid lg:grid-cols-2 gap-4">
        <RevenueImpactPanel appts={appts} />
        <PostCallSummaries calls={calls} />
      </div>

      {/* Three-up: Leads + Automation + Calendar */}
      <div className="grid lg:grid-cols-3 gap-4">
        <LeadCapturePanel />
        <AutomationPanel />
        <CalendarSyncPanel />
      </div>

      {/* What to do next */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>What to do next</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Jump into <b>Leads</b> to follow up, or <b>Appointments</b> to add schedules. <b>Messages</b> shows your inbox.
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="rounded-2xl bg-[image:var(--gradient-card)] border border-border/50">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-primary font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-[11px] text-slate-600 mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ---------- Leads ---------- */
function LeadsTab({ leads, setLeads, setThreads }: { leads: any[]; setLeads: (x: any) => void; setThreads: (x: any) => void }) {
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | any>(null);
  const filtered = leads.filter((l) => (l.name + l.phone + l.email + (l.source || "") + (l.status || "")).toLowerCase().includes(q.toLowerCase()));

  async function upsertLead(ld: any) {
    const computed = addLeadComputed(ld);
    setLeads((cur: any[]) => {
      const i = cur.findIndex((x: any) => x.id === computed.id);
      const next = [...cur];
      if (i >= 0) next[i] = computed; else next.unshift(computed);
      return next;
    });
    try {
      const saved = await repo.upsertLead(computed);
      setLeads((cur: any[]) => cur.map((x: any) => (x.id === saved.id ? addLeadComputed(saved) : x)));
      await postWebhookSafe({ type: "lead.upsert", lead: saved });
    } catch (e) { console.error(e); }
    setModal(null);
  }
  async function remove(id: string) {
    setLeads((cur: any[]) => cur.filter((x: any) => x.id !== id));
    try { await repo.deleteLead(id); } catch (e) { console.error(e); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2">
            <Search className="w-4 h-4" />
            <input className="outline-none text-sm" placeholder="Search leads" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="outline" className="rounded-2xl">
            <Filter className="w-4 h-4 mr-2" /> Filters
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-2xl" onClick={() => exportJSON("leads.json", leads)}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
          <Button className="rounded-2xl" onClick={() => setModal({ id: undefined, name: "", phone: "", email: "", source: "Manual", status: "New", notes: "", created_at: new Date().toISOString(), })}>
            <Plus className="w-4 h-4 mr-2" /> New lead
          </Button>
        </div>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left bg-slate-50">
              <tr>
                <th className="p-3">Name</th><th>Contact</th><th>Source</th><th>Status</th><th>Score</th><th>Intent</th><th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="p-3 font-medium">{l.name}</td>
                  <td className="p-3 text-slate-600">{l.phone}<br />{l.email}</td>
                  <td className="p-3">{l.source || "—"}</td>
                  <td className="p-3">{l.status || "—"}</td>
                  <td className="p-3">{l.score ?? scoreLead(l).score} <span className={`text-xs ml-1 ${ (l.scoreTier ?? scoreLead(l).tier) === "Hot" ? "text-red-600" : (l.scoreTier ?? scoreLead(l).tier) === "Warm" ? "text-amber-600" : "text-slate-500" }`}>(
                    {(l.scoreTier ?? scoreLead(l).tier)})</span></td>
                  <td className="p-3 capitalize">{(l.intent ?? scoreLead(l).intent) || "—"}</td>
                  <td className="p-3 text-right">
                    <Button variant="outline" className="rounded-2xl mr-2" onClick={() => setModal(l)}><Edit className="w-4 h-4" /></Button>
                    <Button variant="outline" className="rounded-2xl mr-2" onClick={() => followUpLead(l, setThreads)}><Zap className="w-4 h-4 mr-1" /> Nudge</Button>
                    <Button variant="outline" className="rounded-2xl" onClick={() => remove(l.id)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {modal && <LeadModal lead={modal} onClose={() => setModal(null)} onSave={upsertLead} />}
    </div>
  );
}

function LeadModal({ lead, onClose, onSave }: any) {
  const [form, setForm] = useState(lead);
  const sc = scoreLead(form);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <Card className="w-full max-w-lg rounded-2xl shadow-xl">
        <CardHeader><CardTitle>{lead?.id ? "Edit lead" : "New lead"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Input placeholder="Name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Phone" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Source" value={form.source || ""} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          <Input placeholder="Status" value={form.status || ""} onChange={(e) => setForm({ ...form, status: e.target.value })} />
          <Textarea placeholder="Notes" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="text-sm text-slate-600">Predicted intent: <strong className="capitalize">{sc.intent}</strong> • Score: <strong>{sc.score}</strong> (<span className="capitalize">{sc.tier}</span>)</div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={onClose}><X className="w-4 h-4 mr-1" /> Cancel</Button>
            <Button className="rounded-2xl" onClick={() => onSave(form)}><Save className="w-4 h-4 mr-1" /> Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Appointments ---------- */
function ApptsTab({ appts, setAppts }: { appts: any[]; setAppts: (x: any) => void }) {
  const [modal, setModal] = useState<null | any>(null);
  const upcoming = [...appts].sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));

  async function upsert(a: any) {
    setAppts((cur: any[]) => { const i = cur.findIndex((x) => x.id === a.id); const next = [...cur]; if (i >= 0) next[i] = a; else next.push(a); return next; });
    try { const saved = await repo.upsertAppointment(a); setAppts((cur: any[]) => cur.map((x) => (x.id === saved.id ? saved : x))); } catch (e) { console.error(e); }
    setModal(null);
  }
  async function remove(id: string) {
    setAppts((cur: any[]) => cur.filter((x) => x.id !== id));
    try { await repo.deleteAppointment(id); } catch (e) { console.error(e); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Appointments</h2>
        <Button className="rounded-2xl" onClick={() => setModal({ id: undefined, title: "", customer: "", start_at: new Date().toISOString(), end_at: new Date().toISOString(), staff: "", })}>
          <Plus className="w-4 h-4 mr-2" /> New appointment
        </Button>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left bg-slate-50">
              <tr>
                <th className="p-3">Title</th><th>Customer</th><th>Start</th><th>End</th><th>Staff</th><th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((a) => (
                <tr key={a.id || JSON.stringify(a)} className="border-t">
                  <td className="p-3 font-medium">{a.title}</td>
                  <td className="p-3">{a.customer}</td>
                  <td className="p-3">{formatDT(a.start_at)}</td>
                  <td className="p-3">{formatDT(a.end_at)}</td>
                  <td className="p-3">{a.staff}</td>
                  <td className="p-3 text-right">
                    <Button variant="outline" className="rounded-2xl mr-2" onClick={() => setModal(a)}><Edit className="w-4 h-4" /></Button>
                    <Button variant="outline" className="rounded-2xl" onClick={() => remove(a.id)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {modal && <ApptModal appt={modal} onClose={() => setModal(null)} onSave={upsert} />}
    </div>
  );
}

function ApptModal({ appt, onClose, onSave }: any) {
  const [form, setForm] = useState(appt);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <Card className="w-full max-w-lg rounded-2xl shadow-xl">
        <CardHeader><CardTitle>{appt?.id ? "Edit appointment" : "New appointment"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input placeholder="Customer" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
          <Input type="datetime-local" value={toLocal(form.start_at)} onChange={(e) => setForm({ ...form, start_at: fromLocal(e.target.value) })} />
          <Input type="datetime-local" value={toLocal(form.end_at)} onChange={(e) => setForm({ ...form, end_at: fromLocal(e.target.value) })} />
          <Input placeholder="Staff" value={form.staff} onChange={(e) => setForm({ ...form, staff: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={onClose}><X className="w-4 h-4 mr-1" /> Cancel</Button>
            <Button className="rounded-2xl" onClick={() => onSave(form)}><Save className="w-4 h-4 mr-1" /> Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Messages ---------- */
function MessagesTab({ threads, setThreads }: { threads: any[]; setThreads: (x: any) => void }) {
  const [sel, setSel] = useState(threads[0]?.id || null);
  const th = threads.find((t: any) => t.id === sel) || threads[0];
  const [text, setText] = useState("");

  useEffect(() => { if (threads.length && !sel) setSel(threads[0].id); }, [threads]);

  async function send() {
    if (!text.trim() || !th) return;
    const newMsg = { from: "agent", at: new Date().toISOString(), text };
    setThreads((cur: any[]) => cur.map((t) => (t.id === th.id ? { ...t, thread: [...(t.thread || []), newMsg] } : t)));
    setText("");
    try { await repo.sendMessage(th, newMsg.text); const updated = await repo.listThreads(); setThreads(updated); } catch (e) { console.error(e); }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="rounded-2xl shadow-sm md:col-span-1">
        <CardHeader><CardTitle>Conversations</CardTitle></CardHeader>
        <CardContent className="p-0">
          {(threads || []).map((t: any) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={`w-full text-left px-4 py-3 border-t hover:bg-slate-50 ${t.id === th?.id ? "bg-slate-100" : ""}`}> 
              <div className="text-sm font-medium">{t.with}</div>
              <div className="text-xs text-slate-500 truncate">{(t.thread || [])[((t.thread || []).length - 1) as any]?.text}</div>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm md:col-span-2">
        <CardHeader><CardTitle>Chat with {th?.with || "—"}</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64 overflow-auto space-y-2">
            {(th?.thread || []).map((m: any, i: number) => (
              <div key={i} className={`flex ${m.from === "agent" ? "justify-end" : "justify-start"}`}>
                <div className={`px-3 py-2 rounded-xl text-sm ${m.from === "agent" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{m.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} />
            <Button onClick={send} className="rounded-2xl"><Send className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Calls ---------- */
function CallsTab({ calls }: any) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Call log</CardTitle></CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-left bg-slate-50">
            <tr><th className="p-3">From</th><th>Outcome</th><th>Duration</th><th>When</th><th className="p-3">Summary</th></tr>
          </thead>
          <tbody>
            {(calls || []).map((c: any) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-medium">{c.from}</td>
                <td className="p-3">{c.outcome}</td>
                <td className="p-3">{formatDuration(c.duration)}</td>
                <td className="p-3">{formatDT(c.at)}</td>
                <td className="p-3 text-slate-600">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/* ---------- Analytics (simple + charts) ---------- */
function AnalyticsTab({ leads, calls }: any) {
  const conversion = useMemo(() => {
    const qualified = leads.filter((l: any) => String(l.status || "").toLowerCase().match(/qualified|won/)).length;
    return Math.round((qualified / Math.max(leads.length, 1)) * 100);
  }, [leads]);
  const bySource = useMemo(() => {
    const map: Record<string, number> = {}; for (const l of leads) { const s = String(l.source || "Unknown"); map[s] = (map[s] || 0) + 1; }
    return Object.entries(map).map(([k, v]) => ({ k, v }));
  }, [leads]);
  const callsTrend = useMemo(() => buildTrend(calls, []), [calls]);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Lead conversion</CardTitle></CardHeader>
        <CardContent>
          <div className="text-4xl font-semibold">{conversion}%</div>
          <div className="text-sm text-slate-500">Qualified/Won over total leads</div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Leads by source</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-sm text-slate-700 space-y-1">
            {bySource.map(({ k, v }) => (
              <li key={k} className="flex items-center gap-2"><Check className="w-4 h-4" /><span className="w-36">{k}</span><b>{v}</b></li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm md:col-span-2">
        <CardHeader><CardTitle>Calls trend</CardTitle></CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={callsTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="calls" strokeWidth={2} />
              <Line type="monotone" dataKey="bookings" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Knowledge Management ---------- */
function KnowledgeTab() {
  const [tenantId, setTenantId] = useState<string>("");
  const [sources, setSources] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [businessInfo, setBusinessInfo] = useState<any>({});
  const [unresolvedQuestions, setUnresolvedQuestions] = useState<any[]>([]);
  const [newWebsite, setNewWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const user = (await supabase.auth.getUser()).data.user; if (!user) return;
      const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
      if (!data?.active_tenant_id) return; setTenantId(data.active_tenant_id); await loadKnowledgeData(data.active_tenant_id);
    })();
  }, []);

  async function loadKnowledgeData(tid: string) {
    try {
      const [sourcesRes, questionsRes] = await Promise.all([
        supabase.from("knowledge_sources").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }),
        supabase.from("unresolved_questions").select("*").eq("tenant_id", tid).eq("status", "open").order("created_at", { ascending: false }),
      ]);
      if (sourcesRes.data) setSources(sourcesRes.data);
      if (questionsRes.data) setUnresolvedQuestions(questionsRes.data);
    } catch (error) { console.error("Failed to load knowledge data:", error); }
  }

  async function handleWebsiteIngestion() {
    if (!tenantId || !newWebsite) return; setLoading(true);
    try {
      const result = await ingestWebsite(tenantId, newWebsite);
      if (result?.business_info && Object.keys(result.business_info).length > 0) setBusinessInfo(result.business_info);
      await loadKnowledgeData(tenantId); setNewWebsite("");
    } catch (error) { console.error("Failed to ingest website:", error); }
    finally { setLoading(false); }
  }

  async function handleSearch() {
    if (!tenantId || !searchQuery) return; setLoading(true);
    try { const results = await ragSearchEnhanced(tenantId, searchQuery, 6); setSearchResults(results.results || []); }
    catch (error) { console.error("Search failed:", error); }
    finally { setLoading(false); }
  }

  async function deleteSource(sourceId: string) { try { await supabase.from("knowledge_sources").delete().eq("id", sourceId); await loadKnowledgeData(tenantId); } catch (e) { console.error(e); } }
  async function markQuestionResolved(questionId: string) { try { await supabase.from("unresolved_questions").update({ status: "resolved" }).eq("id", questionId); await loadKnowledgeData(tenantId); } catch (e) { console.error(e); } }

  return (
    <div className="space-y-6">
      {/* Knowledge Search */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" />Knowledge Search</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Search your business knowledge..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
            <Button onClick={handleSearch} disabled={!searchQuery || loading} className="rounded-2xl">{loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Search Results:</h4>
              {searchResults.map((result, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-xl text-sm">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex gap-2">
                      <Badge variant={result.source === "quick_answer" ? "default" : "secondary"}>{result.source === "quick_answer" ? "Quick Answer" : result.relevance_type || "General"}</Badge>
                      <Badge variant="outline">{((result.confidence || result.score || 0) * 100).toFixed(0)}%</Badge>
                    </div>
                  </div>
                  <p className="text-slate-700">{(result.content || "").slice(0, 250)}...</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Website Ingestion */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Retrain from Website</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="https://yourbusiness.com" value={newWebsite} onChange={(e) => setNewWebsite(e.target.value)} />
            <Button onClick={handleWebsiteIngestion} disabled={!newWebsite || loading} className="rounded-2xl">{loading ? (<><RefreshCw className="w-4 h-4 animate-spin mr-2" />AI Processing...</>) : (<><Plus className="w-4 h-4 mr-2" />Analyze & Ingest</>)}</Button>
          </div>
          <p className="text-xs text-slate-500">Enter your business website URL to automatically extract and add knowledge.</p>
        </CardContent>
      </Card>

      {/* Knowledge Sources */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />Knowledge Sources ({sources.length})</CardTitle></CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-slate-500 text-sm">No knowledge sources yet. Add a website above to get started.</p>
          ) : (
            <div className="space-y-3">
              {sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between p-3 border rounded-xl">
                  <div>
                    <div className="font-medium text-sm">{source.title || source.source_url}</div>
                    <div className="text-xs text-slate-500">{source.source_type} • {new Date(source.created_at).toLocaleDateString()} {source.meta?.bytes && ` • ${Math.round(source.meta.bytes / 1000)}KB`}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedSource(source)} className="rounded-2xl"><Edit className="w-3 h-3" /></Button>
                    <Button variant="outline" size="sm" onClick={() => deleteSource(source.id)} className="rounded-2xl text-red-600 hover:text-red-700"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business Intelligence */}
      {businessInfo && Object.keys(businessInfo).length > 0 && (
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Building className="w-5 h-5" />Business Intelligence</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {businessInfo.business_hours && (
                <div className="p-3 bg-blue-50 rounded-xl">
                  <h4 className="font-medium text-sm mb-2 text-blue-900">Business Hours</h4>
                  <div className="space-y-1">
                    {Array.isArray(businessInfo.business_hours) ? businessInfo.business_hours.map((hours: any, idx: number) => (<div key={idx} className="text-xs text-blue-800"><span className="font-medium">{hours.day}:</span> {hours.hours}</div>)) : (<div className="text-xs text-blue-800">{businessInfo.business_hours}</div>)}
                  </div>
                </div>
              )}
              {(businessInfo.phone || businessInfo.email) && (
                <div className="p-3 bg-green-50 rounded-xl">
                  <h4 className="font-medium text-sm mb-2 text-green-900">Contact Information</h4>
                  <div className="space-y-1">
                    {businessInfo.phone && (<div className="text-xs text-green-800"><span className="font-medium">Phone:</span> {businessInfo.phone}</div>)}
                    {businessInfo.email && (<div className="text-xs text-green-800"><span className="font-medium">Email:</span> {businessInfo.email}</div>)}
                  </div>
                </div>
              )}
              {businessInfo.services && (
                <div className="p-3 bg-purple-50 rounded-xl">
                  <h4 className="font-medium text-sm mb-2 text-purple-900">Services</h4>
                  <div className="text-xs text-purple-800">{Array.isArray(businessInfo.services) ? businessInfo.services.slice(0, 6).join(", ") : businessInfo.services}</div>
                </div>
              )}
              {businessInfo.about && (
                <div className="p-3 bg-orange-50 rounded-xl">
                  <h4 className="font-medium text-sm mb-2 text-orange-900">About</h4>
                  <div className="text-xs text-orange-800">{businessInfo.about}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Learning Mode */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5" />Learning Mode — Unresolved Questions ({unresolvedQuestions.length})</CardTitle></CardHeader>
        <CardContent>
          {unresolvedQuestions.length === 0 ? (
            <p className="text-slate-500 text-sm">No unresolved questions. Your AI is handling all inquiries!</p>
          ) : (
            <div className="space-y-3">
              {unresolvedQuestions.map((question) => (
                <div key={question.id} className="p-3 border rounded-xl bg-amber-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-sm mb-1">"{question.question}"</p>
                      <p className="text-xs text-slate-500">Asked {new Date(question.created_at).toLocaleDateString()} {question.call_id && ` • Call ID: ${question.call_id}`}</p>
                    </div>
                    <Button size="sm" onClick={() => markQuestionResolved(question.id)} className="rounded-2xl ml-3"><CheckCircle className="w-3 h-3 mr-1" />Resolve</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingTab() {
  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" />Getting Started</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl"><CheckCircle className="w-5 h-5 text-green-600" /><div><div className="font-medium text-sm">Dashboard Access</div><div className="text-xs text-slate-500">You're logged in and ready to go!</div></div></div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl"><Brain className="w-5 h-5 text-blue-600" /><div><div className="font-medium text-sm">Train Your AI</div><div className="text-xs text-slate-500">Go to Knowledge tab and add your business website</div></div></div>
            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl"><PhoneCall className="w-5 h-5 text-purple-600" /><div><div className="font-medium text-sm">Test Your Receptionist</div><div className="text-xs text-slate-500">Use the demo page to test AI responses</div></div></div>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Next Steps</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-600">
          <ol className="list-decimal list-inside space-y-2">
            <li>Add your business website in the Knowledge tab</li>
            <li>Test the AI responses in the demo</li>
            <li>Configure your phone number and business hours</li>
            <li>Set up appointment booking integrations</li>
            <li>Monitor calls and leads in this dashboard</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Panels used on Overview ---------- */
function RevenueImpactPanel({ appts }: { appts: any[] }) {
  // Simple heuristic revenue: sum of appt.price if available, else $200 each
  const revenue = appts.reduce((sum, a) => sum + (a.price || 200), 0);
  const trend = buildTrend([], appts);
  return (
    <Card className="rounded-2xl overflow-hidden">
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><DollarSign className="w-4 h-4"/>Revenue impact</CardTitle></CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">${revenue.toLocaleString()}</div>
        <p className="text-sm text-slate-600">Booked value attributed to RelayAI (last 14 days)</p>
        <div className="h-[180px] mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" /><YAxis /><Tooltip />
              <Bar dataKey="revenue" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function PostCallSummaries({ calls }: { calls: any[] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Post‑call summaries</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {calls.slice(0, 6).map((c) => (
          <div key={c.id} className="p-3 rounded-xl bg-card border">
            <div className="text-xs text-slate-500 flex items-center justify-between"><span>{c.from}</span><span>{formatSecs(c.duration || 0)}</span></div>
            <div className="text-sm mt-1">{c.summary}</div>
            <div className="mt-2"><Badge variant="secondary" className="rounded-xl">{c.outcome}</Badge></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LeadCapturePanel() {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Lead capture</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Name" />
          <Input placeholder="Phone" />
          <Input placeholder="Email" className="col-span-2" />
          <Textarea placeholder="Notes / intent" className="col-span-2" />
        </div>
        <Button className="rounded-2xl w-full"><Check className="w-4 h-4 mr-2"/>Create lead</Button>
        <p className="text-[11px] text-slate-500">Leads auto-sync to your CRM when enabled.</p>
      </CardContent>
    </Card>
  );
}

function AutomationPanel() {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Automation</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        <div className="flex items-center justify-between"><span>Missed‑call recovery SMS</span><Badge variant="secondary" className="rounded-xl">Enabled</Badge></div>
        <div className="flex items-center justify-between"><span>Appointment reminders</span><Badge variant="secondary" className="rounded-xl">Enabled</Badge></div>
        <div className="flex items-center justify-between"><span>CSAT survey after call</span><Badge variant="secondary" className="rounded-xl">Enabled</Badge></div>
        <div className="flex items-center justify-between"><span>CRM lead sync</span><Badge className="rounded-xl">Connect</Badge></div>
      </CardContent>
    </Card>
  );
}

function CalendarSyncPanel() {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Calendar sync</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between"><span>Google Calendar</span><Badge variant="secondary" className="rounded-xl">Connected</Badge></div>
        <div className="flex items-center justify-between"><span>Outlook</span><Badge className="rounded-xl">Connect</Badge></div>
      </CardContent>
    </Card>
  );
}

/* ---------- helpers ---------- */
async function getActiveTenantId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
  // @ts-ignore
  return data?.active_tenant_id || null;
}
function scoreLead(ld: any) {
  const text = `${ld.notes || ""} ${ld.source || ""} ${ld.status || ""}`.toLowerCase();
  let score = 10; let intent: "booking" | "quote" | "question" | "unknown" = "unknown";
  if (/book|friday|today|tomorrow|confirm|appointment|schedule/.test(text)) { score += 60; intent = "booking"; }
  if (/quote|price|estimate|cost/.test(text)) { score += 30; intent = intent === "unknown" ? "quote" : intent; }
  if (/urgent|asap|now|today/.test(text)) { score += 15; }
  if (/contacted|qualified|won/.test(text)) { score += 20; }
  const tier = score >= 70 ? "Hot" : score >= 45 ? "Warm" : "Cold";
  return { score: Math.min(100, score), tier, intent };
}
function addLeadComputed(ld: any) { const sc = scoreLead(ld); return { ...ld, score: sc.score, scoreTier: sc.tier, intent: sc.intent }; }
function exportJSON(filename: string, data: any) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function formatDT(s: string) { try { const d = new Date(s); return d.toLocaleString(); } catch { return String(s); } }
function formatSecs(s: number) { const m = Math.floor(s / 60); const sec = s % 60; return `${m}m ${String(sec).padStart(2, "0")}s`; }
function formatDuration(secs: number) { if (!secs && secs !== 0) return "—"; const m = Math.floor(secs / 60), s = secs % 60; return `${m}m ${s}s`; }
function toLocal(s: string) { const d = new Date(s); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fromLocal(s: string) { return new Date(s).toISOString(); }
async function postWebhookSafe(body: any) { try { const { data } = await (supabase as any).from("config").select("webhook_url, webhook_secret").limit(1).single(); const conf: any = data || {}; const url = conf?.webhook_url; if (!url) return; const headers: Record<string, string> = { "Content-Type": "application/json" }; if (conf?.webhook_secret) { const encoder = new TextEncoder(); // @ts-ignore
  const key = await crypto.subtle.importKey("raw", encoder.encode(conf.webhook_secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); // @ts-ignore
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(body))); const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join(""); headers["X-RelayAI-Signature"] = hex; }
  await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }); } catch (e) { /* ignore */ } }

// ----- demo + chart builders -----
function buildDemo() {
  // Leads
  const leads = Array.from({ length: 8 }).map((_, i) => ({
    id: `L${1000 + i}`,
    name: ["Alex K.", "Jordan P.", "Maya B.", "Chris L.", "Rina S.", "Tariq A.", "Noah D.", "Ivy W."][i],
    phone: "+1 (555) 0199-" + (1100 + i),
    email: `user${i}@example.com`,
    source: ["WebTrial", "WebContact", "Referral", "Ad", "WebTrial", "WebTrial", "Referral", "Ad"][i],
    status: ["New", "Qualified", "Won", "New", "New", "New", "Qualified", "New"][i],
    notes: ["Wants Friday at 2:15pm", "Asked price for detail", "Cut & color next week", "Brake quote", "Hydrafacial info", "Bike tune-up", "Lash fill Fri", "Wellness consult"][i],
    created_at: new Date(Date.now() - i * 3600_000).toISOString(),
  }));
  // Appointments
  const appts = Array.from({ length: 10 }).map((_, i) => ({
    id: `A${2000 + i}`,
    title: ["90-minute massage", "Interior detail", "Cut & color", "Brake service", "Hydrafacial"][i % 5],
    customer: ["Alex K.", "Jordan P.", "Maya B.", "Chris L.", "Rina S."][i % 5],
    start_at: new Date(Date.now() - (9 - i) * 86400_000 + 3600_000).toISOString(),
    end_at: new Date(Date.now() - (9 - i) * 86400_000 + 3 * 3600_000).toISOString(),
    staff: ["Jamie", "Taylor", "Ari", "Sam"][i % 4],
    price: [149, 220, 180, 320, 199][i % 5],
  }));
  // Calls
  const calls = Array.from({ length: 14 }).map((_, i) => ({
    id: `C${3000 + i}`,
    from: "+1 (555) 0149-" + (1200 + i),
    duration: Math.round(60 + Math.random() * 240),
    at: new Date(Date.now() - (13 - i) * 86400_000 + 2 * 3600_000).toISOString(),
    csat: [4.7, 4.8, 4.9, 4.6, 4.8][i % 5],
    outcome: ["Booked", "Answered", "Missed→SMS", "Booked", "FAQ Resolved", "Voicemail"][i % 6],
    summary: [
      "Caller booked a 90-minute massage for Friday 2:15pm. Sent SMS confirmation.",
      "Asked about walk-in availability; provided hours and next steps.",
      "Missed after-hours; SMS follow-up captured preferred time.",
      "Booked full interior detail; synced to Google Calendar.",
      "Pricing and warranty FAQ answered; sent link.",
      "Voicemail left; created lead and tagged for callback.",
    ][i % 6],
  }));
  // Threads (stub)
  const threads = [
    { id: "T1", with: "Alex K.", thread: [{ from: "customer", at: new Date().toISOString(), text: "Can I change my time?" }] },
    { id: "T2", with: "Maya B.", thread: [{ from: "customer", at: new Date().toISOString(), text: "What’s the price for color?" }] },
  ];
  return { leads, appts, calls, threads };
}

function buildTrend(calls: any[], appts: any[]) {
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
  });
  const map: Record<string, any> = {}; days.forEach((d) => (map[d.key] = { day: d.label, bookings: 0, calls: 0, revenue: 0 }));
  for (const c of calls) { const k = new Date(c.at || Date.now()).toISOString().slice(0, 10); if (map[k]) map[k].calls += 1; }
  for (const a of appts) { const k = new Date(a.start_at || Date.now()).toISOString().slice(0, 10); if (map[k]) { map[k].bookings += 1; map[k].revenue += a.price || 200; } }
  return days.map((d) => map[d.key]);
}
function buildOutcomes(calls: any[]) {
  const labels = ["Booked", "Answered", "Missed→Recovered", "Voicemail", "FAQ Resolved"]; const counts: Record<string, number> = {};
  for (const l of labels) counts[l] = 0;
  for (const c of calls) {
    const o = String(c.outcome || "").toLowerCase();
    if (o.includes("book")) counts["Booked"] += 1; else if (o.includes("missed") && o.includes("sms")) counts["Missed→Recovered"] += 1; else if (o.includes("voicemail")) counts["Voicemail"] += 1; else if (o.includes("faq")) counts["FAQ Resolved"] += 1; else counts["Answered"] += 1;
  }
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}
function buildCsatTrend(calls: any[]) {
  const byDay: Record<string, { total: number; n: number; label: string }> = {};
  for (const c of calls) {
    if (!Number.isFinite(c.csat)) continue; const k = new Date(c.at || Date.now()).toISOString().slice(0, 10);
    const lbl = new Date(k).toLocaleDateString(undefined, { weekday: "short" });
    byDay[k] = byDay[k] || { total: 0, n: 0, label: lbl }; byDay[k].total += c.csat; byDay[k].n += 1;
  }
  return Object.entries(byDay).slice(-7).map(([k, v]) => ({ day: v.label, csat: v.total / v.n }));
}
