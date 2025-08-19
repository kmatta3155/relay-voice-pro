import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type StageCount = { stage: string; count: number };

export default function LeadsMiniPipeline({ data }:{ data: StageCount[] }){
  const total = data.reduce((a,b)=>a+b.count,0) || 1;
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Leads Pipeline</CardTitle></CardHeader>
      <CardContent>
        <div className="flex gap-2 items-end h-20">
          {data.map((s)=> (
            <div key={s.stage} className="flex-1 bg-gradient-to-t from-zinc-200 to-zinc-100 dark:from-zinc-800 dark:to-zinc-700 rounded-lg relative" style={{ height: `${Math.max(8, (s.count/total)*80)}px` }}>
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap">{s.stage} • {s.count}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
