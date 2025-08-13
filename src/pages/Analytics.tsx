import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function AnalyticsPage() {
  const [row, setRow] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("mv_kpis_7d").select("*").limit(1);
      setRow(data?.[0] || null);
    })();
  }, []);
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Calls (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{row?.calls_7d ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Bookings (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{row?.bookings_7d ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Leads (7d)</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{row?.leads_7d ?? "—"}</div></CardContent></Card>
      <Card className="rounded-2xl shadow-sm md:col-span-3"><CardHeader><CardTitle>Notes</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">KPIs refresh every 15 minutes via pg_cron. Adjust in SQL.</CardContent></Card>
    </div>
  );
}