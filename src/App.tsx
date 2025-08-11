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
const queryClient = new QueryClient();

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

function AdminGate({ children }:{ children:any }) {
  const [ready,setReady]=useState(false);
  const [ok,setOk]=useState(false);
  useEffect(()=>{ (async()=>{
    const { data } = await supabase.auth.getSession();
    if(!data.session){ location.hash = "#signin"; return; }
    setOk(await isSiteAdmin());
    setReady(true);
  })(); },[]);
  if(!ready) return <div className="p-6">Checking admin…</div>;
  if(!ok) return <div className="p-6">403 — Admins only</div>;
  return children;
}

function useSessionState(){
  const [session,setSession]=useState<any>(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.auth.getSession(); setSession(data.session); onAuth((s)=> setSession(s)); })(); },[]);
  return session;
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

function SignInScreen(){
  const [tab, setTab] = React.useState<"email"|"oauth"|"phone"|"password"|"mfa">("email");

  // email magic
  const [email, setEmail] = React.useState(""); const [sent, setSent] = React.useState(false);

  // password
  const [pwEmail, setPwEmail] = React.useState(""); const [pw, setPw] = React.useState(""); const [isSignup, setIsSignup] = React.useState(false);

  // phone
  const [phone, setPhone] = React.useState(""); const [smsSent, setSmsSent] = React.useState(false); const [smsCode, setSmsCode] = React.useState("");

  // mfa
  const [factorId, setFactorId] = React.useState(""); const [mfaCode, setMfaCode] = React.useState("");

  const [err, setErr] = React.useState<string|null>(null); const [ok, setOk] = React.useState<string|null>(null);
  function reset(){ setErr(null); setOk(null); }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow">
        <h1 className="text-xl font-semibold mb-4">Sign in to RelayAI</h1>

        <div className="flex gap-2 mb-4 text-sm">
          {["email","oauth","phone","password","mfa"].map(k=> (
            <button key={k} onClick={()=> setTab(k as any)}
              className={`px-3 py-1 rounded-xl border ${tab===k?'bg-black text-white border-black':'hover:bg-slate-50'}`}>
              {(k as string).toUpperCase()}
            </button>
          ))}
        </div>

        {/* --- EMAIL MAGIC LINK --- */}
        {tab==="email" && (
          <div>
            {!sent ? (
              <>
                <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="Work email"
                  value={email} onChange={(e)=> setEmail(e.target.value)} />
                <button className="w-full rounded-xl px-4 py-2 bg-black text-white"
                  onClick={async()=>{ reset(); try{ await signInWithEmail(email); setSent(true); setOk("Check your email for the sign-in link."); }catch(e:any){ setErr(e.message);} }}>
                  Email magic link
                </button>
              </>
            ) : <div className="text-sm text-slate-600">Check your email. Keep this tab open.</div>}
          </div>
        )}

        {/* --- OAUTH PROVIDERS --- */}
        {tab==="oauth" && (
          <div className="grid gap-2">
            {[
              ["google","Continue with Google"],
              ["github","Continue with GitHub"],
              ["azure","Continue with Microsoft"],
              ["apple","Continue with Apple"],
              ["facebook","Continue with Facebook"]
            ].map(([id,label])=> (
              <button key={id as string} className="w-full rounded-xl px-4 py-2 border hover:bg-slate-50"
                onClick={async()=>{ reset(); try{ await signInWithOAuth(id as any); }catch(e:any){ setErr(e.message);} }}>
                {label as string}
              </button>
            ))}
            <div className="text-xs text-slate-500 mt-2">Enable providers in Supabase → Authentication → Providers.</div>
          </div>
        )}

        {/* --- PHONE OTP --- */}
        {tab==="phone" && (
          <div>
            {!smsSent ? (
              <>
                <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="+1 919 555 0123"
                  value={phone} onChange={(e)=> setPhone(e.target.value)} />
                <button className="w-full rounded-xl px-4 py-2 bg-black text-white"
                  onClick={async()=>{ reset(); try{ await signInWithSms(phone); setSmsSent(true); setOk("SMS code sent"); }catch(e:any){ setErr(e.message);} }}>
                  Send SMS code
                </button>
              </>
            ) : (
              <>
                <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="123456"
                  value={smsCode} onChange={(e)=> setSmsCode(e.target.value)} />
                <button className="w-full rounded-xl px-4 py-2 bg-black text-white"
                  onClick={async()=>{ reset(); try{ await verifySms(phone, smsCode); location.hash="#app"; }catch(e:any){ setErr(e.message);} }}>
                  Verify & continue
                </button>
              </>
            )}
            <div className="text-xs text-slate-500 mt-2">Configure SMS in Supabase → Authentication → Settings → SMS.</div>
          </div>
        )}

        {/* --- PASSWORD (SIGN IN OR SIGN UP) --- */}
        {tab==="password" && (
          <div>
            <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="Email"
              value={pwEmail} onChange={(e)=> setPwEmail(e.target.value)} />
            <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="Password" type="password"
              value={pw} onChange={(e)=> setPw(e.target.value)} />
            {!isSignup ? (
              <button className="w-full rounded-xl px-4 py-2 bg-black text-white"
                onClick={async()=>{ reset(); try{ await signInWithPassword(pwEmail, pw); location.hash="#app"; }catch(e:any){ setErr(e.message);} }}>
                Sign in
              </button>
            ) : (
              <button className="w-full rounded-xl px-4 py-2 bg-black text-white"
                onClick={async()=>{ reset(); try{ await signUpWithPassword(pwEmail, pw); setOk("Account created. Check your email (if confirmation enabled), then sign in."); setIsSignup(false);}catch(e:any){ setErr(e.message);} }}>
                Create account
              </button>
            )}
            <div className="text-xs text-slate-500 mt-2">
              {isSignup ? "Already have an account?" : "New here?"}{" "}
              <button className="underline" onClick={()=> setIsSignup(!isSignup)}>
                {isSignup ? "Sign in" : "Create one"}
              </button>
            </div>
          </div>
        )}

        {/* --- MFA (TOTP) QUICK ACTIONS (optional area) --- */}
        {tab==="mfa" && (
          <div className="text-sm">
            <div className="mb-2">Enroll or verify TOTP (Authenticator app).</div>
            <div className="grid gap-2">
              <button className="rounded-xl px-4 py-2 border hover:bg-slate-50"
                onClick={async()=>{ reset(); try{
                  const data = await mfaEnrollTotp();
                  setFactorId(data.id);
                  setOk("Scan the QR with your Authenticator app, then enter the 6‑digit code below.");
                }catch(e:any){ setErr(e.message); }}}>
                Enroll TOTP
              </button>
              <input className="border rounded-xl px-3 py-2 w-full" placeholder="123456"
                value={mfaCode} onChange={(e)=> setMfaCode(e.target.value)} />
              <button className="rounded-xl px-4 py-2 bg-black text-white"
                onClick={async()=>{ reset(); try{
                  if(!factorId) { setErr("Enroll first to get a factorId"); return; }
                  await mfaVerifyEnrollment(factorId, mfaCode);
                  setOk("TOTP enabled for your account.");
                }catch(e:any){ setErr(e.message);} }}>
                Verify enrollment
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-2">Enable MFA in Supabase → Authentication → Multi‑factor auth.</div>
          </div>
        )}

        {(err || ok) && <div className={`mt-3 text-sm ${err?'text-red-700':'text-green-700'}`}>{err || ok}</div>}
      </div>
    </div>
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

export default function RelayAIPlatformApp() {
  const [mode, setMode] = useState<'site'|'app'|'signin'|'admin'>(() => {
    if (typeof window === 'undefined') return 'site';
    const h = (location.hash || '').replace('#','');
    return (['app','signin','admin'].includes(h) ? (h as any) : 'site');
  });
  useEffect(() => {
    const onHash = () => {
      const h = (location.hash || '').replace('#','');
      setMode((['app','signin','admin'].includes(h) ? (h as any) : 'site'));
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

