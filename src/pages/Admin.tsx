import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Counts = { tenants:number; leads:number; appts:number; calls:number; leads24h:number };

export default function Admin() {
  const [envOk, setEnvOk] = useState<{url:boolean; key:boolean}>({ url: !!import.meta.env.VITE_SUPABASE_URL, key: !!import.meta.env.VITE_SUPABASE_ANON_KEY });
  const [liveOk, setLiveOk] = useState<"unknown"|"yes"|"no">("unknown");
  const [counts, setCounts] = useState<Counts>({ tenants:0, leads:0, appts:0, calls:0, leads24h:0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function checkLive(){
    try{
      const { error } = await supabase.from("tenants").select("id", { count: "exact", head: true });
      if (error) throw error;
      setLiveOk("yes");
    }catch(e){
      console.error(e);
      setLiveOk("no");
    }
  }

  async function refreshCounts(){
    const c = async (table:string, where?: [string, any][]) => {
      let q = (supabase as any).from(table).select("*", { count: "exact", head: true }) as any;
      if (where) { for (const [k, v] of where) { q = q.eq(k, v); } }
      const { count } = await q;
      return count || 0;
    };

    try{
      // Overall counts (not per-tenant) – admin view
      const [tenants, leads, appts, calls] = await Promise.all([
        c("tenants"),
        c("leads"),
        c("appointments"),
        c("calls"),
      ]);
      // Leads in the last 24h
      const since = new Date(Date.now() - 24*60*60*1000).toISOString();
      // @ts-ignore: use range filter if created_at exists
      const { count: leads24h } = await supabase.from("leads").select("*", { count:"exact", head:true }).gte("created_at", since);
      setCounts({ tenants, leads, appts, calls, leads24h: leads24h || 0 });
    }catch(e:any){
      console.error(e);
      setMsg(`Count error: ${e?.message||e}`);
    }
  }

  async function seedDemo(){
    setBusy(true); setMsg("");
    try{
      // 1) Current user
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if(!user){ throw new Error("No signed-in user."); }

      // 2) Create tenant
      const slug = `demo-${Date.now().toString(36)}`;
      const { data: tenant, error: tErr } = await supabase.from("tenants").insert({ name: "Demo Auto Shop", slug }).select().single();
      if (tErr) throw tErr;

      // 3) Link profile.active_tenant_id (best-effort)
      try {
        // Try update first
        const { error: updErr } = await supabase.from("profiles").update({ active_tenant_id: tenant.id }).eq("id", user.id);
        if (updErr) {
          // If profiles row doesn't exist, insert it
          await supabase.from("profiles").insert({ id: user.id, active_tenant_id: tenant.id });
        }
      } catch { /* ignore */ }

      // 4) Seed a few leads
      const leads = [
        { tenant_id: tenant.id, name:"Jamie Patel", phone:"+1 919-555-0198", email:"jamie@example.com", source:"Call", status:"New", notes:"asked price for oil change; wants Friday 2pm", created_at: new Date().toISOString() },
        { tenant_id: tenant.id, name:"Ana Rivera", phone:"+1 984-555-0142", email:"ana@beauty.co", source:"Web", status:"Contacted", notes:"Balayage consult; ready to book next week", created_at: new Date().toISOString() },
        { tenant_id: tenant.id, name:"Marcus Lee", phone:"+1 919-555-0110", email:"marcus@home.com", source:"SMS", status:"Qualified", notes:"Brake pads quote; urgent today", created_at: new Date().toISOString() },
      ];
      const { error: lErr } = await supabase.from("leads").insert(leads);
      if (lErr) console.warn("Lead seed:", lErr.message);

      // 5) Seed appointments
      const now = new Date();
      const in2d = (h:number)=> new Date(Date.now()+2*86400000+h*3600000).toISOString();
      const appts = [
        { tenant_id: tenant.id, title: "Oil Change – Alex", customer: "Jamie Patel", start_at: in2d(14), end_at: in2d(15), staff: "Alex" },
        { tenant_id: tenant.id, title: "Color – Sam", customer: "Ana Rivera", start_at: in2d(10), end_at: in2d(11.5), staff: "Sam" },
      ];
      const { error: aErr } = await supabase.from("appointments").insert(appts);
      if (aErr) console.warn("Appt seed:", aErr.message);

      // 6) Seed a call
      const call = { tenant_id: tenant.id, from:"+1 919-555-0198", to:"+1 555-000-0000", outcome:"Booked", duration:213, at: now.toISOString(), summary:"Asked price for oil change; confirmed Friday 2:15pm with Alex." };
      const { error: cErr } = await supabase.from("calls").insert(call);
      if (cErr) console.warn("Call seed:", cErr.message);

      setMsg(`Seed complete. Tenant ${tenant.name} (${tenant.slug}) created and linked to your profile.`);
      await refreshCounts();
    }catch(e:any){
      console.error(e);
      setMsg(`Seed error: ${e?.message||e}`);
    }finally{
      setBusy(false);
    }
  }

  useEffect(()=> { checkLive(); refreshCounts(); },[]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div>Supabase URL: <b>{envOk.url? "Yes":"Missing"}</b></div>
            <div>Supabase Key: <b>{envOk.key? "Yes":"Missing"}</b></div>
            <div>Live query: <b>{liveOk==="unknown"?"…": liveOk==="yes"?"Yes":"No"}</b></div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Counts</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div>Tenants: <b>{counts.tenants}</b></div>
            <div>Leads: <b>{counts.leads}</b></div>
            <div>Appointments: <b>{counts.appts}</b></div>
            <div>Calls: <b>{counts.calls}</b></div>
            <div>Leads (24h): <b>{counts.leads24h}</b></div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={refreshCounts} variant="outline" className="rounded-2xl">Refresh</Button>
          <Button onClick={seedDemo} disabled={busy} className="rounded-2xl">{busy? "Seeding…":"Seed Demo Data"}</Button>
        </CardContent>
      </Card>

      <FooterNote />
      {msg && <div className="text-sm">{msg}</div>}
      <WhoAmI />
    </div>
  );
}

function FooterNote(){
  return <p className="text-xs text-slate-500">This page is visible to signed-in admins only. Make sure your RLS policies allow reads for admin or use a service role in server context for production.</p>;
}
function WhoAmI(){
  const [uid,setUid]=useState<string>(""); useEffect(()=>{ supabase.auth.getUser().then(r=> setUid(r.data.user?.id||"")); },[]);
  return <p className="text-xs text-slate-500">Signed in as: <code>{uid||"unknown"}</code></p>;
}
