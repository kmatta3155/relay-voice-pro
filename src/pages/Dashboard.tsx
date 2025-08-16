"use client";

import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  CalendarCheck2,
  PhoneIncoming,
  PhoneForwarded,
  Bot,
  Users,
  Settings2,
  PlayCircle,
  PauseCircle,
  Wand2,
  DollarSign,
  Sparkles,
  Star,
  ThumbsUp,
  Mic2,
  Gauge,
  ShieldCheck,
  Download,
  ArrowUpRight,
  Link,
} from "lucide-react";
import { motion } from "framer-motion";

// -----------------------------------------------------------------------------
// Demo Data
// -----------------------------------------------------------------------------
const trend = [
  { day: "Mon", bookings: 7, revenue: 820 },
  { day: "Tue", bookings: 8, revenue: 910 },
  { day: "Wed", bookings: 10, revenue: 1120 },
  { day: "Thu", bookings: 6, revenue: 740 },
  { day: "Fri", bookings: 9, revenue: 1010 },
  { day: "Sat", bookings: 4, revenue: 420 },
  { day: "Sun", bookings: 4, revenue: 450 },
];

const revenueImpact = [
  { source: "Recovered calls", revenue: 5400 },
  { source: "After-hours", revenue: 3200 },
  { source: "Upsells", revenue: 1800 },
  { source: "Missed-to-booked", revenue: 2600 },
];

const outcomes = [
  { name: "Booked", value: 48 },
  { name: "Voicemail", value: 22 },
  { name: "Transfer", value: 15 },
  { name: "Lead", value: 18 },
  { name: "No Action", value: 12 },
];

const recentCalls = [
  {
    id: "C-1043",
    time: "9:42 AM",
    caller: "Sofia Perez",
    status: "Booked",
    intent: "Teeth whitening consult",
    dur: "02:13",
    csat: 5,
  },
  {
    id: "C-1042",
    time: "9:10 AM",
    caller: "Jacob Li",
    status: "Lead",
    intent: "New patient cleaning",
    dur: "01:47",
    csat: 5,
  },
  {
    id: "C-1041",
    time: "8:55 AM",
    caller: "Unknown",
    status: "Voicemail",
    intent: "—",
    dur: "00:29",
    csat: 4,
  },
  {
    id: "C-1040",
    time: "8:31 AM",
    caller: "Noah Patel",
    status: "Transfer",
    intent: "Emergency chip repair",
    dur: "03:01",
    csat: 5,
  },
];

// -----------------------------------------------------------------------------
// Brand & Chart helpers
// -----------------------------------------------------------------------------
const BRAND = {
  violet: "hsl(var(--primary))",
  violetSoft: "hsl(var(--primary-glow))",
  blue: "hsl(220 90% 60%)",
  blueSoft: "hsl(220 90% 70%)",
  pie: [
    "hsl(262 85% 62%)",
    "hsl(220 85% 60%)",
    "hsl(160 70% 45%)",
    "hsl(30 90% 55%)",
    "hsl(280 70% 55%)",
  ],
};

function ChartDefs() {
  return (
    <defs>
      <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={BRAND.violet} stopOpacity={0.4} />
        <stop offset="100%" stopColor={BRAND.violetSoft} stopOpacity={0.05} />
      </linearGradient>
      <linearGradient id="strokeRevenue" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={BRAND.blue} />
        <stop offset="100%" stopColor={BRAND.blueSoft} />
      </linearGradient>
      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={BRAND.blueSoft} stopOpacity={0.9} />
        <stop offset="100%" stopColor={BRAND.blue} stopOpacity={0.6} />
      </linearGradient>
    </defs>
  );
}

const GlassTooltip = ({ active, payload, label }: any) =>
  active && payload?.length ? (
    <div className="px-3 py-2 text-xs rounded-xl glass shadow-md">
      <div className="font-medium">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <b className="ml-auto">{p.value}</b>
        </div>
      ))}
    </div>
  ) : null;

