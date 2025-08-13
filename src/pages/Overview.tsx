import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function Overview() {
  const [kpi, setKpi] = useState<{ calls: number; bookings: number; leads: number } | null>(null);
  const [tips, setTips] = useState<string[]>([]);
  
  useEffect(() => {
    (async () => {
      // Get current user's tenant and compute KPIs directly
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id!;
      const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
      const tid = p?.active_tenant_id as string;
      
      const { count: calls } = await supabase.from("calls").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const { count: bookings } = await supabase.from("appointments").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("start_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      const { count: leads } = await supabase.from("leads").select("*", { head: true, count: "exact" }).eq("tenant_id", tid).gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      
      setKpi({ calls: calls || 0, bookings: bookings || 0, leads: leads || 0 });
      
      // Simple onboarding checklist heuristics  
      const t: string[] = [];
      const { count: leadCount } = await supabase.from("leads").select("*", { head:true, count:"exact" }).eq("tenant_id", tid);
      const { count: apptCount } = await supabase.from("appointments").select("*", { head:true, count:"exact" }).eq("tenant_id", tid);
      if (!leadCount) t.push("Import or add your first lead");
      if (!apptCount) t.push("Connect calendar or add an appointment");
      t.push("Enable MFA in Settings");
      t.push("Set up Billing to activate CRM access");
      setTips(t);
    })();
  }, []);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Calls (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpi?.calls ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Bookings (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpi?.bookings ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Leads (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{kpi?.leads ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm md:col-span-3">
        <CardHeader><CardTitle>Onboarding checklist</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc ml-5 text-sm">
            {tips.map((t, i) => (<li key={i}>{t}</li>))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}