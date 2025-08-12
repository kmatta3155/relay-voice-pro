import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadProfile, setActiveTenant, ensureDemoTenant, myTenants, isSiteAdmin } from "@/lib/tenancy";
import { signInWithEmail, signOut, onAuth, signInWithOAuth, signInWithSms, verifySms, signInWithPassword, signUpWithPassword, mfaEnrollTotp, mfaVerifyEnrollment } from "@/lib/auth";
import { CONFIG } from "@/lib/webhooks";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import SignInScreen from "@/components/SignInScreen";
const queryClient = new QueryClient();

function getQueryParam(name: string) {
  try { return new URL(window.location.href).searchParams.get(name) || ""; } catch { return ""; }
}

function AuthGate({ children }: { children: any }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      onAuth((s)=> setSession(s));
      setLoading(false);
    })();
  }, []);

  useEffect(()=> {
    (async ()=>{
      if (!session) return;
      const p = await loadProfile(); setProfile(p);
      const ts = await ensureDemoTenant(); setTenants(ts);
      if (!p?.active_tenant_id && ts[0]) await setActiveTenant(ts[0].id);
    })();
  }, [session]);

  if (loading) return <div className="p-8">Loading…</div>;
  if (!session) return <SignInScreen />;

  return (
    <div className="min-h-screen">
      <TopBar profile={profile} tenants={tenants} onSwitch={async(id:string)=>{ await setActiveTenant(id); location.reload(); }} onSignOut={async()=>{ await signOut(); location.reload(); }} />
      {children}
    </div>
  );
}

function useSessionState(){
  const [session,setSession]=useState<any>(null);
  useEffect(()=>{ (async()=>{
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    supabase.auth.onAuthStateChange((_e,s)=> setSession(s));
  })(); },[]);
  return session;
}

async function _isSiteAdmin() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await (supabase as any).from("profiles").select("is_site_admin").eq("id", user.id).single();
  return !!(data as any)?.is_site_admin;
}

function AdminGate({ children }:{ children:any }) {
  const [ready,setReady]=useState(false);
  const [ok,setOk]=useState(false);
  useEffect(()=>{ (async()=>{
    const { data } = await supabase.auth.getSession();
    if(!data.session){ location.hash = "#signin"; return; }
    setOk(await _isSiteAdmin());
    setReady(true);
  })(); },[]);
  if(!ready) return <div className="p-6">Checking admin…</div>;
  if(!ok) return <div className="p-6">403 — Admins only</div>;
  return children;
}

