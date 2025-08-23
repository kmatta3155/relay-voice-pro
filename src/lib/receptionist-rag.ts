/**
 * Drop-in: fetch top-K knowledge for a given user/tenant + query.
 * Use this inside your call-handler to ground answers.
 */
import { ragSearchEnhanced } from "@/lib/rag";
import { supabase } from "@/integrations/supabase/client";

export async function getGroundingContext(tenant_id: string, userQuery: string, k = 6) {
  const searchResult: any = await ragSearchEnhanced(tenant_id, userQuery, k);
  
  // If we got a quick answer, return it directly
  if (searchResult.search_type === 'quick_answer' && searchResult.results?.length > 0) {
    return searchResult.results[0].content;
  }

  const q = userQuery.toLowerCase();
  const hasPriceIntent = /(how much|price|cost|pricing|rate|fee|charge)/i.test(q);
  const hasHoursIntent = /(hour|open|close|opening|closing|time)/i.test(q);

  // 1) Structured data: Services & Pricing
  if (hasPriceIntent) {
    try {
      const { data: services, error } = await supabase
        .from('services')
        .select('name, price, duration_minutes')
        .eq('tenant_id', tenant_id)
        .limit(50);

      if (!error && services && services.length) {
        const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const queryTokens = new Set(normalize(q).split(' ').filter(t => t.length > 2));

        let best: any = null;
        let bestScore = -1;
        for (const s of services as any[]) {
          const name = s.name || '';
          const nameTokens = new Set(normalize(name).split(' ').filter(t => t.length > 2));
          let overlap = 0;
          nameTokens.forEach(t => { if (queryTokens.has(t)) overlap++; });
          const score = overlap + (q.includes(name.toLowerCase()) ? 2 : 0);
          if (score > bestScore) { bestScore = score; best = s; }
        }

        if (best && best.price != null) {
          const raw = (best.price as any);
          const priceStr = typeof raw === 'number' ? `$${raw}` : `$${Number(raw).toFixed(2)}`;
          const durStr = best.duration_minutes ? ` (${best.duration_minutes} min)` : '';
          return `Pricing: ${best.name} is ${priceStr}${durStr}.`;
        }
      }
    } catch (e) {
      console.warn('Service pricing fallback failed:', e);
    }
  }

  // 2) Structured data: Business Hours
  if (hasHoursIntent) {
    try {
      const { data: hours } = await supabase
        .from('business_hours')
        .select('dow, is_closed, open_time, close_time')
        .eq('tenant_id', tenant_id)
        .order('dow', { ascending: true });

      if (hours && hours.length) {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const lines = (hours as any[]).map(h => h.is_closed
          ? `${days[h.dow % 7]}: Closed`
          : `${days[h.dow % 7]}: ${h.open_time} - ${h.close_time}`
        );
        return `Business hours:\n${lines.join('\n')}`;
      }
    } catch (e) {
      console.warn('Hours fallback failed:', e);
    }
  }
  
  // 3) Otherwise format the semantic search results (RAG)
  return (searchResult.results || []).map((r: any) => `• ${r.content}`).join("\n");
}
