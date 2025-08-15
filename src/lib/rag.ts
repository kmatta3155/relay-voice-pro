import { supabase } from "@/integrations/supabase/client";

export async function ingestWebsite(tenant_id: string, site_url: string, title?: string) {
  const { data, error } = await supabase.functions.invoke("ingest-enhanced", { 
    body: { tenant_id, site_url, title }
  });
  if (error) throw error;
  return data;
}

export async function ragSearch(tenant_id: string, query: string, k = 8) {
  const { data, error } = await supabase.functions.invoke("search", { 
    body: { tenant_id, query, k }
  });
  if (error) throw error;
  return data?.results || [];
}

export async function getQuickAnswer(tenant_id: string, query: string) {
  const { data, error } = await supabase.rpc("get_quick_answer", {
    p_tenant: tenant_id,
    p_query: query
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function ragSearchEnhanced(tenant_id: string, query: string, k = 8) {
  // Try quick answer first
  const quickAnswer = await getQuickAnswer(tenant_id, query);
  if (quickAnswer && quickAnswer.confidence > 0.8) {
    return {
      results: [{
        content: quickAnswer.answer,
        score: quickAnswer.confidence,
        relevance_type: quickAnswer.question_type,
        source: 'quick_answer'
      }],
      search_type: 'quick_answer',
      query_expanded: false
    };
  }

  // Fallback to enhanced semantic search
  const { data, error } = await supabase.functions.invoke("search", { 
    body: { tenant_id, query, k }
  });
  if (error) throw error;
  return data || { results: [], search_type: 'semantic', query_expanded: false };
}

export async function logUnanswered(tenant_id: string, question: string, call_id?: string) {
  const { data, error } = await supabase.functions.invoke("learning", { 
    body: { tenant_id, question, call_id }
  });
  if (error) throw error;
  return data;
}