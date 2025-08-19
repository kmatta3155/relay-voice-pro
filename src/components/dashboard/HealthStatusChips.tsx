import React from "react";

export default function HealthStatusChips({ items }:{ items: Array<{ label:string; ok:boolean; onFix?: ()=>void }> }){
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it,i)=> (
        <button key={i} onClick={it.onFix} className={"text-xs px-2 py-1 rounded-full border " + (it.ok ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-rose-300 text-rose-700 bg-rose-50")}>
          {it.label} {it.ok ? "✓" : "• Fix"}
        </button>
      ))}
    </div>
  );
}
