import { supabase } from "@/integrations/supabase/client";

/**
 * Crawl and ingest a website. Calls our new universal crawler.
 * You can override options for subdomains, page limits, depth, rate, allow/deny patterns,
 * booking providers, etc.
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
    includeBookingProviders?: boolean;
    extraAllowedHosts?: string[];
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
        maxPages: 160,
        maxDepth: 4,
        rateLimitMs: 350,
        ...(options || {}),
      },
    },
  });
  if (error) throw error;
  return data;
}

/**
 * RAG search functions remain unchanged.
 * (ragSearchEnhanced is used by KnowledgePage to search extracted chunks.)
 */
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
