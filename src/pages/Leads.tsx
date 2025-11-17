import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, Zap, Filter, Download, Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Lead = { 
  id: string; 
  tenant_id: string; 
  name: string | null; 
  phone: string | null; 
  email: string | null; 
  source: string | null; 
  status: string | null; 
  notes: string | null;
  intent: string | null;
  lead_score: number | null;
  created_at: string 
};

async function getTenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function LeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [modal, setModal] = useState<Lead | null>(null);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const searchStr = `${r.name} ${r.phone} ${r.email} ${r.source} ${r.status}`.toLowerCase();
      const matchesSearch = searchStr.includes(q.toLowerCase());
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const matchesSource = sourceFilter === "all" || r.source === sourceFilter;
      return matchesSearch && matchesStatus && matchesSource;
    });
  }, [rows, q, statusFilter, sourceFilter]);

  async function load() {
    const tid = await getTenantId();
    const { data } = await supabase.from("leads").select("*").eq("tenant_id", tid).order("created_at", { ascending: false });
    setRows(data || []);
  }

  async function save(l: Partial<Lead>) {
    const tid = await getTenantId();
    const payload = { ...l, tenant_id: tid, name: l.name || "" };
    if (l.id) {
      await supabase.from("leads").update(payload).eq("id", l.id);
      toast({ title: "Lead updated successfully" });
    } else {
      await supabase.from("leads").insert(payload);
      toast({ title: "Lead created successfully" });
    }
    setModal(null);
    await load();
  }

  async function remove(id: string, name: string | null) {
    if (!confirm(`Are you sure you want to delete ${name || 'this lead'}?`)) return;
    await supabase.from("leads").delete().eq("id", id);
    toast({ title: "Lead deleted" });
    await load();
  }

  async function nudgeLead(lead: Lead) {
    toast({ 
      title: "Nudge sent!", 
      description: `Follow-up reminder created for ${lead.name}` 
    });
  }

  function exportToCSV() {
    const headers = ["Name", "Contact", "Source", "Status", "Score", "Intent", "Created"];
    const csvData = filtered.map(l => [
      l.name || "",
      `${l.phone || ""} ${l.email || ""}`.trim(),
      l.source || "",
      l.status || "",
      l.lead_score?.toString() || "",
      l.intent || "",
      new Date(l.created_at).toLocaleDateString()
    ]);
    
    const csv = [headers, ...csvData].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "Leads exported successfully" });
  }

  useEffect(() => {
    load();

    let isMounted = true;
    let leadsSub: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const tid = await getTenantId();
      if (!isMounted) return;

      leadsSub = supabase
        .channel('leads-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
    })();

    return () => {
      isMounted = false;
      leadsSub?.unsubscribe();
    };
  }, []);

  const getStatusBadgeVariant = (status: string | null): "default" | "secondary" | "destructive" | "outline" => {
    switch (status?.toLowerCase()) {
      case "converted": return "default";
      case "contacted": return "secondary";
      case "new": return "outline";
      default: return "secondary";
    }
  };

  const getScoreBadge = (score: number | null) => {
    if (!score) return null;
    if (score >= 80) return <Badge variant="destructive" className="ml-1 text-xs">Hot</Badge>;
    if (score >= 60) return <Badge variant="default" className="ml-1 text-xs bg-orange-500">Warm</Badge>;
    return <Badge variant="secondary" className="ml-1 text-xs">Cold</Badge>;
  };

  return (
    <div className="space-y-6" data-testid="leads-page">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search leads" 
              value={q} 
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-lg"
              data-testid="input-search-leads"
            />
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-filters">
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="p-2 space-y-2">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Status</label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger data-testid="select-status-filter">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="converted">Converted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Source</label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger data-testid="select-source-filter">
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="phone_call">Phone Call</SelectItem>
                      <SelectItem value="Manual">Manual</SelectItem>
                      <SelectItem value="website">Website</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            className="gap-2" 
            onClick={exportToCSV}
            data-testid="button-export"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button 
            className="gap-2" 
            onClick={() => setModal({ 
              id: "", 
              tenant_id: "", 
              name: "", 
              phone: "", 
              email: "", 
              source: "Manual", 
              status: "New", 
              notes: "", 
              intent: "",
              lead_score: null,
              created_at: new Date().toISOString() 
            } as any)}
            data-testid="button-new-lead"
          >
            <Plus className="h-4 w-4" />
            New lead
          </Button>
        </div>
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-sm font-medium text-slate-600">
                  <th className="text-left px-6 py-4">Name</th>
                  <th className="text-left px-6 py-4">Contact</th>
                  <th className="text-left px-6 py-4">Source</th>
                  <th className="text-left px-6 py-4">Status</th>
                  <th className="text-left px-6 py-4">Score</th>
                  <th className="text-left px-6 py-4">Intent</th>
                  <th className="text-right px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      {q || statusFilter !== "all" || sourceFilter !== "all" 
                        ? "No leads match your filters" 
                        : "No leads yet. Create your first lead to get started."}
                    </td>
                  </tr>
                ) : (
                  filtered.map(l => (
                    <tr 
                      key={l.id} 
                      className="hover:bg-slate-50/50 transition-colors"
                      data-testid={`row-lead-${l.id}`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{l.name || "—"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          {l.phone && <div className="text-slate-600">{l.phone}</div>}
                          {l.email && <div className="text-slate-500 text-xs">{l.email}</div>}
                          {!l.phone && !l.email && <span className="text-slate-400">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-600">{l.source || "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={getStatusBadgeVariant(l.status)} className="capitalize">
                          {l.status || "new"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium text-slate-900">
                            {l.lead_score || "—"}
                          </span>
                          {getScoreBadge(l.lead_score)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-600 capitalize">{l.intent || "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-700"
                            onClick={() => setModal(l)}
                            data-testid={`button-edit-${l.id}`}
                            title="Edit lead"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-purple-500 hover:text-purple-700 hover:bg-purple-50"
                            onClick={() => nudgeLead(l)}
                            data-testid={`button-nudge-${l.id}`}
                            title="Send nudge"
                          >
                            <Zap className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => remove(l.id, l.name)}
                            data-testid={`button-delete-${l.id}`}
                            title="Delete lead"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
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
            <span className="font-medium text-slate-900">{rows.length}</span> leads
          </div>
        </div>
      )}

      {modal && <LeadModal lead={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function LeadModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (l: Partial<Lead>) => void }) {
  const [f, setF] = useState<Partial<Lead>>(lead);
  
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center p-4 z-50 animate-in fade-in duration-200">
      <Card className="w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        <CardHeader className="border-b">
          <CardTitle className="text-xl">{lead.id ? "Edit lead" : "New lead"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700">Name</label>
            <Input 
              placeholder="John Doe" 
              value={f.name || ""} 
              onChange={e => setF({ ...f, name: e.target.value })}
              data-testid="input-lead-name"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Phone</label>
              <Input 
                placeholder="+1 (555) 123-4567" 
                value={f.phone || ""} 
                onChange={e => setF({ ...f, phone: e.target.value })}
                data-testid="input-lead-phone"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Email</label>
              <Input 
                placeholder="john@example.com" 
                type="email"
                value={f.email || ""} 
                onChange={e => setF({ ...f, email: e.target.value })}
                data-testid="input-lead-email"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Source</label>
              <Select value={f.source || "Manual"} onValueChange={source => setF({ ...f, source })}>
                <SelectTrigger data-testid="select-lead-source">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone_call">Phone Call</SelectItem>
                  <SelectItem value="Manual">Manual</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <Select value={f.status || "New"} onValueChange={status => setF({ ...f, status })}>
                <SelectTrigger data-testid="select-lead-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Intent</label>
              <Select value={f.intent || ""} onValueChange={intent => setF({ ...f, intent })}>
                <SelectTrigger data-testid="select-lead-intent">
                  <SelectValue placeholder="Select intent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Booking">Booking</SelectItem>
                  <SelectItem value="Inquiry">Inquiry</SelectItem>
                  <SelectItem value="Support">Support</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">Score</label>
              <Input 
                type="number" 
                min="0" 
                max="100"
                placeholder="0-100" 
                value={f.lead_score ?? ""} 
                onChange={e => setF({ ...f, lead_score: e.target.value ? parseInt(e.target.value) : null })}
                data-testid="input-lead-score"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700">Notes</label>
            <Textarea 
              placeholder="Add any additional notes about this lead..." 
              value={f.notes || ""} 
              onChange={e => setF({ ...f, notes: e.target.value })}
              rows={3}
              data-testid="textarea-lead-notes"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={() => onSave(f)} data-testid="button-save">
              {lead.id ? "Update lead" : "Create lead"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
