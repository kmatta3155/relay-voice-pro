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

// Enhanced query preprocessing for business-specific searches
function expandBusinessQuery(query: string): string[] {
  const businessTerms: Record<string, string[]> = {
    'hours': ['business hours', 'opening hours', 'operating hours', 'open time', 'close time', 'schedule', 'availability'],
    'price': ['pricing', 'cost', 'fees', 'rates', 'charges', 'payment', 'billing'],
    'services': ['treatments', 'offerings', 'procedures', 'appointments', 'booking'],
    'location': ['address', 'directions', 'parking', 'contact', 'where located'],
    'staff': ['team', 'stylists', 'professionals', 'employees', 'who works'],
    'appointment': ['booking', 'scheduling', 'reservation', 'availability', 'slots']
  };
  
  const queries = [query.toLowerCase()];
  
  for (const [key, synonyms] of Object.entries(businessTerms)) {
    if (query.toLowerCase().includes(key)) {
      queries.push(...synonyms.map(s => `${s} ${query.replace(new RegExp(key, 'gi'), '').trim()}`));
      queries.push(...synonyms);
    }
  }
  
  return [...new Set(queries)].slice(0, 5); // Limit to 5 variations
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

async function hybridSearch(sb: SBClient, tenant_id: string, query: string, embeddings: number[], k: number, min_score: number) {
  // Semantic search
  const semanticResults = await sb.rpc("match_knowledge", { 
    p_tenant: tenant_id, 
    p_embedding: embeddings, 
    p_match_count: k * 2, 
    p_min_cosine_similarity: min_score 
  });

  // Keyword search for business hours specifically
  const keywordResults = await sb.rpc("search_knowledge_keywords", {
    p_tenant: tenant_id,
    p_query: query,
    p_match_count: k
  }).catch(() => []); // Fallback if function doesn't exist

  // Combine and deduplicate results
  const combined = [...semanticResults, ...keywordResults];
  const unique = combined.reduce((acc: any[], curr: any) => {
    if (!acc.find(item => item.chunk_id === curr.chunk_id)) {
      acc.push(curr);
    }
    return acc;
  }, []);

  // Sort by score and return top k
  return unique.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, k);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, query, k = 8, min_score = 0.25 } = await req.json(); // Increased min_score
    if (!tenant_id || !query) throw new Error("tenant_id and query are required");

    console.log(`Searching for: "${query}" in tenant: ${tenant_id}`);
    
    // Expand business queries for better matching
    const expandedQueries = expandBusinessQuery(query);
    console.log(`Expanded queries:`, expandedQueries);
    
    // Use the most specific query for embedding
    const primaryQuery = expandedQueries[0];
    const embedding = await embedQuery(primaryQuery);
    console.log(`Generated embedding with ${embedding.length} dimensions`);

    const sb = createClient();
    
    // Try hybrid search first, fallback to semantic only
    let rows;
    try {
      rows = await hybridSearch(sb, tenant_id, query, embedding, k, min_score);
      console.log(`Hybrid search found ${rows.length} matching chunks`);
    } catch (hybridError) {
      console.log(`Hybrid search failed, using semantic only:`, hybridError);
      rows = await sb.rpc("match_knowledge", { 
        p_tenant: tenant_id, 
        p_embedding: embedding, 
        p_match_count: k, 
        p_min_cosine_similarity: min_score 
      });
      console.log(`Semantic search found ${rows.length} matching chunks`);
    }
    
    // Determine relevance type helper function
    function determineRelevanceType(query: string, content: string): string {
      const q = query.toLowerCase();
      const c = content.toLowerCase();
      
      if (q.includes('hour') || q.includes('time') || q.includes('open') || q.includes('close')) {
        if (c.includes('hour') || c.includes('open') || c.includes('close') || c.includes('am') || c.includes('pm')) {
          return 'hours';
        }
      }
      if (q.includes('price') || q.includes('cost') || q.includes('fee')) {
        if (c.includes('price') || c.includes('cost') || c.includes('$') || c.includes('fee')) {
          return 'pricing';
        }
      }
      if (q.includes('service') || q.includes('treatment')) {
        if (c.includes('service') || c.includes('treatment') || c.includes('cut') || c.includes('color')) {
          return 'services';
        }
      }
      return 'general';
    }
    
    // Filter and enhance results
    const enhancedResults = rows.map((row: any) => ({
      ...row,
      relevance_type: determineRelevanceType(query, row.content),
      confidence: Math.min(1.0, (row.score || 0) * 1.2) // Boost confidence for display
    })).filter((row: any) => row.score >= min_score);

    console.log(`Returning ${enhancedResults.length} enhanced results`);

    return new Response(JSON.stringify({ 
      ok: true, 
      results: enhancedResults,
      query_expanded: expandedQueries.length > 1,
      search_type: rows.length !== enhancedResults.length ? 'hybrid' : 'semantic'
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error('Search error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});