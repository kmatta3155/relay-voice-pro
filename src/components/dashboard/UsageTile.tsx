import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function UsageTile({ minutes, sms, onManage }:{ minutes:number; sms:number; onManage:()=>void }){
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Usage & Billing</CardTitle></CardHeader>
      <CardContent className="flex items-center justify-between">
        <div className="text-sm">Minutes: {minutes} • SMS: {sms}</div>
        <Button size="sm" variant="secondary" onClick={onManage}>Manage billing</Button>
      </CardContent>
    </Card>
  );
}
