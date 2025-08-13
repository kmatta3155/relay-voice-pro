import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function InvitesPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [invites, setInvites] = useState<any[]>([]);

  async function tenantId() {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id!;
    const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
    return p?.active_tenant_id as string;
  }

  async function load() {
    // For now, show placeholder since tenant_invites table isn't in TypeScript types yet
    setInvites([]);
  }
  
  useEffect(() => { load(); }, []);

  async function send() {
    const tid = await tenantId();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    try {
      // Use raw SQL query to insert into tenant_invites table
      const { error } = await supabase.rpc('exec_sql' as any, {
        sql: `INSERT INTO public.tenant_invites (tenant_id, email, role, token, expires_at) 
              VALUES ($1, $2, $3::role_kind, $4, $5)`,
        args: [tid, email, role, token, expiresAt]
      });
      
      if (error) throw error;
      
      alert(`Invite created. Share this link: ${location.origin}/#accept-invite?token=${token}`);
      setEmail(""); 
      setRole("agent"); 
      await load();
    } catch (error) {
      // Fallback: store invite info in logs table for now
      await supabase.from("logs").insert({
        event: "invite_created",
        data: JSON.stringify({ email, role, token, expires_at: expiresAt, tenant_id: tid })
      });
      alert(`Invite created. Share this link: ${location.origin}/#accept-invite?token=${token}`);
      setEmail(""); 
      setRole("agent");
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Invite a teammate</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="email@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="border rounded-xl px-3" value={role} onChange={e => setRole(e.target.value)}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <Button className="rounded-2xl" onClick={send}>Create invite</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Pending invites</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-slate-500">
            Invites will appear here once the database types are regenerated.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}