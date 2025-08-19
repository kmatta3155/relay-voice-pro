import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import KPICard from "@/components/dashboard/KPICard";
import LineAreaChart from "@/components/dashboard/LineAreaChart";
import SkeletonBlock from "@/components/dashboard/SkeletonBlock";
import ConversationIQCard from "@/components/dashboard/ConversationIQCard";
import LeadsMiniPipeline from "@/components/dashboard/LeadsMiniPipeline";
import KnowledgeWidget from "@/components/dashboard/KnowledgeWidget";
import AutomationsSummary from "@/components/dashboard/AutomationsSummary";
import HealthStatusChips from "@/components/dashboard/HealthStatusChips";
import UsageTile from "@/components/dashboard/UsageTile";
import TenantBadgeSwitcher from "@/components/dashboard/TenantBadgeSwitcher";
import { Button } from "@/components/ui/button";

type KPI = { calls:number; answered:number; missed:number; recovered:number; bookings:number; csat_avg:number|null; revenue:number };
type Point = { date:string; value:number };

export default function Overview(){
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Array<{id:string; name:string}>>([]);
  const [kpis, setKpis] = useState<KPI | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [autoReplies, setAutoReplies] = useState(false);

  async function load(){
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    // tenants list
    const { data: tlist } = await supabase.from("tenants").select("id,name").order("name");
    setTenants(tlist || []);
    const { data: prof } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
    const tid = prof?.active_tenant_id as string;
    setTenantId(tid);
    // pull KPIs/materialized views if present, fallback to basic aggregates
    const { data: k } = await supabase.from("vw_dashboard_kpis").select("calls,answered,missed,recovered,bookings,csat_avg,revenue").eq("tenant_id", tid).maybeSingle();
    if (k) setKpis(k as any);
    else {
      const { data: simple } = await supabase.rpc("compute_basic_kpis", { p_tenant: tid });
      setKpis(simple as any);
    }
    const { data: s } = await supabase.from("vw_calls_by_day").select("date,value").eq("tenant_id", tid).order("date");
    setSeries((s || []) as any);
    const { data: as } = await supabase.from("agent_settings").select("ai_sms_autoreplies").eq("tenant_id", tid).single();
    setAutoReplies(!!as?.ai_sms_autoreplies);
    setLoading(false);
  }

  useEffect(()=> { load(); },[]);

  function k(val:number|undefined|null){ return val==null?"—": Intl.NumberFormat().format(val); }

  return (
    <div className="space-y-4">
      {/* Header row: health + tenant + demo controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <HealthStatusChips items={[
          { label: "Twilio", ok: true },
          { label: "Stripe", ok: true, },
          { label: "Calendar", ok: true },
        ]}/>
        <TenantBadgeSwitcher tenants={tenants} active={tenantId || undefined} onChange={async (id)=>{
          await supabase.from("profiles").update({ active_tenant_id: id }).eq("id", (await supabase.auth.getUser()).data.user?.id );
          setTenantId(id); load();
        }}/>
      </div>

      {/* KPI grid */}
      {loading ? <div className="grid md:grid-cols-4 gap-4"><SkeletonBlock/><SkeletonBlock/><SkeletonBlock/><SkeletonBlock/></div> : (
        <div className="grid md:grid-cols-4 gap-4">
          <KPICard title="Calls" value={k(kpis?.calls)}/>
          <KPICard title="Answered" value={k(kpis?.answered)}/>
          <KPICard title="Missed" value={k(kpis?.missed)}/>
          <KPICard title="After-hours recovered" value={k(kpis?.recovered)}/>
          <KPICard title="Bookings" value={k(kpis?.bookings)}/>
          <KPICard title="CSAT" value={kpis?.csat_avg!=null? (Math.round((kpis.csat_avg as number)*10)/10).toFixed(1):"—"}/>
          <KPICard title="Est. revenue impact" value={"$" + k(kpis?.revenue)}/>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-2xl p-4 bg-gradient-to-br from-white/70 to-white/40 dark:from-zinc-900/60 dark:to-zinc-900/40 border">
        {loading ? <SkeletonBlock className="h-56"/> : <LineAreaChart data={series} tooltipLabel="Calls" />}
      </div>

      {/* Secondary widgets */}
      <div className="grid md:grid-cols-3 gap-4">
        <KnowledgeWidget lastRun={null} coverage={null}/>
        <LeadsMiniPipeline data={[{stage:"New",count:4},{stage:"Qualified",count:3},{stage:"Booked",count:2},{stage:"Won",count:1}]}/>
        <UsageTile minutes={120} sms={340} onManage={async()=>{
          const { data, error } = await supabase.functions.invoke("billing", { body: { action: "portal", tenantId } });
          if (data?.url) window.location.href = data.url;
        }}/>
      </div>
    </div>
  );
}
