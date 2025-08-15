import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ragSearchEnhanced, ingestWebsite } from "@/lib/rag";
import { Badge } from "@/components/ui/badge";

type Result = { chunk_id: string; source_id: string; content: string; score: number; relevance_type?: string; source?: string };

export default function KnowledgePage() {
  const [tenantId, setTenantId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searchMetadata, setSearchMetadata] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      const { data, error } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
      if (!error && data?.active_tenant_id) setTenantId(data.active_tenant_id);
      // preload sources
      const s = await supabase.from("knowledge_sources").select("*").order("created_at", { ascending: false });
      if (!s.error && s.data) setSources(s.data);
    })();
  }, []);

  async function handleIngest() {
    if (!tenantId || !url) return;
    setBusy(true);
    try {
      await ingestWebsite(tenantId, url);
      const s = await supabase.from("knowledge_sources").select("*").order("created_at", { ascending: false });
      if (!s.error && s.data) setSources(s.data);
      setUrl("");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch() {
    if (!tenantId || !query) return;
    setBusy(true);
    try {
      const res = await ragSearchEnhanced(tenantId, query, 8);
      setResults(res.results || []);
      setSearchMetadata(res);
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Knowledge (Auto‑Training)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Business website</label>
              <Input placeholder="https://example.com" value={url} onChange={(e)=> setUrl(e.target.value)} />
              <div className="text-xs text-muted-foreground mt-1">We'll crawl, chunk, embed, and add it to your per‑tenant knowledge base.</div>
            </div>
            <div className="flex items-end">
              <Button disabled={!url || busy} onClick={handleIngest} className="rounded-2xl w-full">{busy ? "Ingesting…" : "Ingest site"}</Button>
            </div>
          </div>

          <div className="pt-4 border-t">
            <label className="text-sm font-medium">Ask your knowledge base</label>
            <div className="flex gap-2">
              <Input placeholder="e.g., What are your business hours?" value={query} onChange={(e)=> setQuery(e.target.value)} />
              <Button onClick={handleSearch} disabled={!query || busy} className="rounded-2xl">
                {busy ? "Searching..." : "Search"}
              </Button>
            </div>
            {searchMetadata && (
              <div className="flex gap-2 mt-2">
                <Badge variant="outline">{searchMetadata.search_type}</Badge>
                {searchMetadata.query_expanded && <Badge variant="secondary">Query Expanded</Badge>}
                <span className="text-xs text-muted-foreground">
                  Found {results.length} results
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Recent sources</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sources.length === 0 && <div className="text-sm text-muted-foreground">No sources yet.</div>}
            {sources.map((s)=> (
              <div key={s.id} className="text-sm p-3 rounded-xl border bg-card">
                <div className="font-medium">{s.title || s.source_url}</div>
                <div className="text-xs text-muted-foreground">{s.source_type} • {new Date(s.created_at).toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Top matches</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {results.length === 0 && <div className="text-sm text-muted-foreground">Run a search to see enhanced semantic matches.</div>}
            {results.map((r, i)=> (
              <div key={r.chunk_id || i} className="p-3 rounded-xl border bg-card">
                <div className="flex justify-between items-start mb-1">
                  <div className="text-[11px] text-muted-foreground">
                    score {(r.score || 0).toFixed(3)}
                  </div>
                  <div className="flex gap-1">
                    {r.relevance_type && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {r.relevance_type}
                      </Badge>
                    )}
                    {r.source === 'quick_answer' && (
                      <Badge variant="default" className="text-[10px] px-1 py-0">
                        Quick Answer
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-sm whitespace-pre-wrap">{r.content.slice(0, 700)}{r.content.length>700 ? "…" : ""}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
