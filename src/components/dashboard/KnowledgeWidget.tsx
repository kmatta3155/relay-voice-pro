import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function KnowledgeWidget({ lastRun, coverage }:{ lastRun: string | null; coverage: number | null }){
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Knowledge Status</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">Last ingest: {lastRun ?? "—"}</div>
        <div className="text-sm">Coverage: {coverage != null ? `${Math.round(coverage*100)}%` : "—"}</div>
        <Button size="sm" onClick={()=> window.location.hash = "#admin/knowledge"}>Retrain</Button>
      </CardContent>
    </Card>
  )
}
