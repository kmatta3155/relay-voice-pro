import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerManagement } from "@/components/admin/CustomerManagement";
import { Link } from "react-router-dom";

type Counts = { tenants:number; leads:number; appts:number; calls:number; leads24h:number };

export default function Admin() {
  const clientUrl =
    ((supabase as any)?.rest?.url) ||
    ((supabase as any)?.storage?.url) ||
    ((supabase as any)?._baseUrl) ||
    "";

  const [clientConfigured] = useState<boolean>(!!clientUrl);
  const [dbReachable, setDbReachable] = useState<"unknown"|"yes"|"no"|"missing-tables">("unknown");
  const [counts, setCounts] = useState<Counts>({ tenants:0, leads:0, appts:0, calls:0, leads24h:0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function ping() {
    try {
      const { error } = await supabase.from("tenants").select("id", { head:true, count:"exact" });
      if (error) {
        if ((error as any)?.code === "42P01") { setDbReachable("missing-tables"); return; }
        setDbReachable("no"); return;
      }
      setDbReachable("yes");
    } catch { setDbReachable("no"); }
  }

  async function refreshCounts(){
    const c = async (table:string, filter?: (q:any)=>any) => {
      try {
        let q:any = (supabase as any).from(table).select("*", { head:true, count:"exact" });
        if (filter) q = filter(q);
        const { count, error } = await q;
        if (error) return 0;
        return count || 0;
      } catch { return 0; }
    };
    const since = new Date(Date.now() - 24*60*60*1000).toISOString();
    const [tenants, leads, appts, calls] = await Promise.all([
      c("tenants"), c("leads"), c("appointments"), c("calls")
    ]);
    const leads24h = await c("leads", (q:any)=> q.gte("created_at", since));
    setCounts({ tenants, leads, appts, calls, leads24h });
  }

  async function seedDemo(){
    setBusy(true); setMsg("");
    try{
      const { data: ures, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      const user = ures?.user;
      if (!user) throw new Error("No signed-in user");

      const slug = `demo-${Date.now().toString(36)}`;
      const { data: tenant, error: terr } =
        await supabase.from("tenants").insert({
          name:"Demo Auto Shop",
          slug,
          created_by: user.id
        }).select().single();
      if (terr) throw terr;

      // Link profile -> active tenant (insert if missing)
      const { error: updErr } =
        await supabase.from("profiles").update({ active_tenant_id: tenant.id }).eq("id", user.id);
      if (updErr) {
        await supabase.from("profiles").insert({ id: user.id, active_tenant_id: tenant.id });
      }

      // Ensure membership (owner)
      (supabase as any).from("tenant_members").upsert({
        tenant_id: tenant.id, user_id: user.id, role: "owner"
      });

      const nowISO = new Date().toISOString();
      await supabase.from("leads").insert([
        { tenant_id: tenant.id, name:"Jamie Patel",  phone:"+1 919-555-0198", email:"jamie@example.com", source:"Call", status:"New",        notes:"asked price for oil change; wants Friday 2pm", created_at: nowISO },
        { tenant_id: tenant.id, name:"Ana Rivera",   phone:"+1 984-555-0142", email:"ana@beauty.co",     source:"Web",  status:"Contacted",  notes:"Balayage consult; ready to book next week",     created_at: nowISO },
        { tenant_id: tenant.id, name:"Marcus Lee",   phone:"+1 919-555-0110", email:"marcus@home.com",   source:"SMS",  status:"Qualified",  notes:"Brake pads quote; urgent today",                created_at: nowISO },
      ]);

      const inX = (d:number,h:number)=> new Date(Date.now()+d*86400000+h*3600000).toISOString();
      await supabase.from("appointments").insert([
        { tenant_id: tenant.id, title:"Oil Change – Alex", customer:"Jamie Patel", start_at: inX(2,14), end_at: inX(2,15), staff:"Alex" },
        { tenant_id: tenant.id, title:"Color – Sam",       customer:"Ana Rivera",  start_at: inX(1,10), end_at: inX(1,11), staff:"Sam"  },
      ]);

      await supabase.from("calls").insert({
        tenant_id: tenant.id, from:"+1 919-555-0198", to:"+1 555-000-0000",
        outcome:"Booked", duration:213, at:new Date().toISOString(),
        summary:"Asked price for oil change; confirmed Friday 2:15pm with Alex."
      });

      setMsg(`Seed complete. Tenant created, you are owner. Open #app to view.`);
      await refreshCounts();
    }catch(e:any){
      setMsg(`Seed error: ${e?.code ? e.code + ": " : ""}${e?.message || e}`);
    }finally{ setBusy(false); }
  }

  useEffect(()=> { ping(); refreshCounts(); },[]);

  const envBadge = clientConfigured ? "Yes" : "No";
  const dbBadge =
    dbReachable==="yes" ? "Yes" :
    dbReachable==="no" ? "No" :
    dbReachable==="missing-tables" ? "Tables missing" : "…";

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div>Supabase client configured: <b>{envBadge}</b></div>
            <div>DB reachable (anon key ok): <b>{dbBadge}</b></div>
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
          <CardHeader><CardTitle>Customer Onboarding</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create and configure new customers with our guided onboarding system.
            </p>
            <Link to="/admin-onboarding">
              <Button className="w-full">Create New Customer</Button>
            </Link>
          </CardContent>
        </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={refreshCounts} variant="outline" className="rounded-2xl">Refresh</Button>
          <Button onClick={seedDemo} disabled={busy || dbReachable!=="yes"} className="rounded-2xl">
            {busy? "Seeding…" : "Seed Demo Data"}
          </Button>
        </CardContent>
      </Card>

      <CustomerManagement />

      {msg && <div className="text-sm">{msg}</div>}
      <WhoAmI />
      <p className="text-xs text-slate-500">Admin-only. RLS + roles enforced in DB.</p>
    </div>
  );
}

function WhoAmI(){
  const [uid,setUid]=useState<string>("");
  useEffect(()=>{ supabase.auth.getUser().then(r=> setUid(r.data.user?.id||"")); },[]);
  return <p className="text-xs text-slate-500">Signed in as: <code>{uid||"unknown"}</code></p>;
}
