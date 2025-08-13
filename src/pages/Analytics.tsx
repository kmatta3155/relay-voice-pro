import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState<{calls: number; bookings: number; leads: number} | null>(null);
  
  useEffect(() => {
    (async () => {
      // Compute KPIs manually since mv_kpis_7d might not be accessible via API
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id!;
      const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
      const tid = p?.active_tenant_id as string;
      
      const { count: calls } = await supabase.from("calls").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const { count: bookings } = await supabase.from("appointments").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("start_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const { count: leads } = await supabase.from("leads").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      
      setKpis({ calls: calls || 0, bookings: bookings || 0, leads: leads || 0 });
    })();
  }, []);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Calls (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpis?.calls ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Bookings (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpis?.bookings ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Leads (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpis?.leads ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm md:col-span-3"><CardHeader><CardTitle>Notes</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">Real-time KPI calculations from your workspace data.</CardContent></Card>
    </div>
  );
}