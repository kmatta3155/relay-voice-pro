import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Summary = {
  bullets: string[];
  highlights?: string[];
  csat?: number | null;
};

export default function ConversationIQCard({ summary, callId }:{ summary: Summary; callId: string }){
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-zinc-600 dark:text-zinc-300">Conversation IQ</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="text-sm list-disc ml-4 space-y-1">
          {summary.bullets.map((b,i)=> <li key={i}>{b}</li>)}
        </ul>
        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-zinc-500">CSAT: {summary.csat ?? "—"}</div>
          <Button size="sm" variant="secondary" onClick={()=> window.location.hash = `#conversation/${callId}`}>View full transcript</Button>
        </div>
      </CardContent>
    </Card>
  )
}
