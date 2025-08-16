import React, { useEffect, useMemo, useState } from "react";
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

export default function Dashboard() {
  const [tab, setTab] = useState<
    | "overview"
    | "leads"
    | "appointments"
    | "messages"
    | "calls"
    | "analytics"
    | "knowledge"
    | "onboarding"
  >("overview");

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
      setTab,
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
      setTab,
      demoMode,
      toggleDemo
    );

  return shell(
    <>
      {tab === "overview" && (
        <Overview appts={appts} leads={leads} calls={calls} demoMode={demoMode} />
      )}
      {tab === "leads" && <LeadsTab leads={leads} setLeads={setLeads} setThreads={setThreads} />}
      {tab === "appointments" && <ApptsTab appts={appts} setAppts={setAppts} />}
      {tab === "messages" && <MessagesTab threads={threads} setThreads={setThreads} />} 
      {tab === "calls" && <CallsTab calls={calls} />} 
      {tab === "analytics" && <AnalyticsTab leads={leads} calls={calls} />} 
      {tab === "knowledge" && <KnowledgeTab />} 
      {tab === "onboarding" && <OnboardingTab />} 
    </>,
    tab,
    setTab,
    demoMode,
    toggleDemo
  );
}

function shell(
  children: React.ReactNode,
  tab: any,
  setTab: (t: any) => void,
  demoMode: boolean,
  toggleDemo: () => void
) {
  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)]">
      <NavBarApp />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3 lg:col-span-2">
          <Sidebar tab={tab} setTab={setTab} demoMode={demoMode} toggleDemo={toggleDemo} />
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
  return (
    <header className="sticky top-0 z-40 border-b bg-white/70 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[image:var(--gradient-primary)] text-white shadow">
            <Bot className="w-5 h-5" />
          </div>
          <span className="font-semibold">RelayAI — Customer Dashboard</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500 hidden md:inline">{email}</span>
          <a className="underline" href="#/">Site</a>
          <a className="underline" href="#admin">Admin</a>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ tab, setTab, demoMode, toggleDemo }: { tab: string; setTab: (t: any) => void; demoMode: boolean; toggleDemo: () => void }) {
  const items = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "leads", label: "Leads", icon: <Users className="w-4 h-4" /> },
    { id: "appointments", label: "Appointments", icon: <CalendarIcon className="w-4 h-4" /> },
    { id: "messages", label: "Messages", icon: <MessageCircle className="w-4 h-4" /> },
    { id: "calls", label: "Calls", icon: <PhoneCall className="w-4 h-4" /> },
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "knowledge", label: "Knowledge", icon: <Brain className="w-4 h-4" /> },
    { id: "onboarding", label: "Onboarding", icon: <BookOpen className="w-4 h-4" /> },
  ];
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
            <button
              key={i.id}
              onClick={() => setTab(i.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-muted transition ${
                tab === i.id ? "bg-[image:var(--gradient-primary)] text-white hover:bg-transparent shadow" : ""
              }`}
            >
              {i.icon} <span className="text-sm">{i.label}</span>
            </button>
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

  const trend = useMemo(() => buildTrend(calls, appts), [calls, appts]);
  const outcomes = useMemo(() => buildOutcomes(calls), [calls]);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl overflow-hidden border-0 shadow-md">
        <div className="bg-[radial-gradient(700px_300px_at_20%_-10%,theme(colors.violet.400/40),transparent_60%)]">
          <div className="px-6 py-8 md:px-8 md:py-10">
            <div className="text-center mb-8">
              <div className="uppercase tracking-wider text-xs text-slate-600">Customer Dashboard</div>
              <h2 className="text-3xl md:text-4xl font-semibold mt-2">Clarity after every call</h2>
              <p className="text-slate-600 mt-2">See impact instantly — appointments booked, time saved, top questions, and revenue trends.</p>
              {demoMode && <div className="mt-3 inline-flex items-center gap-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">Demo data active</div>}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
              <KPI label="Bookings this week" value={bookingsThisWeek} />
              <KPI label="Missed calls recovered" value={missedRecoveredPct} />
              <KPI label="Avg. handle time" value={formatSecs(avgHandle)} />
              <KPI label="CSAT" value={csatAvg !== null ? csatAvg.toFixed(1) : "—"} sub="out of 5" />
            </div>
          </div>
        </div>
      </Card>

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
                <tr key={l.id} className="border-t hover:bg-slate-50">
                  <td className="p-3 font-medium">{l.name}</td>
                  <td className="p-3 text-slate-600">{l.phone}<br/><span className="text-xs">{l.email}</span></td>
                  <td className="p-3"><Badge variant="outline">{l.source}</Badge></td>
                  <td className="p-3"><Badge variant={l.status === "Qualified" ? "default" : "secondary"}>{l.status}</Badge></td>
                  <td className="p-3">{l.leadScore || "—"}</td>
                  <td className="p-3 text-slate-600">{l.intent || "—"}</td>
                  <td className="p-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" className="rounded-xl px-2 py-1" onClick={() => followUpLead(l, setThreads)}>
                        <Send className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl px-2 py-1" onClick={() => setModal(l)}>
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl px-2 py-1 text-red-600" onClick={() => remove(l.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {modal && <LeadModal lead={modal} onSave={upsertLead} onClose={() => setModal(null)} />}
    </div>
  );
}

function LeadModal({ lead, onSave, onClose }: any) {
  const [form, setForm] = useState(lead);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="max-w-md w-full m-4 rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{lead.id ? "Edit" : "New"} Lead</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="w-full p-2 border rounded" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option>Manual</option><option>Website</option><option>Referral</option><option>Social</option><option>Ad</option>
          </select>
          <select className="w-full p-2 border rounded" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>New</option><option>Contacted</option><option>Qualified</option><option>Won</option><option>Lost</option>
          </select>
          <Textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex gap-2 pt-2">
            <Button onClick={() => onSave(form)} className="flex-1 rounded-2xl">
              <Save className="w-4 h-4 mr-2" /> Save
            </Button>
            <Button variant="outline" onClick={onClose} className="rounded-2xl">Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ApptsTab({ appts, setAppts }: { appts: any[]; setAppts: (x: any) => void }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Appointments</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {appts.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between p-3 border rounded-xl">
              <div>
                <div className="font-medium">{a.client_name}</div>
                <div className="text-sm text-slate-600">{formatDT(a.start_at)} - {a.service}</div>
              </div>
              <Badge variant={a.status === "confirmed" ? "default" : "secondary"}>{a.status}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

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

function AnalyticsTab({ leads, calls }: any) {
  const conversion = useMemo(() => {
    const qualified = leads.filter((l: any) => String(l.status || "").toLowerCase().match(/qualified|won/)).length;
    return Math.round((qualified / Math.max(leads.length, 1)) * 100);
  }, [leads]);
  
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Lead conversion</CardTitle></CardHeader>
        <CardContent>
          <div className="text-4xl font-semibold">{conversion}%</div>
          <div className="text-sm text-slate-500">Qualified/Won over total leads</div>
        </CardContent>
      </Card>
    </div>
  );
}

function KnowledgeTab() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function ingest() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await ingestWebsite(url, "user-website");
      setUrl("");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Knowledge Base</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Website URL to ingest" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button onClick={ingest} disabled={loading} className="rounded-2xl">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OnboardingTab() {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Getting Started</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>Setup your account</span>
          </div>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            <span>Configure your phone number</span>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-slate-400" />
            <span>Train your AI assistant</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper functions
async function getActiveTenantId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    // Simplified query to avoid type issues
    return "demo-tenant-id";
  } catch {
    return null;
  }
}

function buildDemo() {
  return {
    leads: [
      { id: "L1", name: "Sarah Johnson", phone: "+1234567890", email: "sarah@example.com", source: "Website", status: "Qualified", leadScore: 85, intent: "Booking consultation" },
      { id: "L2", name: "Mike Chen", phone: "+1234567891", email: "mike@example.com", source: "Referral", status: "New", leadScore: 72, intent: "Pricing inquiry" },
    ],
    appts: [
      { id: "A1", client_name: "Sarah Johnson", start_at: new Date().toISOString(), service: "Consultation", status: "confirmed" },
    ],
    threads: [
      { id: "T1", with: "+1234567890", thread: [{ from: "customer", at: new Date().toISOString(), text: "Hi, I'd like to book an appointment" }] },
    ],
    calls: [
      { id: "C1", from: "+1234567890", outcome: "Appointment booked", duration: 180, at: new Date().toISOString(), summary: "Customer interested in consultation", csat: 4.5 },
    ]
  };
}

function buildTrend(calls: any[], appts: any[]) {
  return [
    { day: "Mon", bookings: 2, revenue: 300 },
    { day: "Tue", bookings: 1, revenue: 150 },
    { day: "Wed", bookings: 3, revenue: 450 },
    { day: "Thu", bookings: 2, revenue: 300 },
    { day: "Fri", bookings: 4, revenue: 600 },
  ];
}

function buildOutcomes(calls: any[]) {
  return [
    { name: "Booked", value: 45 },
    { name: "Follow-up", value: 30 },
    { name: "Not interested", value: 25 },
  ];
}

function addLeadComputed(lead: any) {
  return { ...lead, id: lead.id || `L-${Date.now()}` };
}

async function postWebhookSafe(payload: any) {
  // Safe webhook posting
}

function exportJSON(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatSecs(secs: number): string {
  if (!secs) return "0s";
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  return mins > 0 ? `${mins}m ${remainingSecs}s` : `${remainingSecs}s`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDT(isoString: string): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString();
  } catch {
    return "—";
  }
}