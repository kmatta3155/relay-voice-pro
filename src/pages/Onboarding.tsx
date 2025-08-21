import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ingestWebsite } from "@/lib/rag";

export default function Onboarding() {
  const [tenantId, setTenantId] = useState<string>("");
  const [biz, setBiz] = useState({ name: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(()=> {
    (async ()=>{
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
      if (data?.active_tenant_id) setTenantId(data.active_tenant_id);
    })();
  }, []);

  async function start() {
    if (!tenantId || !biz.url) { alert("Enter your business URL"); return; }
    setBusy(true); setDone(null);
    try {
      await ingestWebsite(tenantId, biz.url, {
        includeSubdomains: true,
        maxPages: 120,
        maxDepth: 4,
        allowPatterns: ["services|pricing|packages|menu|treatment|book|appointment|schedule"],
        denyPatterns: ["\\.(pdf|jpg|jpeg|png|gif|webp|svg)$"],
        includeBookingProviders: true,
        extraAllowedHosts: []
      });
      setDone("✅ Imported your site! Jump into Knowledge to review & search.");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Fast Onboarding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Business Name" value={biz.name} onChange={(e)=> setBiz({ ...biz, name: e.target.value })}/>
          <Input placeholder="Website URL (https://…)" value={biz.url} onChange={(e)=> setBiz({ ...biz, url: e.target.value })}/>
          <Button onClick={start} disabled={busy} className="rounded-2xl">{busy? "Training…" : "Auto‑train my AI"}</Button>
          {done && <div className="text-sm text-primary">{done}</div>}
        </CardContent>
      </Card>
    </div>
  );
}