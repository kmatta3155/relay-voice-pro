import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Props = {
  title: string;
  value: string | number;
  hint?: string;
  trend?: React.ReactNode;
};

export default function KPICard({ title, value, hint, trend }: Props){
  return (
    <Card className="rounded-2xl border-0 bg-white/60 backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.35)] dark:bg-zinc-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl md:text-4xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
        {trend && <div className="mt-2">{trend}</div>}
      </CardContent>
    </Card>
  );
}