// -----------------------------------------------------------------------------
// Small UI bits
// -----------------------------------------------------------------------------
function KPI({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon?: any }) {
  return (
    <motion.div whileHover={{ y: -1 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
      <Card className="rounded-2xl glass glow-hover">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[11px] uppercase tracking-wide text-primary/90">{label}</CardTitle>
            {Icon && <Icon className="size-4 text-primary/70" />}
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="text-[28px] leading-7 font-semibold">{value}</div>
          {sub && <div className="text-[11px] text-slate-600 mt-1">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-xs bg-white/60 border border-white/70 backdrop-blur shadow-sm">
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Panels
// -----------------------------------------------------------------------------
function BookingsRevenuePanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <CalendarCheck2 className="size-4 text-primary" />
          <CardTitle>Bookings & Revenue</CardTitle>
        </div>
        <CardDescription>Weekly performance generated by RelayAI</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="h-[240px] sm:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ left: 8, right: 8 }}>
              <ChartDefs />
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip content={<GlassTooltip />} />
              <Area
                type="monotone"
                name="Bookings"
                dataKey="bookings"
                stroke={BRAND.violet}
                fill="url(#fillBookings)"
                strokeWidth={2.2}
                isAnimationActive
                animationDuration={700}
              />
              <Line
                type="monotone"
                name="Revenue"
                dataKey="revenue"
                stroke="url(#strokeRevenue)"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueImpactPanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-primary" />
          <CardTitle>Revenue Impact</CardTitle>
        </div>
        <CardDescription>Attribution by automation</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="h-[240px] sm:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueImpact}>
              <ChartDefs />
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="source" />
              <YAxis />
              <Tooltip content={<GlassTooltip />} />
              <Bar dataKey="revenue" fill="url(#barGradient)" radius={[8, 8, 0, 0]} isAnimationActive />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomesPanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <PhoneIncoming className="size-4 text-primary" />
          <CardTitle>Call Outcomes</CardTitle>
        </div>
        <CardDescription>Distribution this week</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="h-[240px] sm:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} isAnimationActive>
                {outcomes.map((_, i) => (
                  <Cell key={i} fill={BRAND.pie[i % BRAND.pie.length]} />
                ))}
              </Pie>
              <Tooltip content={<GlassTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentCallsPanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="size-4 text-primary" />
          <CardTitle>Recent Calls</CardTitle>
        </div>
        <CardDescription>Snippets & outcomes</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <div className="divide-y divide-slate-200/70">
          {recentCalls.map((c) => (
            <div key={c.id} className="py-3 flex items-center gap-3 hover:bg-slate-50/60 rounded-xl px-2">
              <Avatar className="size-8">
                <AvatarImage alt={c.caller} src={`https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(c.caller)}`} />
                <AvatarFallback>{c.caller.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium truncate max-w-[160px]">{c.caller}</span>
                  <Badge variant="secondary" className="rounded-full">{c.status}</Badge>
                  <span className="text-xs text-slate-500">{c.time}</span>
                </div>
                <div className="text-xs text-slate-600 truncate">{c.intent}</div>
              </div>
              <div className="text-xs text-slate-500 tabular-nums">{c.dur}</div>
              <div className="flex items-center gap-0.5">
                {new Array(c.csat).fill(0).map((_, i) => (
                  <Star key={i} className="size-4 text-amber-500 fill-amber-500" />
                ))}
              </div>
              <Button size="sm" variant="ghost" className="ml-1">
                <PlayCircle className="size-4 mr-1" /> Listen
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QualityUptimePanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <CardTitle>Quality & Uptime</CardTitle>
        </div>
        <CardDescription>Voice health & SLA</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">Uptime (30d)</div>
            <div className="flex items-center gap-2">
              <Badge className="rounded-full" variant="secondary">99.95%</Badge>
              <StatPill>
                <span className="inline-flex items-center gap-1"><ArrowUpRight className="size-3" /> +0.02%</span>
              </StatPill>
            </div>
            <Progress value={99.95} className="mt-2 h-2" />
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">Avg. MOS (voice)</div>
            <div className="flex items-center gap-2">
              <Mic2 className="size-4 text-primary" />
              <div className="text-sm font-medium">4.7</div>
            </div>
            <Progress value={94} className="mt-2 h-2" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">Latency p95</div>
            <div className="text-sm font-medium">280ms</div>
            <Progress value={72} className="mt-2 h-2" />
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">ASR Accuracy</div>
            <div className="text-sm font-medium">96.3%</div>
            <Progress value={96.3} className="mt-2 h-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KnowledgePanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <CardTitle>Knowledge & Onboarding</CardTitle>
        </div>
        <CardDescription>Website ingestion → Supabase (pgvector)</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-full">3 sources</Badge>
          <span className="text-xs text-slate-600">Last sync 2h ago</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Card className="glass">
            <CardContent className="p-3 text-sm">
              <div className="font-medium">Website</div>
              <div className="text-xs text-slate-600">relay.ai • 36 pages</div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardContent className="p-3 text-sm">
              <div className="font-medium">FAQ Doc</div>
              <div className="text-xs text-slate-600">Policies & pricing</div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardContent className="p-3 text-sm">
              <div className="font-medium">Promos</div>
              <div className="text-xs text-slate-600">Seasonal offers</div>
            </CardContent>
          </Card>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="glow-hover">
            <Wand2 className="size-4 mr-1" /> Ingest website
          </Button>
          <Button size="sm" variant="ghost" className="glow-hover">
            <Download className="size-4 mr-1" /> Export KB
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AutomationsPanel() {
  return (
    <Card className="rounded-2xl glass">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <CardTitle>Automations</CardTitle>
        </div>
        <CardDescription>Quick actions & flows</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4 space-y-3">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/60 border">
            <div className="text-sm">
              <div className="font-medium">After-hours booking</div>
              <div className="text-xs text-slate-600">Auto-book with calendar sync</div>
            </div>
            <Switch defaultChecked aria-label="After hours booking" />
          </div>
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/60 border">
            <div className="text-sm">
              <div className="font-medium">Lead capture & SMS follow-up</div>
              <div className="text-xs text-slate-600">Collect name + intent, send SMS</div>
            </div>
            <Switch defaultChecked aria-label="Lead capture" />
          </div>
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/60 border">
            <div className="text-sm">
              <div className="font-medium">Post-call summaries</div>
              <div className="text-xs text-slate-600">Drop to CRM & email</div>
            </div>
            <Switch aria-label="Post call summaries" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="glow-hover">
            <Settings2 className="size-4 mr-1" /> Configure flows
          </Button>
          <Button size="sm" variant="outline" className="glow-hover">
            <Link className="size-4 mr-1" /> Connect calendar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Sidebar() {
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl glass sticky top-20 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Demo Mode</CardTitle>
            <Switch defaultChecked aria-label="Toggle demo mode" />
          </div>
          <CardDescription>Seeded with ROI data</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Users className="size-4 text-primary" /> 48 bookings this week
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ThumbsUp className="size-4 text-primary" /> 89% calls recovered
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Star className="size-4 text-amber-500" /> CSAT 4.8
          </div>
        </CardContent>
      </Card>

      <AutomationsPanel />

      <Card className="rounded-2xl glass">
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-primary" />
            <CardTitle>Assistant Controls</CardTitle>
          </div>
          <CardDescription>Live tuning</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4 space-y-3">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/60 border">
              <div className="text-sm">Enthusiasm</div>
              <input type="range" defaultValue={60} className="w-40" aria-label="Enthusiasm" />
            </div>
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/60 border">
              <div className="text-sm">Transfer threshold</div>
              <input type="range" defaultValue={40} className="w-40" aria-label="Transfer threshold" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="glow-hover">
              <PauseCircle className="size-4 mr-1" /> Pause assistant
            </Button>
            <Button size="sm" className="glow-hover">
              <PlayCircle className="size-4 mr-1" /> Resume
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Top Nav
// -----------------------------------------------------------------------------
function NavBarApp() {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/50">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500" />
          <span className="font-semibold">RelayAI</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-full">Connected</Badge>
          <Button size="sm" variant="outline" className="glow-hover">
            <Download className="size-4 mr-1" /> Export report
          </Button>
        </div>
      </div>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-100 via-white to-blue-100">
      <NavBarApp />

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <Card className="rounded-3xl overflow-hidden border-0 shadow-md">
            <div className="bg-[radial-gradient(700px_300px_at_20%_-10%,theme(colors.violet.400/40),transparent_60%)]">
              <div className="p-6 md:p-8 grid md:grid-cols-3 gap-6 items-center">
                <div className="md:col-span-2 space-y-3">
                  <h1 className="text-4xl md:text-[40px] leading-tight font-semibold tracking-tight">
                    Your AI Receptionist, now revenue-positive
                  </h1>
                  <p className="text-slate-600 max-w-2xl">
                    RelayAI answers every call, books appointments, captures leads, and syncs to your calendar.
                    See the impact below.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <StatPill>
                      <CalendarCheck2 className="size-3 mr-1" /> 48 bookings this week
                    </StatPill>
                    <StatPill>
                      <ThumbsUp className="size-3 mr-1" /> 89% calls recovered
                    </StatPill>
                    <StatPill>
                      <Star className="size-3 mr-1 text-amber-500" /> CSAT 4.8
                    </StatPill>
                  </div>
                </div>
                <div className="md:justify-self-end">
                  <Card className="glass">
                    <CardContent className="p-4">
                      <div className="text-[12px] uppercase tracking-wide text-slate-600 mb-1">Quick actions</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" className="glow-hover"><PhoneIncoming className="size-4 mr-1" /> Start demo</Button>
                        <Button size="sm" variant="outline" className="glow-hover"><Settings2 className="size-4 mr-1" /> Configure</Button>
                        <Button size="sm" variant="ghost" className="glow-hover"><Users className="size-4 mr-1" /> Team</Button>
                        <Button size="sm" variant="ghost" className="glow-hover"><Wand2 className="size-4 mr-1" /> Import site</Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 pb-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* KPIs */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
          >
            <KPI label="Bookings" value={48} sub="This week" icon={CalendarCheck2} />
            <KPI label="Calls Recovered" value="89%" sub="From missed calls" icon={PhoneIncoming} />
            <KPI label="CSAT" value={"4.8 / 5"} sub="Past 7 days" icon={Star} />
            <KPI label="Leads" value={18} sub="Captured" icon={Users} />
          </motion.div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <BookingsRevenuePanel />
            <RevenueImpactPanel />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <OutcomesPanel />
            <QualityUptimePanel />
          </div>

          {/* Recent */}
          <RecentCallsPanel />

          {/* Knowledge & onboarding */}
          <KnowledgePanel />
        </div>

        {/* Right rail */}
        <aside>
          <Sidebar />
        </aside>
      </div>
    </div>
  );
}
