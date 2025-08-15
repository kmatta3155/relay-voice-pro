import { supabase } from "@/integrations/supabase/client";

export async function ingestWebsite(tenant_id: string, site_url: string, title?: string) {
  const { data, error } = await supabase.functions.invoke("ingest", { 
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

export async function logUnanswered(tenant_id: string, question: string, call_id?: string) {
  const { data, error } = await supabase.functions.invoke("learning", { 
    body: { tenant_id, question, call_id }
  });
  if (error) throw error;
  return data;
}