import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, Clock, Phone, MapPin, Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ingestWebsite } from "@/lib/rag";

function KnowledgeShowcase() {
  const [url, setUrl] = useState("https://example.com");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const DEMO_TENANT_ID =
    import.meta.env.VITE_DEMO_TENANT_ID ||
    "00000000-0000-0000-0000-000000000000";

  async function runDemo() {
    if (!url || running) return;
    setRunning(true);
    setInfo(null);
    setProgress(0);
    setStatus("Starting crawl…");
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 4, 90));
    }, 500);
    try {
      const result = await ingestWebsite(DEMO_TENANT_ID, url, {
        includeSubdomains: true,
        maxPages: 80,
        maxDepth: 3,
        allowPatterns: [
          "services|pricing|packages|menu|treatment|book|appointment|schedule",
        ],
        includeBookingProviders: true,
      });
      clearInterval(interval);
      setProgress(100);
      setStatus("Complete!");
      setInfo(result.business_info || null);
    } catch (e: any) {
      clearInterval(interval);
      setProgress(0);
      setStatus(e?.message || "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-12">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2">
          <Brain className="h-8 w-8 text-primary" />
          <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Transform Websites into Knowledge
          </h2>
        </div>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Our AI crawls your site and any subdomain, extracts hours, services,
          prices, and contact info, and builds a searchable knowledge base.
        </p>
      </div>

      <Card className="rounded-2xl border-2 border-primary/10 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Live Demo: Website Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium flex items-center gap-2">
              <Star className="h-4 w-4 text-green-500" />
              Business Website URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground mt-1">
              AI extracts business hours, services, prices and contact info to build
              knowledge chunks.
            </p>
          </div>
          <div className="flex items-end">
            <Button
              disabled={!url || running}
              onClick={runDemo}
              className="rounded-xl w-full md:w-auto bg-gradient-to-r from-primary to-accent hover:opacity-90"
            >
              {running ? "AI Processing…" : "Analyze Website with AI"}
            </Button>
          </div>
        </div>

        {progress > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary animate-pulse" />
              {status}
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {info && (
          <div className="space-y-6 pt-4">
            <h3 className="font-semibold text-md">Extracted Business Info</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-medium">Business Hours</h4>
                    <p className="text-sm text-muted-foreground">
                      {info.business_hours?.length
                        ? info.business_hours
                            .map((h: any) =>
                              h.day && h.opens && h.closes
                                ? `${h.day}: ${h.opens}–${h.closes}`
                                : h.day,
                            )
                            .join(", ")
                        : "Not extracted"}
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-medium">Contact</h4>
                    <p className="text-sm text-muted-foreground">
                      {info.phone || info.email || "Not extracted"}
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-medium">Address</h4>
                    <p className="text-sm text-muted-foreground">
                      {info.address || "Not extracted"}
                    </p>
                  </div>
                </div>
              </Card>
              {info.services?.length > 0 && (
                <Card className="p-4">
                  <h4 className="font-medium mb-2">Top Services & Prices</h4>
                  <div className="flex flex-wrap gap-2">
                    {info.services.slice(0, 6).map(
                      (svc: { name: string; price?: string }, idx: number) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="px-3 py-1"
                        >
                          {svc.name}
                          {svc.price ? ` — ${svc.price}` : ""}
                        </Badge>
                      ),
                    )}
                  </div>
                </Card>
              )}
            </div>
            <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900 dark:to-emerald-800">
              <h4 className="font-medium mb-1">Ready!</h4>
              <p className="text-sm">
                AI can now answer questions about your hours, services, pricing and
                contact instantly.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

export default KnowledgeShowcase;
