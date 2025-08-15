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

// Enhanced intent detection and query preprocessing
function detectQueryIntent(query: string): { intent: string; priority: number; patterns: string[] } {
  const q = query.toLowerCase();
  
  // Business hours intent (highest priority)
  if (q.match(/\b(hours?|time|open|close|when.*open|schedule|operating)\b/)) {
    return {
      intent: 'hours',
      priority: 10,
      patterns: ['business hours', 'opening hours', 'operating hours', 'schedule', 'when open', 'when close']
    };
  }
  
  // Contact info intent
  if (q.match(/\b(phone|call|contact|number|email|reach)\b/)) {
    return {
      intent: 'contact',
      priority: 9,
      patterns: ['phone number', 'contact info', 'call', 'telephone', 'email address']
    };
  }
  
  // Services intent
  if (q.match(/\b(service|treatment|offer|do|menu|procedure)\b/)) {
    return {
      intent: 'services',
      priority: 8,
      patterns: ['services offered', 'treatments', 'what do you do', 'menu', 'procedures']
    };
  }
  
  // Location intent
  if (q.match(/\b(where|location|address|find|direction)\b/)) {
    return {
      intent: 'location',
      priority: 8,
      patterns: ['location', 'address', 'where located', 'directions', 'find us']
    };
  }
  
  // Pricing intent
  if (q.match(/\b(price|cost|fee|rate|how much|pricing)\b/)) {
    return {
      intent: 'pricing',
      priority: 7,
      patterns: ['pricing', 'cost', 'fees', 'rates', 'how much']
    };
  }
  
  return { intent: 'general', priority: 5, patterns: [query] };
}

function expandBusinessQuery(query: string): string[] {
  const intent = detectQueryIntent(query);
  const expandedQueries = [query.toLowerCase()];
  
  // Add intent-specific patterns
  expandedQueries.push(...intent.patterns);
  
  // Add query with intent keywords
  if (intent.intent !== 'general') {
    expandedQueries.push(`${intent.intent} ${query}`);
  }
  
  return [...new Set(expandedQueries)].slice(0, 6);
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
    const { tenant_id, query, k = 8, min_score = 0.3 } = await req.json(); // Increased min_score for better quality
    if (!tenant_id || !query) throw new Error("tenant_id and query are required");

    console.log(`Searching for: "${query}" in tenant: ${tenant_id}`);
    
    // Detect query intent for prioritization
    const queryIntent = detectQueryIntent(query);
    console.log(`Query intent: ${queryIntent.intent} (priority: ${queryIntent.priority})`);
    
    // First try quick answer for high-priority intents
    if (queryIntent.priority >= 8) {
      try {
        const quickAnswer = await sb.rpc("get_quick_answer", {
          p_tenant: tenant_id,
          p_query: query
        });
        
        if (quickAnswer && quickAnswer.length > 0 && quickAnswer[0].confidence > 0.85) {
          console.log(`Quick answer found with confidence: ${quickAnswer[0].confidence}`);
          return new Response(JSON.stringify({
            ok: true,
            results: [{
              content: quickAnswer[0].answer,
              score: quickAnswer[0].confidence,
              relevance_type: quickAnswer[0].question_type,
              source: 'quick_answer',
              confidence: quickAnswer[0].confidence
            }],
            search_type: 'quick_answer',
            query_intent: queryIntent.intent
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (quickAnswerError) {
        console.log("Quick answer search failed:", quickAnswerError);
      }
    }
    
    // Expand queries for semantic search
    const expandedQueries = expandBusinessQuery(query);
    console.log(`Expanded queries:`, expandedQueries);
    
    const primaryQuery = expandedQueries[0];
    const embedding = await embedQuery(primaryQuery);
    console.log(`Generated embedding with ${embedding.length} dimensions`);

    const sb = createClient();
    
    // Enhanced hybrid search with intent filtering
    let rows;
    try {
      rows = await hybridSearch(sb, tenant_id, query, embedding, k * 2, min_score * 0.8); // Get more results for filtering
      console.log(`Hybrid search found ${rows.length} matching chunks`);
    } catch (hybridError) {
      console.log(`Hybrid search failed, using semantic only:`, hybridError);
      rows = await sb.rpc("match_knowledge", { 
        p_tenant: tenant_id, 
        p_embedding: embedding, 
        p_match_count: k * 2, 
        p_min_cosine_similarity: min_score * 0.8 
      });
      console.log(`Semantic search found ${rows.length} matching chunks`);
    }
    
    // Enhanced relevance scoring with intent matching
    function calculateRelevanceScore(query: string, content: string, intent: string): { relevance_type: string; score_boost: number } {
      const q = query.toLowerCase();
      const c = content.toLowerCase();
      
      // Intent-specific scoring
      if (intent === 'hours' && (c.includes('hour') || c.includes('open') || c.includes('close') || c.includes('am') || c.includes('pm') || c.includes('schedule'))) {
        return { relevance_type: 'hours', score_boost: 0.4 };
      }
      if (intent === 'contact' && (c.includes('phone') || c.includes('email') || c.includes('contact') || c.includes('call'))) {
        return { relevance_type: 'contact', score_boost: 0.3 };
      }
      if (intent === 'services' && (c.includes('service') || c.includes('treatment') || c.includes('offer'))) {
        return { relevance_type: 'services', score_boost: 0.3 };
      }
      if (intent === 'location' && (c.includes('address') || c.includes('location') || c.includes('where'))) {
        return { relevance_type: 'location', score_boost: 0.3 };
      }
      if (intent === 'pricing' && (c.includes('price') || c.includes('cost') || c.includes('$') || c.includes('fee'))) {
        return { relevance_type: 'pricing', score_boost: 0.3 };
      }
      
      // General keyword matching
      if (q.includes('hour') && (c.includes('hour') || c.includes('open') || c.includes('close'))) {
        return { relevance_type: 'hours', score_boost: 0.2 };
      }
      if (q.includes('price') && (c.includes('price') || c.includes('cost') || c.includes('$'))) {
        return { relevance_type: 'pricing', score_boost: 0.2 };
      }
      
      return { relevance_type: 'general', score_boost: 0 };
    }
    
    // Enhanced result processing with intent-based filtering
    const enhancedResults = rows
      .map((row: any) => {
        const relevance = calculateRelevanceScore(query, row.content, queryIntent.intent);
        const boostedScore = Math.min(1.0, (row.score || 0) + relevance.score_boost);
        
        return {
          ...row,
          relevance_type: relevance.relevance_type,
          confidence: boostedScore,
          score: boostedScore,
          intent_match: relevance.relevance_type === queryIntent.intent
        };
      })
      .filter((row: any) => {
        // For high-priority intents, prefer intent-matching results
        if (queryIntent.priority >= 8) {
          return row.intent_match || row.score >= min_score;
        }
        return row.score >= min_score;
      })
      .sort((a: any, b: any) => {
        // Prioritize intent matches for high-priority queries
        if (queryIntent.priority >= 8) {
          if (a.intent_match && !b.intent_match) return -1;
          if (!a.intent_match && b.intent_match) return 1;
        }
        return (b.score || 0) - (a.score || 0);
      })
      .slice(0, k);

    console.log(`Returning ${enhancedResults.length} intent-filtered results`);

    return new Response(JSON.stringify({ 
      ok: true, 
      results: enhancedResults,
      query_expanded: expandedQueries.length > 1,
      search_type: 'enhanced_hybrid',
      query_intent: queryIntent.intent,
      intent_priority: queryIntent.priority
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