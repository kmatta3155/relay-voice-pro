import { supabase } from "@/integrations/supabase/client";

/**
 * Crawl and ingest a website into the knowledge base.
 * Accepts optional crawl options (include subdomains, page limits, etc.).
 * Returns { ok, pagesIndexed, business_info } on success.
 */
export async function ingestWebsite(
  tenantId: string,
  url: string,
  options?: {
    includeSubdomains?: boolean;
    respectRobots?: boolean;
    followSitemaps?: boolean;
    maxPages?: number;
    maxDepth?: number;
    rateLimitMs?: number;
    allowPatterns?: string[];
    denyPatterns?: string[];
  },
) {
  const { data, error } = await supabase.functions.invoke("crawl-ingest", {
    body: {
      tenantId,
      url,
      options: {
        includeSubdomains: true,
        respectRobots: true,
        followSitemaps: true,
        maxPages: 120,
        maxDepth: 4,
        rateLimitMs: 400,
        ...(options || {}),
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function ragSearch(
  tenant_id: string,
  query: string,
  k = 8,
) {
  const { data, error } = await supabase.functions.invoke("search", {
    body: { tenant_id, query, k },
  });
  if (error) throw error;
  return data?.results || [];
}

export async function getQuickAnswer(
  tenant_id: string,
  query: string,
) {
  const { data, error } = await supabase.rpc("get_quick_answer", {
    p_tenant: tenant_id,
    p_query: query,
  });
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Perform an enhanced search: first try quick answers, then fallback to semantic search.
 * Returns result set plus metadata on search type and query expansion.
 */
export async function ragSearchEnhanced(
  tenant_id: string,
  query: string,
  k = 8,
) {
  const quickAnswer = await getQuickAnswer(tenant_id, query);
  if (quickAnswer && quickAnswer.confidence > 0.8) {
    return {
      results: [
        {
          content: quickAnswer.answer,
          score: quickAnswer.confidence,
          relevance_type: quickAnswer.question_type,
          source: "quick_answer",
        },
      ],
      search_type: "quick_answer",
      query_expanded: false,
    };
  }

  const { data, error } = await supabase.functions.invoke("search", {
    body: { tenant_id, query, k },
  });
  if (error) throw error;
  return (
    data || {
      results: [],
      search_type: "semantic",
      query_expanded: false,
    }
  );
}

/**
 * Log an unanswered user question for later analysis / training.
 */
export async function logUnanswered(
  tenant_id: string,
  question: string,
  call_id?: string,
) {
  const { data, error } = await supabase.functions.invoke("learning", {
    body: { tenant_id, question, call_id },
  });
  if (error) throw error;
  return data;
}
