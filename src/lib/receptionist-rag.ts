/**
 * Drop-in: fetch top-K knowledge for a given user/tenant + query.
 * Use this inside your call-handler to ground answers.
 */
import { ragSearchEnhanced } from "@/lib/rag";

export async function getGroundingContext(tenant_id: string, userQuery: string, k = 6) {
  const searchResult = await ragSearchEnhanced(tenant_id, userQuery, k);
  
  // If we got a quick answer, return it directly
  if (searchResult.search_type === 'quick_answer' && searchResult.results.length > 0) {
    return searchResult.results[0].content;
  }
  
  // Otherwise format the semantic search results
  return searchResult.results.map((r: any) => `• ${r.content}`).join("\n");
}