import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function InvitesPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [rows, setRows] = useState<any[]>([]);

  async function tenantId() {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id!;
    const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
    return p?.active_tenant_id as string;
  }

  async function load() {
    const tid = await tenantId();
    const { data } = await supabase.from("tenant_invites").select("*").eq("tenant_id", tid).order("created_at", { ascending: false });
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function send() {
    const tid = await tenantId();
    const token = crypto.randomUUID();
    await supabase.from("tenant_invites").insert({ tenant_id: tid, email, role, token, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
    alert(`Invite created. Share this link: ${location.origin}/#accept-invite?token=${token}`);
    setEmail(""); setRole("agent"); await load();
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Invite a teammate</CardTitle></CardHeader>
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

      <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle>Pending invites</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left"><tr><th className="p-3">Email</th><th>Role</th><th>Token</th><th>Expires</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.token} className="border-t"><td className="p-3">{r.email}</td><td>{r.role}</td><td className="text-xs">{r.token}</td><td>{new Date(r.expires_at).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}