import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadProfile, setActiveTenant, ensureDemoTenant } from "@/lib/tenancy";
import { signInWithEmail, signInWithGoogle, signOut, onAuth } from "@/lib/auth";
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
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow">
        <h1 className="text-xl font-semibold mb-4">Sign in to RelayAI</h1>
        {!sent ? (
          <>
            <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="Work email" value={email} onChange={(e)=> setEmail((e.target as HTMLInputElement).value)} />
            <button className="w-full rounded-xl px-4 py-2 bg-black text-white" onClick={async()=>{ await signInWithEmail(email); setSent(true); }}>Email magic link</button>
            <button className="w-full rounded-xl px-4 py-2 border mt-2" onClick={async()=>{ await signInWithGoogle(); }}>Continue with Google</button>
          </>
        ) : <div className="text-sm text-slate-600">Check your email for the sign-in link.</div>}
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
