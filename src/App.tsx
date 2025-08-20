import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadProfile, setActiveTenant, ensureDemoTenant, myTenants, isSiteAdmin } from "@/lib/tenancy";
import { signInWithEmail, signOut, onAuth, signInWithOAuth, signInWithSms, verifySms, signInWithPassword, signUpWithPassword, mfaEnrollTotp, mfaVerifyEnrollment } from "@/lib/auth";
import { CONFIG } from "@/lib/webhooks";
import VoiceRelayLogo from "@/components/VoiceRelayLogo";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import SignInScreen from "@/components/SignInScreen";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import Demo from "@/pages/Demo";
import AdminOnboarding from "@/pages/AdminOnboarding";
import AcceptInvite from "@/pages/AcceptInvite";
import AdminRoute from "@/components/admin/AdminRoute";
import AdminLink from "@/components/admin/AdminLink";
import { TenantManagement } from "@/components/admin/TenantManagement";
const queryClient = new QueryClient();

function getQueryParam(name: string) {
  try { return new URL(window.location.href).searchParams.get(name) || ""; } catch { return ""; }
}

function parseDoubleHashAuth() {
  // Handles URLs like: https://.../#auth#access_token=...&refresh_token=...&type=recovery
  const raw = window.location.hash || "";
  if (!raw) return null;

  // If there's no second hash, nothing to parse
  const firstHashIdx = raw.indexOf("#");
  const secondHashIdx = raw.indexOf("#", firstHashIdx + 1);
  if (secondHashIdx === -1) return null;

  const afterSecond = raw.slice(secondHashIdx + 1); // "access_token=...&refresh_token=...&type=recovery"
  const params = new URLSearchParams(afterSecond);

  const access_token = params.get("access_token") || "";
  const refresh_token = params.get("refresh_token") || "";
  const type = params.get("type") || "";
  const expires_at = params.get("expires_at") || "";
  const token_type = params.get("token_type") || "bearer";

  if (!access_token || !refresh_token) return null;

  return { access_token, refresh_token, type, expires_at, token_type };
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
      // Do NOT auto-select a tenant for site admins to keep them in site-admin mode
      if (!p?.is_site_admin && !p?.active_tenant_id && ts[0]) await setActiveTenant(ts[0].id);
    })();
  }, [session]);

  if (loading) return <div className="p-8">Loading…</div>;
  if (!session) return <SignInScreen />;

  // Check if we're rendering Dashboard which has its own header
  const isDashboard = window.location.hash === "#app";
  
  return (
    <div className="min-h-screen">
      {!isDashboard && <TopBar profile={profile} tenants={tenants} onSwitch={async(id:string)=>{ await setActiveTenant(id); location.reload(); }} onSignOut={async()=>{ await signOut(); location.reload(); }} />}
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
    
    // Check if site admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_site_admin")
      .eq("id", data.session.user.id)
      .single();
    
    setOk(!!profile?.is_site_admin);
    setReady(true);
  })(); },[]);
  if(!ready) return <div className="p-6">Checking admin…</div>;
  if(!ok) return <div className="p-6">403 — Site admins only. You need to be marked as is_site_admin=true in the profiles table.</div>;
  return children;
}

