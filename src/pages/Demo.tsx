// src/pages/Demo.tsx
// Simple demo page to test the AI receptionist via SMS. Enter a phone number
// and a message, and the system will send the SMS via your Twilio function.
// Replies from the AI will appear in the thread below (requires Realtime).

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
}

export default function DemoPage() {
  const [to, setTo] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [thread, setThread] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Subscribe to new messages from the database (requires Realtime enabled on sms_messages)
  useEffect(() => {
    const channel = supabase
      .channel("demo-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        (payload) => {
          const m = payload.new as any;
          // Only show messages for the current thread
          if (m.peer_phone === to || m.from_phone === to) {
            setThread((prev) => [...prev, { id: m.id, direction: m.direction, body: m.body, created_at: m.created_at }]);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [to]);

  const sendSMS = async () => {
    if (!to || !message) return;
    setLoading(true);
    const { error } = await supabase.functions.invoke("twilio-sms-send", {
      body: {
        to,
        message,
      },
    });
    setLoading(false);
    if (error) {
      alert("Failed to send: " + error.message);
    } else {
      setThread((prev) => [
        ...prev,
        { id: Date.now().toString(), direction: "outbound", body: message, created_at: new Date().toISOString() },
      ]);
      setMessage("");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Demo SMS</h1>
      <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
        <Input placeholder="Customer phone number" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input
          placeholder="Type your message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendSMS();
          }}
        />
        <Button disabled={loading} onClick={sendSMS}>
          Send
        </Button>
      </div>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-80 overflow-y-auto">
          {thread.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`rounded-lg p-2 max-w-[75%] ${m.direction === "outbound" ? "bg-primary text-white" : "bg-muted"}`}>
                <p className="text-xs opacity-60 mb-1">{new Date(m.created_at).toLocaleTimeString()}</p>
                <p>{m.body}</p>
              </div>
            </div>
          ))}
          {thread.length === 0 && <p className="text-sm text-muted-foreground">Start a conversation by sending a message.</p>}
        </CardContent>
      </Card>
    </div>
  );
}