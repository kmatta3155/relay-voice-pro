import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Call = { id: string; tenant_id: string; from: string | null; to: string | null; outcome: string | null; duration: number | null; at: string | null; summary: string | null };

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function CallsPage() {
  const [rows, setRows] = useState<Call[]>([]);
  async function load() {
    const tid = await tenantId();
    const { data } = await supabase.from("calls").select("*").eq("tenant_id", tid).order("at", { ascending: false });
    setRows(data || []);
  }
  useEffect(() => {
    load();
    
    // Real-time subscription for live updates
    let isMounted = true;
    let callsSub: ReturnType<typeof supabase.channel> | null = null;
    
    (async () => {
      const tid = await tenantId();
      if (!isMounted) return; // Don't subscribe if already unmounted
      
      callsSub = supabase
        .channel('calls-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
    })();
    
    return () => {
      isMounted = false;
      callsSub?.unsubscribe();
    };
  }, []);

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Call log</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">From</th><th>Outcome</th><th>Duration</th><th>When</th><th className="p-3">Summary</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-medium">{c.from}</td>
                <td className="p-3">{c.outcome}</td>
                <td className="p-3">{c.duration ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : ""}</td>
                <td className="p-3">{c.at ? new Date(c.at).toLocaleString() : ""}</td>
                <td className="p-3 text-slate-600">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}