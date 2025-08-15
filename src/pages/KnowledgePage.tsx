import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ragSearchEnhanced, ingestWebsite } from "@/lib/rag";
import { Badge } from "@/components/ui/badge";
import { Clock, Phone, MapPin, Mail, Star, Zap, CheckCircle, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

type Result = { chunk_id: string; source_id: string; content: string; score: number; relevance_type?: string; source?: string };

export default function KnowledgePage() {
  const [tenantId, setTenantId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searchMetadata, setSearchMetadata] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [businessInfo, setBusinessInfo] = useState<any>({});
  const [quickAnswers, setQuickAnswers] = useState<any[]>([]);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("ingestion");

  useEffect(() => {
    (async () => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      const { data, error } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
      if (!error && data?.active_tenant_id) {
        setTenantId(data.active_tenant_id);
        
        // Load sources
        const s = await supabase.from("knowledge_sources").select("*").order("created_at", { ascending: false });
        if (!s.error && s.data) {
          setSources(s.data);
          // Extract business info from latest source
          const latestSource = s.data[0];
          if (latestSource?.meta && typeof latestSource.meta === 'object' && !Array.isArray(latestSource.meta) && 'business_info' in latestSource.meta) {
            setBusinessInfo(latestSource.meta.business_info);
          }
        }
        
        // Load quick answers
        const qa = await supabase.from("business_quick_answers").select("*").eq("tenant_id", data.active_tenant_id);
        if (!qa.error && qa.data) setQuickAnswers(qa.data);
      }
    })();
  }, []);

  async function handleIngest() {
    if (!tenantId || !url) return;
    setBusy(true);
    setExtractionProgress(0);
    
    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setExtractionProgress(prev => Math.min(prev + 10, 90));
      }, 500);
      
      const result = await ingestWebsite(tenantId, url);
      clearInterval(progressInterval);
      setExtractionProgress(100);
      
      // If the function returned business info, use it immediately and jump to the Business Intelligence tab
      if (result?.business_info) {
        setBusinessInfo(result.business_info);
        setActiveTab("business-info");
      }
      
      // Reload sources list (and fallback to latest source's business_info if needed)
      const s = await supabase.from("knowledge_sources").select("*").order("created_at", { ascending: false });
      if (!s.error && s.data) {
        setSources(s.data);
        if (!result?.business_info) {
          const latestSource = s.data[0];
          if (latestSource?.meta && typeof latestSource.meta === 'object' && !Array.isArray(latestSource.meta) && 'business_info' in latestSource.meta) {
            setBusinessInfo(latestSource.meta.business_info);
            setActiveTab("business-info");
          }
        }
      }
      
      // Reload quick answers
      const qa = await supabase.from("business_quick_answers").select("*").eq("tenant_id", tenantId);
      if (!qa.error && qa.data) setQuickAnswers(qa.data);
      
      setUrl("");
      setTimeout(() => setExtractionProgress(0), 2000);
    } catch (e) {
      setExtractionProgress(0);
      console.error("Ingestion failed:", e);
      const errorMessage = e instanceof Error ? e.message : "Failed to ingest website";
      alert(`Ingestion failed: ${errorMessage}`);
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

  const businessInfoCards = [
    { icon: Clock, label: "Business Hours", value: businessInfo.business_hours?.map((h: any) => `${h.day}: ${h.hours}`).join(", ") || "Not extracted" },
    { icon: Phone, label: "Phone", value: businessInfo.phone || "Not extracted" },
    { icon: Mail, label: "Email", value: businessInfo.email || "Not extracted" },
    { icon: MapPin, label: "Address", value: businessInfo.address || "Not extracted" },
  ];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Zap className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          AI Knowledge Management
        </h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ingestion">Website Ingestion</TabsTrigger>
          <TabsTrigger value="business-info">Business Intelligence</TabsTrigger>
          <TabsTrigger value="search">Knowledge Search</TabsTrigger>
        </TabsList>

        <TabsContent value="ingestion" className="space-y-6">
          <Card className="rounded-2xl shadow-sm border-2 border-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-primary" />
                AI-Powered Website Ingestion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Business Website URL
                  </label>
                  <Input 
                    placeholder="https://example.com" 
                    value={url} 
                    onChange={(e)=> setUrl(e.target.value)}
                    className="mt-1"
                  />
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    AI extracts business hours, services, contact info, and creates smart knowledge chunks
                  </div>
                </div>
                <div className="flex items-end">
                  <Button 
                    disabled={!url || busy} 
                    onClick={handleIngest} 
                    className="rounded-2xl w-full bg-gradient-to-r from-primary to-accent hover:opacity-90"
                  >
                    {busy ? "AI Processing..." : "Analyze & Ingest"}
                  </Button>
                </div>
              </div>

              {extractionProgress > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-primary animate-pulse" />
                    AI extracting business intelligence...
                  </div>
                  <Progress value={extractionProgress} className="h-2" />
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4 pt-4">
                <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
                  <h3 className="font-semibold text-sm mb-2">Recent Sources</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {sources.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No sources yet</div>
                    ) : (
                      sources.slice(0, 3).map((s) => (
                        <div key={s.id} className="text-sm p-2 rounded-lg bg-white/60 dark:bg-gray-800/60">
                          <div className="font-medium truncate">{s.title || s.source_url}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {s.meta?.crawl_method === 'firecrawl' ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertCircle className="h-3 w-3 text-orange-500" />
                            )}
                            {s.meta?.crawl_method || 'basic'} • {new Date(s.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
                  <h3 className="font-semibold text-sm mb-2">Quick Answers Created</h3>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {quickAnswers.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No quick answers yet</div>
                    ) : (
                      quickAnswers.map((qa, i) => (
                        <div key={i} className="text-xs p-2 rounded bg-white/60 dark:bg-gray-800/60">
                          <Badge variant="outline" className="text-[10px]">{qa.question_type}</Badge>
                          <div className="mt-1 text-muted-foreground truncate">{qa.answer}</div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="business-info" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {businessInfoCards.map((item, i) => (
              <Card key={i} className="rounded-2xl shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <item.icon className="h-5 w-5 text-primary mt-1" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm">{item.label}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.value === "Not extracted" ? (
                          <span className="text-orange-500">Not extracted</span>
                        ) : (
                          item.value
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {businessInfo.services?.length > 0 && (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Services Offered</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {businessInfo.services.map((service: string, i: number) => (
                    <Badge key={i} variant="secondary" className="px-3 py-1">
                      {service}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {businessInfo.about && (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">About Business</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{businessInfo.about}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="search" className="space-y-6">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Intelligent Knowledge Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input 
                  placeholder="e.g., What are your business hours?" 
                  value={query} 
                  onChange={(e)=> setQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !busy && query && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={!query || busy} className="rounded-2xl">
                  {busy ? "Searching..." : "Search"}
                </Button>
              </div>
              
              {searchMetadata && (
                <div className="flex gap-2 items-center">
                  <Badge variant="outline">{searchMetadata.search_type}</Badge>
                  {searchMetadata.query_expanded && <Badge variant="secondary">Query Expanded</Badge>}
                  <span className="text-xs text-muted-foreground">
                    Found {results.length} results
                  </span>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Zap className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Run a search to see intelligent knowledge matches</p>
                  </div>
                ) : (
                  results.map((r, i) => (
                    <div key={r.chunk_id || i} className="p-4 rounded-xl border bg-card hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-xs text-muted-foreground">
                          Confidence: {(r.score || 0).toFixed(3)}
                        </div>
                        <div className="flex gap-1">
                          {r.relevance_type && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {r.relevance_type}
                            </Badge>
                          )}
                          {r.source === 'quick_answer' && (
                            <Badge variant="default" className="text-[10px] px-1 py-0">
                              <Star className="h-2 w-2 mr-1" />
                              Quick Answer
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{r.content.slice(0, 700)}{r.content.length > 700 ? "…" : ""}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
