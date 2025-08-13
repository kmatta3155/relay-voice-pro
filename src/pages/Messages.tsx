import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Conv = { id: string; tenant_id: string; contact: string; channel: "sms" | "web" | "whatsapp"; created_at: string };
type Msg = { id: string; conversation_id: string; direction: "in" | "out"; body: string; sent_at: string };

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function MessagesPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");

  async function loadConvs() {
    const tid = await tenantId();
    const { data } = await supabase.from("conversations").select("*").eq("tenant_id", tid).order("created_at", { ascending: false });
    setConvs(data || []);
    if (!sel && data?.length) setSel(data[0].id);
  }
  async function loadMsgs(cid: string) {
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", cid).order("sent_at", { ascending: true });
    setMsgs(data || []);
  }
  async function send() {
    if (!sel || !text.trim()) return;
    await supabase.from("messages").insert({ conversation_id: sel, direction: "out", body: text, sent_at: new Date().toISOString() });
    setText("");
  }
  async function createConv() {
    const tid = await tenantId();
    const { data, error } = await supabase.from("conversations").insert({ tenant_id: tid, contact: "+1 555-000-0000", channel: "sms" }).select().single();
    if (!error && data) { setSel(data.id); await loadConvs(); }
  }

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { if (sel) loadMsgs(sel); }, [sel]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!sel) return;
    const ch = supabase.channel(`msgs-${sel}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${sel}` },
      () => loadMsgs(sel)
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sel]);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="rounded-2xl shadow-sm md:col-span-1">
        <CardHeader className="flex items-center justify-between"><CardTitle>Conversations</CardTitle>
          <Button className="rounded-2xl" onClick={createConv}>New</Button></CardHeader>
        <CardContent className="p-0">
          {convs.map(c => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`w-full text-left px-4 py-3 border-t hover:bg-slate-50 ${sel === c.id ? "bg-slate-100" : ""}`}>
              <div className="text-sm font-medium">{c.contact}</div>
              <div className="text-xs text-slate-500">{c.channel} • {new Date(c.created_at).toLocaleString()}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm md:col-span-2">
        <CardHeader><CardTitle>Thread</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64 overflow-auto space-y-2">
            {msgs.map(m => (
              <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-3 py-2 rounded-xl text-sm ${m.direction === 'out' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{m.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input placeholder="Type a message" value={text} onChange={e => setText(e.target.value)} />
            <Button className="rounded-2xl" onClick={send}>Send</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}