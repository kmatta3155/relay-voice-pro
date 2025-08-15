// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: search
// Input: { tenant_id, query, k?, min_score? } → top-K chunks with scores
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
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
    async rpc(fn: string, args: any) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      if (!r.ok) throw new Error(`${fn} ${r.status} ${await r.text()}`);
      return await r.json();
    }
  };
}

async function embedQuery(q: string) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: q, model: MODEL })
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json() as any;
  return j.data[0].embedding as number[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, query, k = 8, min_score = 0.15 } = await req.json();
    if (!tenant_id || !query) throw new Error("tenant_id and query are required");

    console.log(`Searching for: "${query}" in tenant: ${tenant_id}`);

    const embedding = await embedQuery(query);
    console.log(`Generated embedding with ${embedding.length} dimensions`);

    const sb = createClient();
    const rows = await sb.rpc("match_knowledge", { 
      p_tenant: tenant_id, 
      p_embedding: embedding, 
      p_match_count: k, 
      p_min_cosine_similarity: min_score 
    });

    console.log(`Found ${rows.length} matching chunks`);

    return new Response(JSON.stringify({ ok: true, results: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error('Search error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});