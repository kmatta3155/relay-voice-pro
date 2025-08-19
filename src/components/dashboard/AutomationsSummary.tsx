import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type Row = { key: string; label: string; enabled: boolean; onToggle?: (v:boolean)=>void };

export default function AutomationsSummary({ rows }:{ rows: Row[] }){
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Automations</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between text-sm">
            <div>{r.label}</div>
            <Switch checked={r.enabled} onCheckedChange={r.onToggle}/>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
