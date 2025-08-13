import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * SubGuard: blocks CRM access unless tenant subscription is active.
 * Shows current status + buttons to upgrade/manage billing.
 */
export default function SubGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) { setError("Not signed in"); setLoading(false); return; }
        const { data: p, error: perr } = await supabase
          .from("profiles").select("active_tenant_id").eq("id", uid).single();
        if (perr) throw perr;
        const tid = p?.active_tenant_id as string | null;
        setTenantId(tid);
        if (!tid) { setError("No active workspace selected."); setLoading(false); return; }
        const { data: t, error: terr } = await supabase
          .from("tenants").select("subscription_status").eq("id", tid).single();
        if (terr) throw terr;
        setStatus(t?.subscription_status || null);
      } catch (e: any) { setError(e.message || String(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6 text-sm">Checking subscription…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  const active = status === "active" || status === "trialing";
  if (active) return <>{children}</>;

  return (
    <div className="max-w-xl mx-auto p-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Activate your workspace</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Your subscription isn't active yet. Start a plan to unlock the CRM.</p>
          <div className="flex gap-2">
            <Button className="rounded-2xl" onClick={() => (window.location.hash = "#billing")}>Upgrade</Button>
            <Button variant="outline" className="rounded-2xl" onClick={() => (window.location.hash = "#billing")}>Open Billing</Button>
          </div>
          <p className="text-xs text-slate-500">Status: <b>{status || "none"}</b> • Tenant: <code>{tenantId}</code></p>
        </CardContent>
      </Card>
    </div>
  );
}