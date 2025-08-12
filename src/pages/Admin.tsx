import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Counts = { tenants:number; leads:number; appts:number; calls:number; leads24h:number };

export default function Admin() {
  // Derive config from the live client (Lovable doesn't use .env)
  const clientUrl = (supabase as any)?.rest?.url || (supabase as any)?.storage?.url || "";
  const [envOk, setEnvOk] = useState<{url:boolean; key:boolean}>({ url: !!clientUrl, key: false });
  const [liveOk, setLiveOk] = useState<"unknown"|"yes"|"no">("unknown");
  const [counts, setCounts] = useState<Counts>({ tenants:0, leads:0, appts:0, calls:0, leads24h:0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function checkLive(){
    try{
      // This HEAD+count request succeeds only if anon key and RLS allow at least head
      const { error } = await supabase.from("tenants").select("id", { head: true, count: "exact" });
      if (error) throw error;
      setLiveOk("yes");
      setEnvOk((e)=> ({ url: !!clientUrl, key: true })); // if live query works, key is valid
    }catch(e){
      console.error(e);
      setLiveOk("no");
      setEnvOk((e)=> ({ url: !!clientUrl, key: false }));
    }
  }

  async function refreshCounts(){
    const c = async (table:string, filter?: (q:any)=>any) => {
      let q:any = (supabase as any).from(table).select("*", { head:true, count:"exact" });
      if (filter) q = filter(q);
      const { count, error } = await q;
      if (error) { console.warn("Count error:", table, error.message); return 0; }
      return count || 0;
    };

    try{
      const [tenants, leads, appts, calls] = await Promise.all([
        c("tenants"),
        c("leads"),
        c("appointments"),
        c("calls"),
      ]);
      const since = new Date(Date.now() - 24*60*60*1000).toISOString();
      const leads24h = await c("leads", (q:any)=> q.gte("created_at", since));
      setCounts({ tenants, leads, appts, calls, leads24h });
    }catch(e:any){
      console.error(e);
      setMsg(`Count error: ${e?.message||e}`);
    }
  }

  async function seedDemo(){
    setBusy(true); setMsg("");
    try{
      const { data: userRes, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const user = userRes?.user;
      if(!user){ throw new Error("No signed-in user."); }

      const slug = `demo-${Date.now().toString(36)}`;
      const { data: tenant, error: tErr } = await supabase.from("tenants").insert({ name: "Demo Auto Shop", slug }).select().single();
      if (tErr) throw tErr;

      // link profile.active_tenant_id (insert if missing)
      try {
        const { error: updErr } = await supabase.from("profiles").update({ active_tenant_id: tenant.id }).eq("id", user.id);
        if (updErr) {
          await supabase.from("profiles").insert({ id: user.id, active_tenant_id: tenant.id });
        }
      } catch { /* ignore */ }

      const nowISO = new Date().toISOString();
      const leads = [
        { tenant_id: tenant.id, name:"Jamie Patel",  phone:"+1 919-555-0198", email:"jamie@example.com",     source:"Call", status:"New",        notes:"asked price for oil change; wants Friday 2pm", created_at: nowISO },
        { tenant_id: tenant.id, name:"Ana Rivera",   phone:"+1 984-555-0142", email:"ana@beauty.co",        source:"Web",  status:"Contacted",  notes:"Balayage consult; ready to book next week",     created_at: nowISO },
        { tenant_id: tenant.id, name:"Marcus Lee",   phone:"+1 919-555-0110", email:"marcus@home.com",      source:"SMS",  status:"Qualified",  notes:"Brake pads quote; urgent today",                created_at: nowISO },
      ];
      await supabase.from("leads").insert(leads);

      const inX = (d:number,h:number)=> new Date(Date.now()+d*86400000+h*3600000).toISOString();
      const appts = [
        { tenant_id: tenant.id, title:"Oil Change – Alex", customer:"Jamie Patel", start_at: inX(2,14), end_at: inX(2,15), staff:"Alex" },
        { tenant_id: tenant.id, title:"Color – Sam",       customer:"Ana Rivera",  start_at: inX(1,10), end_at: inX(1,11), staff:"Sam"  },
      ];
      await supabase.from("appointments").insert(appts);

      const call = { tenant_id: tenant.id, from:"+1 919-555-0198", to:"+1 555-000-0000", outcome:"Booked", duration:213, at: new Date().toISOString(), summary:"Asked price for oil change; confirmed Friday 2:15pm with Alex." };
      await supabase.from("calls").insert(call);

      setMsg(`Seed complete. Tenant "${tenant.name}" created and linked to your profile.`);
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
            <div>Supabase URL configured: <b>{envOk.url? "Yes":"No"}</b></div>
            <div>Anon key valid (live ping): <b>{liveOk==="unknown"?"…": liveOk==="yes"?"Yes":"No"}</b></div>
            <div className="text-xs text-slate-500 mt-2 break-all">Client URL: {clientUrl || "—"}</div>
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
          <Button onClick={seedDemo} disabled={busy || liveOk!=="yes"} className="rounded-2xl">{busy? "Seeding…":"Seed Demo Data"}</Button>
        </CardContent>
      </Card>

      <FooterNote />
      {msg && <div className="text-sm">{msg}</div>}
      <WhoAmI />
    </div>
  );
}

function FooterNote(){
  return <p className="text-xs text-slate-500">Admin-only page. For production, protect with RLS + role checks or service-role endpoints.</p>;
}
function WhoAmI(){
  const [uid,setUid]=useState<string>(""); useEffect(()=>{ supabase.auth.getUser().then(r=> setUid(r.data.user?.id||"")); },[]);
  return <p className="text-xs text-slate-500">Signed in as: <code>{uid||"unknown"}</code></p>;
}