function TopBar({ profile, tenants, onSwitch, onSignOut }:{ profile:any; tenants:any; onSwitch:(id:string)=>void; onSignOut:()=>void }){
  return (
    <header className="border-b bg-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="font-semibold">RelayAI – {tenants.find((t:any)=> t.id===profile?.active_tenant_id)?.name || "Workspace"}</div>
        <div className="flex items-center gap-2">
          <select className="border rounded-xl px-2 py-1" value={profile?.active_tenant_id || ""} onChange={(e)=> onSwitch((e.target as HTMLSelectElement).value)}>
            {tenants.map((t:any)=> <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="text-sm underline" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}


function DashboardShell(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function AdminPanel(){
  const [loading,setLoading]=useState(true);
  const [info,setInfo]=useState<any>({});
  useEffect(()=>{ (async()=>{
    const session = await supabase.auth.getSession();
    const uid = session.data.session?.user.id;
    // counts
    const c = async (table:any, filter?:any) => {
      const q = (supabase as any).from(table).select("*",{count:"exact",head:true});
      const r = filter ? await q.match(filter) : await q;
      return r.count||0;
    };
    const [tenants, leads, appts, calls] = await Promise.all([
      c("tenants"),
      c("leads"),
      c("appointments"),
      c("calls"),
    ]);
    // last 24h leads
    const since = new Date(Date.now()-24*3600*1000).toISOString();
    const { count: leads24 } = await supabase.from("leads").select("*",{count:"exact",head:true}).gte("created_at", since);
    // env
    const env = {
      supabaseUrl: !!import.meta.env.VITE_SUPABASE_URL,
      supabaseKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
      cal: !!(CONFIG.CAL_URL || CONFIG.CAL_EVENT_PATH || CONFIG.CAL_HANDLE),
      domain: !!CONFIG.DOMAIN,
    } as const;
    setInfo({ tenants, leads, appts, calls, leads24: leads24||0, uid, env });
    setLoading(false);
  })(); },[]);
  if(loading) return <div className="p-6">Loading admin…</div>;
  return (
    <section className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Admin</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white shadow ring-1 ring-black/5 p-4">
          <div className="text-sm text-slate-500">Environment</div>
          <ul className="mt-2 text-sm">
            <li>Supabase URL: <b>{info.env.supabaseUrl ? "OK" : "Missing"}</b></li>
            <li>Supabase Key: <b>{info.env.supabaseKey ? "OK" : "Missing"}</b></li>
            <li>Cal.com configured: <b>{info.env.cal ? "Yes" : "No"}</b></li>
            <li>Domain set: <b>{info.env.domain ? "Yes" : "No"}</b></li>
          </ul>
        </div>
        <div className="rounded-2xl bg-white shadow ring-1 ring-black/5 p-4">
          <div className="text-sm text-slate-500">Counts</div>
          <ul className="mt-2 text-sm">
            <li>Tenants: <b>{info.tenants}</b></li>
            <li>Leads: <b>{info.leads}</b></li>
            <li>Appointments: <b>{info.appts}</b></li>
            <li>Calls: <b>{info.calls}</b></li>
            <li>Leads (24h): <b>{info.leads24}</b></li>
          </ul>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-4">Signed in as: {info.uid}</p>
    </section>
  );
}

function MarketingSite(){
  return <Index />;
}

function AuthCallback(){
  const [state, setState] = React.useState<"working"|"error">("working");
  const [err, setErr] = React.useState<string>("");

  React.useEffect(()=> {
    (async ()=>{
      try{
        // New-style (v2) email links put ?code=...&type=recovery|magiclink|invite
        const code = getQueryParam("code");
        const type = getQueryParam("type");

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;

          // If this is a password recovery link, push user to reset screen
          if (type === "recovery") {
            console.log("[AuthCallback] Recovery flow → #reset");
            location.hash = "#reset";
            return;
          }

          console.log("[AuthCallback] Session established → #app");
          location.hash = "#app";
          return;
        }

        // Legacy/edge: some links land with tokens in the hash fragment
        // e.g. #access_token=...&refresh_token=...&type=recovery
        const hash = window.location.hash || "";
        if (hash.includes("access_token") || hash.includes("refresh_token")) {
          const isRecovery = hash.includes("type=recovery");
          console.log("[AuthCallback] Hash tokens detected. isRecovery:", isRecovery);
          // Supabase SDK usually picks this up via onAuthStateChange, but route explicitly:
          location.hash = isRecovery ? "#reset" : "#app";
          return;
        }

        throw new Error("Invalid or expired auth callback URL.");
      }catch(e:any){
        console.error("[AuthCallback] Error:", e);
        setErr(e.message || "Auth callback failed.");
        setState("error");
      }
    })();
  },[]);

  if(state==="working") return <div className="p-6">Signing you in…</div>;
  return <div className="p-6">Auth error: {err} <a className="underline" href="#signin">Back to sign in</a></div>;
}

function ResetPasswordScreen(){
  const [pw1, setPw1] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [err, setErr] = React.useState<string|null>(null);
  const [msg, setMsg] = React.useState<string|null>(null);
  const [busy, setBusy] = React.useState(false);

  async function updatePw(){
    setErr(null); setMsg(null);
    if (!pw1 || pw1.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw1 !== pw2) { setErr("Passwords do not match."); return; }
    setBusy(true);
    try{
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      setMsg("Password updated. Redirecting…");
      setTimeout(()=> { location.hash = "#app"; }, 800);
    }catch(e:any){ setErr(e.message||"Could not update password."); }
    finally{ setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow">
        <h1 className="text-xl font-semibold mb-3">Set a new password</h1>
        <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="New password" type="password" value={pw1} onChange={(e)=> setPw1(e.target.value)} />
        <input className="border rounded-xl px-3 py-2 w-full mb-3" placeholder="Confirm new password" type="password" value={pw2} onChange={(e)=> setPw2(e.target.value)} />
        {err && <div className="text-sm text-red-700 mb-2">{err}</div>}
        {msg && <div className="text-sm text-green-700 mb-2">{msg}</div>}
        <button className="w-full rounded-xl px-4 py-2 bg-black text-white" disabled={busy} onClick={updatePw}>{busy? "Updating…" : "Update password"}</button>
        <div className="text-xs text-slate-500 mt-3"><a className="underline" href="#signin">Back to sign in</a></div>
      </div>
    </div>
  );
}

export default function RelayAIPlatformApp() {
  const [mode, setMode] = useState<'site'|'app'|'signin'|'admin'|'auth'|'reset'>(() => {
    if (typeof window === 'undefined') return 'site';
    const h = (location.hash || '').replace('#','');
    return (['app','signin','admin','auth','reset'].includes(h) ? (h as any) : 'site');
  });
  useEffect(() => {
    const onHash = () => {
      const h = (location.hash || '').replace('#','');
      setMode((['app','signin','admin','auth','reset'].includes(h) ? (h as any) : 'site'));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const content = mode === 'app'
    ? <AuthGate><DashboardShell /></AuthGate>
    : mode === 'signin'
      ? <SignInScreen />
      : mode === 'admin'
        ? <AdminGate><AdminPanel /></AdminGate>
        : mode === 'auth'
          ? <AuthCallback />
          : mode === 'reset'
            ? <ResetPasswordScreen />
            : <MarketingSite />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        {content}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

