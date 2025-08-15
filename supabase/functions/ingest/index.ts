// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: ingest
// Crawl a site (allowlist), extract text, chunk, embed (OpenAI), store per-tenant
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ALLOWLIST = (Deno.env.get("CRAWL_ALLOWLIST") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const MODEL = "text-embedding-3-small"; // 1536 dims

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SBClient = ReturnType<typeof createClient>;
function createClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return {
    url, key,
    async rpc(fn: string, args: any) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      if (!r.ok) throw new Error(`${fn} ${r.status} ${await r.text()}`);
      return await r.json();
    },
    async insert(table: string, rows: any[]) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(rows)
      });
      if (!r.ok) throw new Error(`${table} insert ${r.status} ${await r.text()}`);
      return await r.json();
    }
  };
}

function normalizeUrl(u: string) {
  try { const x = new URL(u); x.hash = ""; return x.toString(); } catch { return u; }
}

async function fetchText(url: string) {
  const r = await fetch(url, { redirect: "follow" as RequestRedirect });
  const html = await r.text();
  // strip scripts/styles and tags → text
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 200000); // safety cap
}

function chunkText(text: string, maxTokens = 700) {
  // very rough token approx: 4 chars ~ 1 token
  const maxChars = maxTokens * 4;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

async function embedAll(chunks: string[]) {
  const body = { input: chunks, model: MODEL };
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const json = await r.json() as any;
  return (json.data as any[]).map(d => d.embedding as number[]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient();
    const { tenant_id, site_url, title = null, allowlist = ALLOWLIST } = await req.json();
    
    if (!tenant_id || !site_url) throw new Error("tenant_id and site_url are required");

    // allowlist enforcement (optional; pass [] to skip)
    if (allowlist && allowlist.length) {
      const ok = allowlist.some((prefix: string) => site_url.startsWith(prefix));
      if (!ok) throw new Error(`Blocked by allowlist. Allowed: ${allowlist.join(", ")}`);
    }

    console.log(`Ingesting: ${site_url} for tenant: ${tenant_id}`);

    const url = normalizeUrl(site_url);
    const text = await fetchText(url);
    if (!text) throw new Error("No text extracted");

    console.log(`Extracted ${text.length} characters`);

    const chunks = chunkText(text);
    console.log(`Created ${chunks.length} chunks`);

    const embeddings = await embedAll(chunks);
    console.log(`Generated ${embeddings.length} embeddings`);

    // Insert source
    const [source] = await sb.insert("knowledge_sources", [{
      tenant_id, source_url: url, source_type: "web", title, meta: { bytes: text.length }
    }]);

    console.log(`Inserted source: ${source.id}`);

    // Insert chunks
    const rows = chunks.map((content, i) => ({
      tenant_id, source_id: source.id, content, token_count: Math.ceil(content.length / 4),
      embedding: embeddings[i]
    }));
    await sb.insert("knowledge_chunks", rows);

    console.log(`Inserted ${rows.length} chunks`);

    return new Response(JSON.stringify({ ok: true, source_id: source.id, chunks: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error('Ingest error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});