import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Phone, Calendar, Users, TrendingUp, Clock, DollarSign } from "lucide-react";

type Call = { outcome: string; duration: number; at: string };
type Lead = { status: string; created_at: string };
type Appointment = { start: string };

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function AnalyticsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    
    // Set up real-time subscriptions with proper cleanup
    let callsSub: ReturnType<typeof supabase.channel> | null = null;
    let leadsSub: ReturnType<typeof supabase.channel> | null = null;
    let apptsSub: ReturnType<typeof supabase.channel> | null = null;
    
    (async () => {
      const tid = await tenantId();
      
      callsSub = supabase
        .channel('analytics-calls')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
      
      leadsSub = supabase
        .channel('analytics-leads')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
      
      apptsSub = supabase
        .channel('analytics-appointments')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
    })();
    
    // Proper cleanup function
    return () => {
      callsSub?.unsubscribe();
      leadsSub?.unsubscribe();
      apptsSub?.unsubscribe();
    };
  }, []);

  async function load() {
    const tid = await tenantId();
    const [c, l, a] = await Promise.all([
      supabase.from("calls").select("outcome,duration,at").eq("tenant_id", tid).order("at", { ascending: false }).limit(100),
      supabase.from("leads").select("status,created_at").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
      supabase.from("appointments").select("start").eq("tenant_id", tid).order("start", { ascending: false }).limit(100)
    ]);
    setCalls(c.data || []);
    setLeads(l.data || []);
    setAppointments(a.data || []);
    setLoading(false);
  }

  // Calculate metrics
  const totalCalls = calls.length;
  const totalLeads = leads.length;
  const totalAppointments = appointments.length;
  const avgDuration = calls.length > 0 ? Math.round(calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length) : 0;

  // Call outcomes breakdown
  const outcomeCounts = calls.reduce((acc, c) => {
    const outcome = c.outcome || 'unknown';
    acc[outcome] = (acc[outcome] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const outcomeData = Object.entries(outcomeCounts).map(([name, value]) => ({ 
    name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), 
    value 
  }));

  // Daily call volume (last 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return date.toISOString().split('T')[0];
  });

  const dailyCallData = last7Days.map(date => ({
    date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    calls: calls.filter(c => c.at?.startsWith(date)).length,
    leads: leads.filter(l => l.created_at?.startsWith(date)).length
  }));

  // Lead status breakdown
  const leadStatusCounts = leads.reduce((acc, l) => {
    const status = l.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const leadStatusData = Object.entries(leadStatusCounts).map(([name, value]) => ({ 
    name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), 
    value 
  }));

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

  if (loading) {
    return <div className="p-8">Loading analytics...</div>;
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-2xl font-bold">Analytics</h2>
        <p className="text-muted-foreground">Real-time performance metrics and insights</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-calls">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-calls">{totalCalls}</div>
            <p className="text-xs text-muted-foreground">Last 100 records</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-leads">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-leads">{totalLeads}</div>
            <p className="text-xs text-muted-foreground">Last 100 records</p>
          </CardContent>
        </Card>

        <Card data-testid="card-appointments-booked">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Appointments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-appointments">{totalAppointments}</div>
            <p className="text-xs text-muted-foreground">Last 100 records</p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-duration">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Call Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-duration">{Math.floor(avgDuration / 60)}m {avgDuration % 60}s</div>
            <p className="text-xs text-muted-foreground">Per call</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-2xl" data-testid="card-daily-activity">
          <CardHeader>
            <CardTitle>Daily Activity (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyCallData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="calls" stroke="#0088FE" strokeWidth={2} />
                <Line type="monotone" dataKey="leads" stroke="#00C49F" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl" data-testid="card-call-outcomes">
          <CardHeader>
            <CardTitle>Call Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={outcomeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {outcomeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl" data-testid="card-lead-status">
          <CardHeader>
            <CardTitle>Lead Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={leadStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#00C49F" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl" data-testid="card-conversion-metrics">
          <CardHeader>
            <CardTitle>Conversion Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center" data-testid="metric-call-to-lead">
              <span className="text-sm">Call → Lead</span>
              <span className="text-lg font-bold">{totalCalls > 0 ? Math.round((totalLeads / totalCalls) * 100) : 0}%</span>
            </div>
            <div className="flex justify-between items-center" data-testid="metric-lead-to-appointment">
              <span className="text-sm">Lead → Appointment</span>
              <span className="text-lg font-bold">{totalLeads > 0 ? Math.round((totalAppointments / totalLeads) * 100) : 0}%</span>
            </div>
            <div className="flex justify-between items-center" data-testid="metric-call-to-appointment">
              <span className="text-sm">Call → Appointment</span>
              <span className="text-lg font-bold">{totalCalls > 0 ? Math.round((totalAppointments / totalCalls) * 100) : 0}%</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
