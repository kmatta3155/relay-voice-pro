import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, MessageSquare, Search, Filter, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, parseISO } from "date-fns";

type Call = { 
  id: string; 
  tenant_id: string; 
  from: string | null; 
  to: string | null; 
  outcome: string | null; 
  duration: number | null; 
  call_at: string;
  summary: string | null;
  direction?: string | null;
  recording_url?: string | null;
  at?: string;
};

async function tenantId() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id!;
  const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  return p?.active_tenant_id as string;
}

export default function CallsPage() {
  const [rows, setRows] = useState<Call[]>([]);
  const [q, setQ] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const { toast } = useToast();

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const searchStr = `${r.from} ${r.to} ${r.outcome} ${r.summary}`.toLowerCase();
      const matchesSearch = searchStr.includes(q.toLowerCase());
      const matchesOutcome = outcomeFilter === "all" || r.outcome === outcomeFilter;
      return matchesSearch && matchesOutcome;
    });
  }, [rows, q, outcomeFilter]);

  async function load() {
    const tid = await tenantId();
    const { data } = await supabase.from("calls").select("*").eq("tenant_id", tid).order("call_at", { ascending: false });
    // Map 'at' to 'call_at' for backwards compatibility
    const mappedData = (data || []).map(call => ({
      ...call,
      call_at: call.call_at || (call as any).at
    }));
    setRows(mappedData as Call[]);
  }

  useEffect(() => {
    load();
    
    let isMounted = true;
    let callsSub: ReturnType<typeof supabase.channel> | null = null;
    
    (async () => {
      const tid = await tenantId();
      if (!isMounted) return;
      
      callsSub = supabase
        .channel('calls-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `tenant_id=eq.${tid}` }, load)
        .subscribe();
    })();
    
    return () => {
      isMounted = false;
      callsSub?.unsubscribe();
    };
  }, []);

  function exportToCSV() {
    const headers = ["From", "To", "Outcome", "Duration", "Date", "Summary"];
    const csvData = filtered.map(c => [
      c.from || "",
      c.to || "",
      c.outcome || "",
      c.duration ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : "",
      c.call_at,
      (c.summary || "").replace(/,/g, ";") // Escape commas in summary
    ]);
    
    const csv = [headers, ...csvData].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `calls-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "Calls exported successfully" });
  }

  const getOutcomeBadge = (outcome: string | null) => {
    switch (outcome?.toLowerCase()) {
      case "appointment_booked":
        return <Badge variant="default" className="bg-green-500">Booked</Badge>;
      case "inquiry":
        return <Badge variant="secondary">Inquiry</Badge>;
      case "missed":
        return <Badge variant="destructive">Missed</Badge>;
      case "voicemail":
        return <Badge variant="outline">Voicemail</Badge>;
      default:
        return <Badge variant="secondary">{outcome || "Unknown"}</Badge>;
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  return (
    <div className="space-y-6" data-testid="calls-page">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search calls..." 
              value={q} 
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-lg"
              data-testid="input-search-calls"
            />
          </div>
          
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="w-40" data-testid="select-outcome-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="All outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="appointment_booked">Booked</SelectItem>
              <SelectItem value="inquiry">Inquiry</SelectItem>
              <SelectItem value="missed">Missed</SelectItem>
              <SelectItem value="voicemail">Voicemail</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" className="gap-2" onClick={exportToCSV} data-testid="button-export">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-sm font-medium text-slate-600">
                  <th className="text-left px-6 py-4">Caller</th>
                  <th className="text-left px-6 py-4">Outcome</th>
                  <th className="text-left px-6 py-4">Duration</th>
                  <th className="text-left px-6 py-4">When</th>
                  <th className="text-left px-6 py-4">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      {q || outcomeFilter !== "all" 
                        ? "No calls match your filters" 
                        : "No call history yet. Calls will appear here once received."}
                    </td>
                  </tr>
                ) : (
                  filtered.map(c => {
                    const callDate = parseISO(c.call_at);
                    
                    return (
                      <tr 
                        key={c.id} 
                        className="hover:bg-slate-50/50 transition-colors"
                        data-testid={`row-call-${c.id}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${c.direction === 'outbound' ? 'bg-blue-50' : 'bg-green-50'}`}>
                              {c.direction === 'outbound' ? (
                                <PhoneOutgoing className="h-4 w-4 text-blue-600" />
                              ) : (
                                <PhoneIncoming className="h-4 w-4 text-green-600" />
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-slate-900">{c.from || "Unknown"}</div>
                              {c.to && <div className="text-xs text-slate-500">to {c.to}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {getOutcomeBadge(c.outcome)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span className="text-sm text-slate-600">{formatDuration(c.duration)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm text-slate-900">{format(callDate, "MMM d, h:mm a")}</span>
                            <span className="text-xs text-slate-500">{formatDistanceToNow(callDate, { addSuffix: true })}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 max-w-md">
                          {c.summary ? (
                            <div className="flex items-start gap-2">
                              <MessageSquare className="h-3 w-3 text-slate-400 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-slate-600 line-clamp-2">{c.summary}</p>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
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
            <span className="font-medium text-slate-900">{rows.length}</span> calls
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <PhoneIncoming className="h-4 w-4 text-green-600" />
              <span>{rows.filter(r => r.direction !== 'outbound').length} inbound</span>
            </div>
            <div className="flex items-center gap-2">
              <PhoneOutgoing className="h-4 w-4 text-blue-600" />
              <span>{rows.filter(r => r.direction === 'outbound').length} outbound</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
