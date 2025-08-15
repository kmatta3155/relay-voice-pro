import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { loadProfile } from "@/lib/tenancy";
import { ingestWebsite as ingest } from "@/lib/rag";

export default function IngestTest() {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState("");
  const [url, setUrl] = useState("https://elitehairstudio.com/");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const prof = await loadProfile();
        if (prof?.active_tenant_id) setTenantId(prof.active_tenant_id);
      } catch (e) {
        console.error("Failed to load profile", e);
      }
    })();
  }, []);

  const canRun = useMemo(() => !!tenantId && !!url, [tenantId, url]);

  async function run() {
    setBusy(true);
    setProgress(5);
    setOutput("");
    try {
      setOutput((p) => p + `Starting ingest for ${url}\n`);
      const res = await ingest(tenantId, url, title || undefined);
      setProgress(100);
      setOutput((p) => p + JSON.stringify(res, null, 2));
      toast({ title: "Ingest completed", description: `Processed ${res?.pages_processed ?? 0} pages` });
    } catch (e: any) {
      setProgress(100);
      const msg = e?.message || "Ingest failed";
      setOutput((p) => p + `Error: ${msg}\n`);
      toast({ title: "Ingest error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Ingest Tester</h1>
      <Card className="p-4 space-y-4">
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="tenant">Tenant ID</Label>
            <Input id="tenant" placeholder="tenant-uuid" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="url">Website URL</Label>
            <Input id="url" type="url" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Optional Title</Label>
            <Input id="title" placeholder="Custom source title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        {busy && <Progress value={progress} />}
        <div className="flex gap-2">
          <Button onClick={run} disabled={!canRun || busy}>{busy ? "Running…" : "Run Ingest"}</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Output</div>
        <pre className="text-xs whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
          {output || "No output yet."}
        </pre>
      </Card>
    </main>
  );
}
