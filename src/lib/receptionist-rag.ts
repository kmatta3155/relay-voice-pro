/**
 * Drop-in: fetch top-K knowledge for a given user/tenant + query.
 * Use this inside your call-handler to ground answers.
 */
import { ragSearch } from "@/lib/rag";

export async function getGroundingContext(tenant_id: string, userQuery: string, k = 6) {
  const results = await ragSearch(tenant_id, userQuery, k);
  return results.map((r: any) => `• ${r.content}`).join("\n");
}