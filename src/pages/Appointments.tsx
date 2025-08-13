import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Appt = { id: string; tenant_id: string; title: string | null; customer: string | null; start: string | null; end: string | null; staff: string | null };

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function AppointmentsPage() {
  const [rows, setRows] = useState<Appt[]>([]);
  const [modal, setModal] = useState<Appt | null>(null);

  async function load() {
    const tid = await tenantId();
    const { data } = await supabase.from("appointments").select("*").eq("tenant_id", tid).order("start", { ascending: true });
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function save(a: Partial<Appt>) {
    const tid = await tenantId();
    const payload = { ...a, tenant_id: tid } as any;
    if (a.id) await supabase.from("appointments").update(payload).eq("id", a.id);
    else await supabase.from("appointments").insert(payload);
    setModal(null); await load();
  }
  async function remove(id: string) { await supabase.from("appointments").delete().eq("id", id); await load(); }

  const toLocal = (s?: string | null) => s ? new Date(s).toISOString().slice(0, 16) : "";
  const fromLocal = (s: string) => new Date(s).toISOString();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Appointments</h2>
        <Button className="rounded-2xl" onClick={() => setModal({ id: "", tenant_id: "", title: "", customer: "", start: new Date().toISOString(), end: new Date().toISOString(), staff: "" } as any)}>New</Button>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Upcoming</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left"><tr><th className="p-3">Title</th><th>Customer</th><th>Start</th><th>End</th><th>Staff</th><th className="text-right p-3">Actions</th></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id} className="border-t">
                  <td className="p-3 font-medium">{a.title}</td>
                  <td className="p-3">{a.customer}</td>
                  <td className="p-3">{a.start ? new Date(a.start).toLocaleString() : ""}</td>
                  <td className="p-3">{a.end ? new Date(a.end).toLocaleString() : ""}</td>
                  <td className="p-3">{a.staff}</td>
                  <td className="p-3 text-right">
                    <Button variant="outline" className="rounded-2xl mr-2" onClick={() => setModal(a)}>Edit</Button>
                    <Button variant="outline" className="rounded-2xl" onClick={() => remove(a.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {modal && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <Card className="w-full max-w-lg rounded-2xl shadow-xl">
            <CardHeader><CardTitle>{modal.id ? "Edit" : "New"} appointment</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Input placeholder="Title" value={modal.title || ""} onChange={e => setModal({ ...modal, title: e.target.value })} />
              <Input placeholder="Customer" value={modal.customer || ""} onChange={e => setModal({ ...modal, customer: e.target.value })} />
              <Input type="datetime-local" value={toLocal(modal.start)} onChange={e => setModal({ ...modal, start: fromLocal(e.target.value) })} />
              <Input type="datetime-local" value={toLocal(modal.end)} onChange={e => setModal({ ...modal, end: fromLocal(e.target.value) })} />
              <Input placeholder="Staff" value={modal.staff || ""} onChange={e => setModal({ ...modal, staff: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="rounded-2xl" onClick={() => setModal(null)}>Cancel</Button>
                <Button className="rounded-2xl" onClick={() => save(modal!)}>Save</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}