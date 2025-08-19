import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Helpers
async function getActiveTenantId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("active_tenant_id")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) return null;
  return (data as any)?.active_tenant_id || null;
}

import MessagingToolbar from "@/components/dashboard/MessagingToolbar";

export default function MessagesPage() {
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [threads, setThreads] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Load tenant + threads
  useEffect(() => {
    (async () => {
      const t = await getActiveTenantId();
      setTenantId(t);
      if (!t) { setLoading(false); return; }
      const { data: ths, error } = await supabase
        .from("threads")
        .select("id, channel, with, updated_at")
        .eq("tenant_id", t)
        .order("updated_at", { ascending: false });
      if (!error && ths) setThreads(ths);
      setActiveId((ths && ths[0]?.id) || null);
      setLoading(false);
    })();
  }, []);

  // Load messages when activeId changes
  useEffect(() => {
    (async () => {
      if (!activeId) { setMessages([]); return; }
      const { data: msgs, error } = await supabase
        .from("messages")
        .select("id, from, text, at")
        .eq("thread_id", activeId)
        .order("at", { ascending: true });
      if (!error && msgs) setMessages(msgs);
    })();
  }, [activeId]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);

  async function send() {
    if (!tenantId || !activeThread || !text.trim()) return;
    const newMsg = { id: crypto.randomUUID(), from: "agent", text, at: new Date().toISOString() };
    // optimistic UI
    setMessages((cur) => [...cur, newMsg]);
    setThreads((cur) => cur.map((t) => t.id === activeThread.id ? { ...t, updated_at: new Date().toISOString() } : t));
    setText("");
    setSending(true);
    try {
      const { error } = await supabase
        .from("messages")
        .insert({ tenant_id: tenantId, thread_id: activeThread.id, from: "agent", text: newMsg.text, sent_at: newMsg.at });
      if (error) throw error;
      await supabase.from("threads").update({ updated_at: newMsg.at }).eq("id", activeThread.id);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto">Loading messages…</div>
      </main>
    );
  }

  if (!tenantId) {
    return (
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-semibold mb-4">Messages</h1>
          <p className="text-muted-foreground">No active workspace. Set your profile's active tenant and refresh.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Messages</h1>
        <p className="text-muted-foreground mb-6">View and respond to multi‑channel conversations.</p>
        <div className="grid grid-cols-12 gap-4">
          {/* Threads list */}
          <aside className="col-span-12 md:col-span-4 lg:col-span-3 border rounded-xl">
            <div className="px-3 py-2 border-b font-medium">Threads</div>
            <ul className="max-h-[65vh] overflow-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted ${activeId === t.id ? "bg-muted" : ""}`}
                  >
                    <div className="text-sm font-medium">{t.with}</div>
                    <div className="text-xs text-muted-foreground">{t.channel} · {new Date(t.updated_at).toLocaleString()}</div>
                  </button>
                </li>
              ))}
              {threads.length === 0 && (
                <li className="px-3 py-4 text-sm text-muted-foreground">No conversations yet.</li>
              )}
            </ul>
          </aside>

          {/* Conversation */}
          <section className="col-span-12 md:col-span-8 lg:col-span-9 border rounded-xl flex flex-col">
            <div className="px-4 py-3 border-b">
              <div className="font-medium">{activeThread ? activeThread.with : "Select a thread"}</div>
              <div className="text-xs text-muted-foreground">{activeThread?.channel || ""}</div>
            </div>
            <div className="flex-1 p-4 overflow-auto space-y-3">
              {activeThread ? (
                messages.map((m) => (
                  <div key={m.id} className="">
                    <div className="text-xs text-muted-foreground">{m.from} · {new Date(m.at).toLocaleString()}</div>
                    <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">Pick a thread to view messages.</div>
              )}
            </div>
            <div className="px-4 py-3 border-t flex items-center gap-2">
              <input
                className="flex-1 border rounded-xl px-3 py-2"
                placeholder={activeThread ? "Type a message" : "Select a thread first"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={!activeThread || sending}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              />
              <button
                className="px-4 py-2 rounded-xl border"
                onClick={send}
                disabled={!activeThread || sending || !text.trim()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
