import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Calendar, Clock, User, Plus, Search, Filter, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isToday, isTomorrow, isPast } from "date-fns";

type Appt = { 
  id: string; 
  tenant_id: string; 
  title: string | null; 
  customer: string | null; 
  start_at: string; 
  end_at: string; 
  staff: string | null;
  status?: string | null;
  service?: string | null;
  start?: string;
  end?: string;
};

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function AppointmentsPage() {
  const [rows, setRows] = useState<Appt[]>([]);
  const [modal, setModal] = useState<Appt | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const searchStr = `${r.customer} ${r.title} ${r.service} ${r.staff}`.toLowerCase();
      const matchesSearch = searchStr.includes(q.toLowerCase());
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, q, statusFilter]);

  async function load() {
    const tid = await tenantId();
    const { data } = await supabase.from("appointments").select("*").eq("tenant_id", tid).order("start_at", { ascending: true });
    setRows(data || []);
  }

  useEffect(() => {
    load();
    
    let isMounted = true;
    let apptsSub: ReturnType<typeof supabase.channel> | null = null;
    
    (async () => {
      const tid = await tenantId();
      if (!isMounted) return;
      
      apptsSub = supabase
        .channel('appointments-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
    })();
    
    return () => {
      isMounted = false;
      apptsSub?.unsubscribe();
    };
  }, []);

  async function save(a: Partial<Appt>) {
    const tid = await tenantId();
    const payload = { ...a, tenant_id: tid } as any;
    if (a.id) {
      await supabase.from("appointments").update(payload).eq("id", a.id);
      toast({ title: "Appointment updated successfully" });
    } else {
      await supabase.from("appointments").insert(payload);
      toast({ title: "Appointment created successfully" });
    }
    setModal(null);
    await load();
  }

  async function remove(id: string, customer: string | null) {
    if (!confirm(`Delete appointment for ${customer || 'this customer'}?`)) return;
    await supabase.from("appointments").delete().eq("id", id);
    toast({ title: "Appointment deleted" });
    await load();
  }

  function exportToCSV() {
    const headers = ["Customer", "Service", "Start", "End", "Staff", "Status"];
    const csvData = filtered.map(a => [
      a.customer || "",
      a.service || a.title || "",
      a.start_at,
      a.end_at,
      a.staff || "",
      a.status || "scheduled"
    ]);
    
    const csv = [headers, ...csvData].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `appointments-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "Appointments exported successfully" });
  }

  const toLocal = (s?: string | null) => s ? new Date(s).toISOString().slice(0, 16) : "";
  const fromLocal = (s: string) => new Date(s).toISOString();

  const getStatusBadge = (appt: Appt) => {
    if (appt.status === 'cancelled') return <Badge variant="destructive">Cancelled</Badge>;
    if (appt.status === 'completed') return <Badge variant="secondary">Completed</Badge>;
    if (isPast(parseISO(appt.start_at))) return <Badge variant="outline" className="text-red-600 border-red-300">Missed</Badge>;
    if (isToday(parseISO(appt.start_at))) return <Badge variant="default">Today</Badge>;
    if (isTomorrow(parseISO(appt.start_at))) return <Badge className="bg-blue-500">Tomorrow</Badge>;
    return <Badge variant="outline">Scheduled</Badge>;
  };

  const getTimeLabel = (start: string) => {
    const date = parseISO(start);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "MMM d");
  };

  return (
    <div className="space-y-6" data-testid="appointments-page">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search appointments..." 
              value={q} 
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-lg"
              data-testid="input-search-appointments"
            />
          </div>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="select-status-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportToCSV} data-testid="button-export">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button 
            className="gap-2" 
            onClick={() => setModal({ 
              id: "", 
              tenant_id: "", 
              title: "", 
              customer: "", 
              start_at: new Date().toISOString(), 
              end_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), 
              staff: "",
              status: "scheduled",
              service: ""
            } as any)}
            data-testid="button-new-appointment"
          >
            <Plus className="h-4 w-4" />
            New appointment
          </Button>
        </div>
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-sm font-medium text-slate-600">
                  <th className="text-left px-6 py-4">Customer</th>
                  <th className="text-left px-6 py-4">Service</th>
                  <th className="text-left px-6 py-4">Date & Time</th>
                  <th className="text-left px-6 py-4">Duration</th>
                  <th className="text-left px-6 py-4">Staff</th>
                  <th className="text-left px-6 py-4">Status</th>
                  <th className="text-right px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      {q || statusFilter !== "all" 
                        ? "No appointments match your filters" 
                        : "No appointments scheduled. Create your first appointment to get started."}
                    </td>
                  </tr>
                ) : (
                  filtered.map(a => {
                    const startDate = parseISO(a.start_at);
                    const endDate = parseISO(a.end_at);
                    const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
                    
                    return (
                      <tr 
                        key={a.id} 
                        className="hover:bg-slate-50/50 transition-colors"
                        data-testid={`row-appointment-${a.id}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-slate-400" />
                            <span className="font-medium text-slate-900">{a.customer || "—"}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600">{a.service || a.title || "—"}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-3 w-3 text-slate-400" />
                              <span className="text-sm text-slate-900">{getTimeLabel(a.start_at)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3 w-3 text-slate-400" />
                              <span className="text-xs text-slate-500">{format(startDate, "h:mm a")}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600">{durationMinutes} min</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600">{a.staff || "—"}</span>
                        </td>
                        <td className="px-6 py-4">
                          {getStatusBadge(a)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:text-slate-700"
                              onClick={() => setModal(a)}
                              data-testid={`button-edit-${a.id}`}
                              title="Edit appointment"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => remove(a.id, a.customer)}
                              data-testid={`button-delete-${a.id}`}
                              title="Delete appointment"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <div>
            Showing <span className="font-medium text-slate-900">{filtered.length}</span> of{" "}
            <span className="font-medium text-slate-900">{rows.length}</span> appointments
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center p-4 z-50 animate-in fade-in duration-200">
          <Card className="w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
            <CardHeader className="border-b">
              <CardTitle className="text-xl">{modal.id ? "Edit appointment" : "New appointment"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Customer Name</label>
                <Input 
                  placeholder="John Doe" 
                  value={modal.customer || ""} 
                  onChange={e => setModal({ ...modal, customer: e.target.value })}
                  data-testid="input-customer"
                />
              </div>
              
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Service</label>
                <Input 
                  placeholder="Haircut, Consultation, etc." 
                  value={modal.service || modal.title || ""} 
                  onChange={e => setModal({ ...modal, service: e.target.value, title: e.target.value })}
                  data-testid="input-service"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700">Start Time</label>
                  <Input 
                    type="datetime-local" 
                    value={toLocal(modal.start_at)} 
                    onChange={e => setModal({ ...modal, start_at: fromLocal(e.target.value) })}
                    data-testid="input-start-time"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700">End Time</label>
                  <Input 
                    type="datetime-local" 
                    value={toLocal(modal.end_at)} 
                    onChange={e => setModal({ ...modal, end_at: fromLocal(e.target.value) })}
                    data-testid="input-end-time"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700">Staff Member</label>
                  <Input 
                    placeholder="Staff name" 
                    value={modal.staff || ""} 
                    onChange={e => setModal({ ...modal, staff: e.target.value })}
                    data-testid="input-staff"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-700">Status</label>
                  <Select value={modal.status || "scheduled"} onValueChange={status => setModal({ ...modal, status })}>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setModal(null)} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button onClick={() => save(modal!)} data-testid="button-save">
                  {modal.id ? "Update appointment" : "Create appointment"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
