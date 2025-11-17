import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Plus, Phone, Mail, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, parseISO } from "date-fns";

type Conv = { 
  id: string; 
  tenant_id: string; 
  contact: string; 
  channel: string; 
  created_at: string;
  last_message_at?: string;
};

type Msg = { 
  id: string; 
  thread_id: string; 
  tenant_id: string; 
  from: string; 
  text: string; 
  sent_at: string;
  direction?: string;
  body?: string;
  conversation_id?: string;
};

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
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  async function loadConvs() {
    const tid = await tenantId();
    const { data } = await supabase.from("conversations").select("*").eq("tenant_id", tid).order("created_at", { ascending: false });
    if (data) {
      setConvs(data as Conv[]);
      if (!sel && data.length) setSel(data[0].id);
    }
  }

  async function loadMsgs(cid: string) {
    const { data } = await supabase.from("messages").select("*").eq("thread_id", cid).order("sent_at", { ascending: true });
    if (data) {
      const mappedMsgs = data.map(m => ({
        ...m,
        direction: (m as any).direction || 'in',
        body: (m as any).body || m.text,
        conversation_id: (m as any).conversation_id || m.thread_id
      })) as Msg[];
      setMsgs(mappedMsgs);
      setTimeout(scrollToBottom, 100);
    }
  }

  async function send() {
    if (!sel || !text.trim()) return;
    
    const tid = await tenantId();
    await supabase.from("messages").insert({ 
      thread_id: sel,
      tenant_id: tid,
      from: "agent",
      text: text.trim(),
      sent_at: new Date().toISOString() 
    });
    setText("");
    loadMsgs(sel);
    toast({ title: "Message sent" });
  }

  async function createConv() {
    const tid = await tenantId();
    const { data, error } = await supabase.from("conversations").insert({ 
      tenant_id: tid, 
      contact: "+1 555-000-0000", 
      channel: "sms" 
    }).select().single();
    if (!error && data) { 
      setSel(data.id); 
      await loadConvs(); 
      toast({ title: "New conversation created" });
    }
  }

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { if (sel) loadMsgs(sel); }, [sel]);

  useEffect(() => {
    if (!sel) return;
    const ch = supabase.channel(`msgs-${sel}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `thread_id=eq.${sel}` },
      () => loadMsgs(sel)
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sel]);

  const filteredConvs = convs.filter(c => 
    c.contact.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedConv = convs.find(c => c.id === sel);

  const getChannelIcon = (channel: string) => {
    switch (channel?.toLowerCase()) {
      case "sms":
        return <MessageCircle className="h-4 w-4 text-green-600" />;
      case "phone":
        return <Phone className="h-4 w-4 text-blue-600" />;
      case "email":
        return <Mail className="h-4 w-4 text-purple-600" />;
      default:
        return <MessageCircle className="h-4 w-4 text-slate-600" />;
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-6" data-testid="messages-page">
      <Card className="shadow-sm border-slate-200 md:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b">
          <CardTitle className="text-lg">Conversations</CardTitle>
          <Button size="sm" className="gap-2" onClick={createConv} data-testid="button-new-conversation">
            <Plus className="h-4 w-4" />
            New
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search conversations..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-conversations"
              />
            </div>
          </div>
          
          <div className="max-h-[500px] overflow-y-auto">
            {filteredConvs.length === 0 ? (
              <div className="px-6 py-12 text-center text-slate-500 text-sm">
                {searchQuery ? "No conversations found" : "No conversations yet"}
              </div>
            ) : (
              filteredConvs.map(c => (
                <button 
                  key={c.id} 
                  onClick={() => setSel(c.id)} 
                  className={`w-full text-left px-4 py-3 border-b hover:bg-slate-50 transition-colors ${sel === c.id ? "bg-slate-100" : ""}`}
                  data-testid={`conv-${c.id}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {getChannelIcon(c.channel)}
                      <span className="text-sm font-medium text-slate-900">{c.contact}</span>
                    </div>
                    {sel === c.id && <Badge variant="default" className="text-xs">Active</Badge>}
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs capitalize">{c.channel}</Badge>
                    <span className="text-xs text-slate-500">
                      {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-slate-200 md:col-span-2">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              {selectedConv ? (
                <>
                  <CardTitle className="text-lg">{selectedConv.contact}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    {getChannelIcon(selectedConv.channel)}
                    <span className="text-sm text-slate-500 capitalize">{selectedConv.channel}</span>
                  </div>
                </>
              ) : (
                <CardTitle className="text-lg text-slate-500">Select a conversation</CardTitle>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!sel ? (
            <div className="flex flex-col items-center justify-center h-96 text-slate-500">
              <MessageCircle className="h-12 w-12 mb-3 text-slate-300" />
              <p>Select a conversation to view messages</p>
            </div>
          ) : (
            <>
              <div className="h-96 overflow-y-auto p-4 space-y-3 bg-slate-50" data-testid="messages-container">
                {msgs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <MessageCircle className="h-8 w-8 mb-2 text-slate-300" />
                    <p className="text-sm">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  msgs.map(m => {
                    const isAgent = m.from === 'agent' || m.from === 'user';
                    const msgDate = parseISO(m.sent_at);
                    
                    return (
                      <div key={m.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] ${isAgent ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                          <div className={`px-4 py-2 rounded-2xl text-sm ${
                            isAgent 
                              ? 'bg-blue-600 text-white rounded-br-sm' 
                              : 'bg-white text-slate-900 rounded-bl-sm shadow-sm border border-slate-200'
                          }`}>
                            {m.body || m.text}
                          </div>
                          <span className="text-xs text-slate-500 px-1">
                            {format(msgDate, "h:mm a")}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              
              <div className="p-4 border-t bg-white">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Type a message..." 
                    value={text} 
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                    data-testid="input-message"
                  />
                  <Button className="gap-2" onClick={send} disabled={!text.trim()} data-testid="button-send">
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
