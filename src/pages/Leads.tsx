import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Lead = { id:string; tenant_id:string; name:string|null; phone:string|null; email:string|null; source:string|null; status:string|null; notes:string|null; created_at:string };

async function getTenantId(){
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function LeadsPage(){
  const [rows, setRows] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<Lead|null>(null);
  const filtered = useMemo(()=> rows.filter(r=>{
    const s = `${r.name} ${r.phone} ${r.email} ${r.source} ${r.status}`.toLowerCase();
    return s.includes(q.toLowerCase());
  }), [rows, q]);

  async function load(){
    const tid = await getTenantId();
    const { data } = await supabase.from("leads").select("*").eq("tenant_id", tid).order("created_at", { ascending:false });
    setRows(data || []);
  }

  async function save(l: Partial<Lead>){
    const tid = await getTenantId();
    const payload = { ...l, tenant_id: tid };
    if (l.id) await supabase.from("leads").update(payload).eq("id", l.id);
    else await supabase.from("leads").insert(payload);
    setModal(null); await load();
  }

  async function remove(id: string){
    await supabase.from("leads").delete().eq("id", id);
    await load();
  }

  useEffect(()=> { load(); },[]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input placeholder="Search leads" value={q} onChange={(e)=> setQ(e.target.value)} />
        </div>
        <Button className="rounded-2xl" onClick={()=> setModal({ id:"", tenant_id:"", name:"", phone:"", email:"", source:"Manual", status:"New", notes:"", created_at:new Date().toISOString() } as any)}>New lead</Button>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Leads</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left"><tr><th className="p-3">Name</th><th>Contact</th><th>Source</th><th>Status</th><th className="text-right p-3">Actions</th></tr></thead>
            <tbody>
              {filtered.map(l=> (
                <tr key={l.id} className="border-t">
                  <td className="p-3 font-medium">{l.name}</td>
                  <td className="p-3 text-slate-600">{l.phone}<br/>{l.email}</td>
                  <td className="p-3">{l.source}</td>
                  <td className="p-3">{l.status}</td>
                  <td className="p-3 text-right">
                    <Button variant="outline" className="rounded-2xl mr-2" onClick={()=> setModal(l)}>Edit</Button>
                    <Button variant="outline" className="rounded-2xl" onClick={()=> remove(l.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {modal && <LeadModal lead={modal} onClose={()=> setModal(null)} onSave={save} />}
    </div>
  );
}

function LeadModal({ lead, onClose, onSave }:{ lead: Lead; onClose:()=>void; onSave:(l:Partial<Lead>)=>void }){
  const [f, setF] = useState<Partial<Lead>>(lead);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <Card className="w-full max-w-lg rounded-2xl shadow-xl">
        <CardHeader><CardTitle>{lead.id? "Edit lead":"New lead"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Input placeholder="Name" value={f.name||""} onChange={e=> setF({...f, name:e.target.value})}/>
          <Input placeholder="Phone" value={f.phone||""} onChange={e=> setF({...f, phone:e.target.value})}/>
          <Input placeholder="Email" value={f.email||""} onChange={e=> setF({...f, email:e.target.value})}/>
          <Input placeholder="Source" value={f.source||""} onChange={e=> setF({...f, source:e.target.value})}/>
          <Input placeholder="Status" value={f.status||""} onChange={e=> setF({...f, status:e.target.value})}/>
          <Textarea placeholder="Notes" value={f.notes||""} onChange={e=> setF({...f, notes:e.target.value})}/>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={onClose}>Cancel</Button>
            <Button className="rounded-2xl" onClick={()=> onSave(f)}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
