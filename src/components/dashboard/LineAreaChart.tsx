import React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Props = {
  data: Array<{ date: string; value: number }>;
  gradientId?: string;
  animated?: boolean;
  tooltipLabel?: string;
};

// Animated stroke & point glow via CSS keyframes
const styles = `
@keyframes pulseStroke { 0% { stroke-width:2 } 50% { stroke-width:3 } 100% { stroke-width:2 } }
@keyframes glow { 0% { filter: drop-shadow(0 0 0 rgba(59,130,246,.0)); } 50% { filter: drop-shadow(0 0 6px rgba(59,130,246,.5)); } 100% { filter: drop-shadow(0 0 0 rgba(59,130,246,.0)); } }
`;

export default function LineAreaChart({ data, gradientId="chartGrad", animated=true, tooltipLabel="" }: Props){
  return (
    <div className="h-56 w-full">
      <style>{styles}</style>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--tw-gradient-from,#3b82f6)" stopOpacity={0.35}/>
              <stop offset="100%" stopColor="var(--tw-gradient-to,#8b5cf6)" stopOpacity={0.02}/>
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25}/>
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={40} />
          <Tooltip
            contentStyle={{
              background: "linear-gradient(180deg, rgba(24,24,27,.95), rgba(24,24,27,.85))",
              border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 12,
              color: "white",
              boxShadow: "0 12px 30px rgba(0,0,0,.35)"
            }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(v)=>[v as number, tooltipLabel || "Value"]}
          />
          <Area type="monotone" dataKey="value" stroke="var(--tw-gradient-from,#3b82f6)" fill={`url(#${gradientId})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