function TopBar({ profile, tenants, onSwitch, onSignOut }:{ profile:any; tenants:any; onSwitch:(id:string)=>void; onSignOut:()=>void }){
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(r => setUser(r.data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <header className="border-b bg-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <VoiceRelayLogo size="sm" />
          <span className="font-semibold text-foreground">{tenants?.find((t:any)=> t.id===profile?.active_tenant_id)?.name || "Workspace"}</span>
        </div>
        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-4">
            <a href="/" className="text-sm hover:underline">Home</a>
            {user && <a href="/#app" className="text-sm hover:underline">Dashboard</a>}
            <AdminLink className="text-sm hover:underline" />
          </nav>
          {user ? (
            <>
              {tenants && tenants.length > 0 && (
                <select className="border rounded-xl px-2 py-1" value={profile?.active_tenant_id || ""} onChange={(e)=> onSwitch((e.target as HTMLSelectElement).value)}>
                  {tenants.map((t:any)=> <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button className="text-sm underline" onClick={onSignOut}>Sign out</button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <a href="/#signin" className="text-sm hover:underline">Sign in</a>
              <a href="/#app" className="text-sm bg-primary text-primary-foreground px-3 py-1 rounded-xl hover:opacity-90">Get started</a>
            </div>
          )}
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
        <Route path="/demo" element={<Demo />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route 
          path="/admin/onboarding" 
          element={
            <AdminRoute>
              <AdminOnboarding />
            </AdminRoute>
          } 
        />
        <Route path="/admin" element={<Navigate to="/admin/onboarding" replace />} />
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
      
      {/* Quick access to onboarding system */}
      <div className="mb-6 p-4 bg-violet-50 border border-violet-200 rounded-xl">
        <h2 className="text-lg font-medium text-violet-900 mb-2">Tenant Onboarding</h2>
        <p className="text-sm text-violet-700 mb-3">Create and configure new customer tenants with our guided onboarding system.</p>
        <a 
          href="/admin/onboarding" 
          className="inline-flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
        >
          Open Tenant Onboarding →
        </a>
      </div>

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
      <div className="mt-6">
        <TenantManagement />
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
        // Case A: Newer flow (?code=...) — keep supporting this if you move to it later
        const code = getQueryParam("code");
        const typeQ = getQueryParam("type"); // e.g., recovery|magiclink|invite
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (typeQ === "recovery") { location.hash = "#reset"; return; }
          location.hash = "#app"; return;
        }

        // Case B: Current double-hash flow (#auth#access_token=...&type=recovery)
        const parsed = parseDoubleHashAuth();
        if (parsed) {
          console.log("[AuthCallback] Double-hash tokens detected:", parsed.type);
          const { access_token, refresh_token, type } = parsed;
          // Set session explicitly since the SDK won't parse the second hash segment automatically
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          // Clean up URL hash so your router isn't confused
          history.replaceState(null, "", `${window.location.origin}/#auth`);
          if (type === "recovery") { location.hash = "#reset"; return; }
          location.hash = "#app"; return;
        }

        // Case C: Legacy single-hash tokens (#access_token=...)
        const hash = window.location.hash || "";
        if (hash.includes("access_token") || hash.includes("refresh_token")) {
          const isRecovery = hash.includes("type=recovery");
          console.log("[AuthCallback] Single-hash tokens detected. isRecovery:", isRecovery);
          // Supabase usually sets session automatically via onAuthStateChange, but be explicit if needed:
          // (Optional) You can parse and call setSession here as well like above.
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

export default function VoiceRelayProApp() {
  const [mode, setMode] = useState<'site'|'app'|'signin'|'admin'|'auth'|'reset'|'routes'>(() => {
    if (typeof window === 'undefined') return 'site';
    const raw = location.hash || "";
    const pathname = location.pathname;
    
    // Check for regular path routes first
    if (pathname.startsWith('/admin') || pathname === '/demo' || pathname === '/accept-invite') return 'routes';
    
    // Force auth mode if tokens are in the hash anywhere (double-hash safe)
    if (raw.includes("access_token") || raw.includes("refresh_token") || raw.includes("type=recovery")) return "auth";
    const h = raw.replace('#','');
    return (['app','signin','admin','auth','reset'].includes(h) ? (h as any) : 'site');
  });
  useEffect(() => {
    const onHashOrPath = () => {
      const raw = location.hash || "";
      const pathname = location.pathname;
      
      // Check for regular path routes first
      if (pathname.startsWith('/admin') || pathname === '/demo' || pathname === '/accept-invite') {
        setMode('routes'); return;
      }
      
      if (raw.includes("access_token") || raw.includes("refresh_token") || raw.includes("type=recovery")) {
        setMode("auth"); return;
      }
      const h = raw.replace('#','');
      setMode((['app','signin','admin','auth','reset'].includes(h) ? (h as any) : 'site'));
    };
    window.addEventListener('hashchange', onHashOrPath);
    window.addEventListener('popstate', onHashOrPath);
    return () => {
      window.removeEventListener('hashchange', onHashOrPath);
      window.removeEventListener('popstate', onHashOrPath);
    };
  }, []);

  const content = mode === 'app'
    ? <AuthGate><Dashboard /></AuthGate>
    : mode === 'signin'
      ? <SignInScreen />
      : mode === 'admin'
        ? <AuthGate><AdminGate><AdminPanel /></AdminGate></AuthGate>
        : mode === 'auth'
          ? <AuthCallback />
          : mode === 'reset'
            ? <ResetPasswordScreen />
            : mode === 'routes'
              ? <DashboardShell />
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

