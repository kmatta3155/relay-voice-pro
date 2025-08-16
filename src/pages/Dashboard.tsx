// src/pages/Dashboard.tsx
// This page implements a basic tenant‑facing dashboard. It shows high‑level
// metrics (calls, missed calls, bookings) and a recent activity feed. It
// queries Supabase tables directly. Adjust the queries as needed based on
// your schema. Charts and KPIs are rendered using recharts and simple
// components from your UI library.

import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

// Type definitions for your data models. Extend these if you add more fields.
interface CallLog {
  id: string;
  created_at: string;
  outcome: string | null;
  after_hours?: boolean;
}

interface Appointment {
  id: string;
  start_at: string;
  status?: string;
}

interface Lead {
  id: string;
  created_at: string;
  inbox_status?: string;
  contact_phone?: string;
}

export default function Dashboard() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      // Fetch recent call logs (last 30 days)
      const { data: callLogs, error: callErr } = await supabase
        .from("call_logs")
        .select("id, created_at, outcome, after_hours")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!callErr && callLogs) setCalls(callLogs as CallLog[]);

      // Fetch upcoming appointments (next 30 days)
      const { data: appts, error: apptErr } = await supabase
        .from("appointments")
        .select("id, start_at, status")
        .gte("start_at", new Date().toISOString())
        .order("start_at", { ascending: true })
        .limit(50);
      if (!apptErr && appts) setAppointments(appts as Appointment[]);

      // Fetch open leads
      const { data: leadsData, error: leadsErr } = await supabase
        .from("leads")
        .select("id, created_at, inbox_status, contact_phone")
        .eq("inbox_status", "open")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!leadsErr && leadsData) setLeads(leadsData as Lead[]);

      setLoading(false);
    };
    fetchData();
  }, []);

  // Compute simple KPIs
  const totalCalls = calls.length;
  const missedCalls = calls.filter((c) => c.outcome === "missed").length;
  const answeredCalls = calls.filter((c) => c.outcome === "answered").length;
  const bookingsCount = appointments.length;

  // Aggregate calls per day for a simple area chart
  const callsByDay: Record<string, number> = {};
  calls.forEach((c) => {
    const day = c.created_at.slice(0, 10);
    callsByDay[day] = (callsByDay[day] || 0) + 1;
  });
  const chartData = Object.keys(callsByDay)
    .sort()
    .map((day) => ({ day, calls: callsByDay[day] }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="shadow">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm opacity-80">Total Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalCalls}</p>
              </CardContent>
            </Card>
            <Card className="shadow">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm opacity-80">Answered Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{answeredCalls}</p>
              </CardContent>
            </Card>
            <Card className="shadow">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm opacity-80">Missed Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{missedCalls}</p>
              </CardContent>
            </Card>
            <Card className="shadow">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm opacity-80">Bookings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{bookingsCount}</p>
              </CardContent>
            </Card>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-2">Calls by Day</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="hsl(var(--primary))" fill="url(#colorCalls)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-2">Upcoming Appointments</h2>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming appointments.</p>
            ) : (
              <ul className="space-y-2">
                {appointments.map((a) => (
                  <li key={a.id} className="flex justify-between items-center">
                    <span>{new Date(a.start_at).toLocaleString()}</span>
                    <span className="text-sm px-2 py-1 rounded bg-primary/10 text-primary uppercase">
                      {a.status || "confirmed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}