import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id:string; name:string };

export default function CustomerBadgeSwitcher({ customers, active, onChange }:{ customers: Customer[]; active?: string; onChange: (id:string)=>void }){
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800">Customer</div>
      <Select value={active} onValueChange={onChange}>
        <SelectTrigger className="w-56"><SelectValue placeholder="Select customer"/></SelectTrigger>
        <SelectContent>
          {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
