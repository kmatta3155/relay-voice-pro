import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tenant = { id:string; name:string };

export default function TenantBadgeSwitcher({ tenants, active, onChange }:{ tenants: Tenant[]; active?: string; onChange: (id:string)=>void }){
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800">Tenant</div>
      <Select value={active} onValueChange={onChange}>
        <SelectTrigger className="w-56"><SelectValue placeholder="Select tenant"/></SelectTrigger>
        <SelectContent>
          {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
