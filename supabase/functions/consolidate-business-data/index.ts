import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DataSource {
  type: 'website' | 'file' | 'text';
  content: string;
  metadata?: any;
}

interface Service {
  name: string;
  description?: string;
  price?: string;
}

interface BusinessHours {
  day: string;
  open_time?: string;
  close_time?: string;
  is_closed: boolean;
}

interface ConsolidatedData {
  businessName: string;
  businessAddresses: string[];
  businessHours: BusinessHours[];
  services: Service[];
  confidence: number;
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    // Accept both snake_case and camelCase tenant ID
    const tenantId = body.tenantId || body.tenant_id;
    let dataSources: DataSource[] = body.dataSources || [];

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Tenant ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If no dataSources provided, load from the database (services + hours already extracted)
    if (!dataSources || dataSources.length === 0) {
      console.log(`No dataSources passed — loading from DB for tenant ${tenantId}`);
      try {
        const [servicesRes, hoursRes, sourcesRes] = await Promise.all([
          supabase.from('services').select('*').eq('tenant_id', tenantId).eq('active', true),
          supabase.from('business_hours').select('*').eq('tenant_id', tenantId),
          supabase.from('knowledge_sources').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5),
        ]);

        const dbContent: any = {
          services: servicesRes.data ?? [],
          hours: hoursRes.data ?? [],
          sources: sourcesRes.data ?? [],
        };

        // Include raw crawl metadata from knowledge_sources
        for (const src of (sourcesRes.data ?? [])) {
          if (src.meta?.business_info) {
            dbContent.business_info = src.meta.business_info;
            break;
          }
        }

        dataSources = [{
          type: 'website',
          content: JSON.stringify(dbContent),
          metadata: { source: 'database', tenant_id: tenantId }
        }];
        console.log(`Loaded from DB: ${dbContent.services.length} services, ${dbContent.hours.length} hours, ${dbContent.sources.length} sources`);
      } catch (dbErr) {
        console.error('Failed to load from DB:', dbErr);
      }
    }

    if (!dataSources || dataSources.length === 0) {
      return new Response(JSON.stringify({ error: 'No data sources available — crawl the website first' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Consolidating ${dataSources.length} data sources for tenant: ${tenantId}`);

    // ── Collect structured services deterministically ────────────────────────
    // The crawl already extracted services. They are the source of truth and
    // MUST NOT round-trip through the LLM: LLMs truncate long lists (~10 items)
    // and hallucinate prices. The LLM below only consolidates name/address/hours
    // and extracts services from unstructured sources (PDFs, manual text).
    const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const junkPattern = /^(home|welcome|about( us)?|contact( us)?|blog|news|login|sign ?up|faqs?|book (now|online|a \w+)|view (our )?services|our story|galler(y|ies)|locations?|franchise.*|gift ?cards?|e?gift ?cards?|memberships?|shop|deals?|services|pricing|prices|menu|privacy policy|terms.*|careers?|press|request more info|costs?\/?fees?|disclaimer|notes?|important)$/i;
    // Fix common UTF-8-as-Latin-1 mojibake (â€™ → ', â€" → –, etc.)
    const fixEncoding = (s: string) => s
      .replace(/â€™|Ã¢â‚¬â„¢/g, "'").replace(/â€œ|â€/g, '"')
      .replace(/â€“|â€”/g, '–').replace(/â€/g, '"')
      .replace(/Â/g, '').replace(/â/g, "'");

    // Byte-level mojibake repair: UTF-8 bytes decoded as Latin-1 become control
    // chars after the 0xE2 lead byte; re-encode the char codes as bytes and
    // decode as UTF-8. Throws (-> fall back to literal replacements) when the
    // string isn't actually mojibake.
    const fixMojibake = (s: string) => {
      if (!s) return s;
      try {
        const codes = [...s].map(c => c.charCodeAt(0));
        if (codes.some(c => c > 255)) return fixEncoding(s);
        return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(codes));
      } catch { return fixEncoding(s); }
    };
    const fragmentPattern = /\b(may be subject|are subject to|prices? (may )?vary|please call|please contact|disclaimer|terms and conditions)\b/i;
    const SERVICE_NOUN = /\b(cut|colou?r|hair|nail|wax|facial|massage|blowout|blow[\s-]?dry|style|styling|trim|shave|beard|braid|updo|perm|keratin|gloss|tone|toner|highlight|lowlight|balayage|ombre|extension|lash|brow|tint|tan|polish|mani|manicure|pedi|pedicure|treatment|condition|service|package|deal|makeup|spray|thread|silk|press|scalp|relaxer|smoothing|consultation|removal|session|process|head|body|wash|set|design|fill|soak|paraffin|peel|mask|masque|wrap|scrub|botox|filler|signature|partial|full|deep|express|single|root|touch|wave|curl|iron|hot|towel)\b/i;
    const personNameRe = /^[A-Z][a-z'’.-]{1,14}(?:\s+[A-Z][a-z'’.-]{1,15}){1,2}$/;

    // Names of extracted staff (full + first) so they're never shown as services.
    // Also keep the full staff objects so we can persist them to this tenant —
    // the onboarding crawl runs against the 'demo' tenant, so staff would
    // otherwise never reach the real tenant created afterward.
    const staffKeys = new Set<string>();
    const crawlStaff: any[] = [];
    let haveStaff = false;
    const addStaffKeys = (list: any[]) => {
      for (const st of list || []) {
        const n = normName(fixMojibake(st?.name || ''));
        if (n) {
          staffKeys.add(n); staffKeys.add(n.split(' ')[0]); haveStaff = true;
          if (st?.name) crawlStaff.push(st);
        }
      }
    };
    const isStaffName = (name: string): boolean => {
      const key = normName(name);
      if (staffKeys.has(key)) return true;
      if (/^staff\b/i.test(name.trim())) return true;
      const first = key.split(' ')[0];
      if (staffKeys.has(first) && key.split(' ').length <= 3) return true;
      if (haveStaff && personNameRe.test(name.trim().replace(/^staff\s+/i, '')) && !SERVICE_NOUN.test(name)) return true;
      return false;
    };

    const structuredServices: Service[] = [];
    const seenNames = new Set<string>();
    const collectServices = (list: any[]) => {
      for (const s of list) {
        const name = fixMojibake((s.name || '').trim()).replace(/\s{2,}/g, ' ');
        if (!name || name.length < 2 || name.length > 100 || junkPattern.test(name)) continue;
        const words = name.split(/\s+/).length;
        if (words >= 12 || fragmentPattern.test(name)) continue;                  // sentence fragments
        if (/^[^a-z]+$/.test(name) && words <= 4 && !/\d/.test(name)) continue;   // ALL-CAPS category headers
        if (isStaffName(name)) continue;                                          // stylist names, not services
        const key = normName(name);
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        const priceNum = s.price != null ? String(s.price).replace(/[^\d.]/g, '') : '';
        structuredServices.push({
          name,
          description: s.description ? fixMojibake(String(s.description).trim()) : undefined,
          price: priceNum && parseFloat(priceNum) > 0 ? `$${priceNum}` : undefined,
        });
      }
    };

    // First pass: gather staff names from every crawl source so service
    // collection below can exclude stylist names regardless of source order.
    for (const source of dataSources) {
      try {
        const parsed = JSON.parse(source.content);
        if (Array.isArray(parsed.staff)) addStaffKeys(parsed.staff);
      } catch { /* not JSON */ }
    }

    // Prepare consolidated content for AI processing
    let consolidatedContent = '';

    for (let i = 0; i < dataSources.length; i++) {
      const source = dataSources[i];
      consolidatedContent += `\n\n=== DATA SOURCE ${i + 1}: ${source.type.toUpperCase()} ===\n`;

      if (source.type === 'website' && source.metadata?.url) {
        consolidatedContent += `URL: ${source.metadata.url}\n`;
      } else if (source.type === 'file' && source.metadata?.filename) {
        consolidatedContent += `File: ${source.metadata.filename}\n`;
      }

      // If content is already parsed JSON from website crawl, extract the relevant parts
      try {
        const parsed = JSON.parse(source.content);
        if (parsed.services || parsed.hours || parsed.business_info) {
          if (Array.isArray(parsed.services)) collectServices(parsed.services);
          consolidatedContent += `Services: already extracted programmatically (${parsed.services?.length || 0} items) — do NOT include services from this source in your response.\n`;
          consolidatedContent += `Hours data: ${JSON.stringify(parsed.hours ?? [])}\n`;
          if (parsed.business_info) {
            consolidatedContent += `Business info: ${JSON.stringify(parsed.business_info)}\n`;
          }
        } else {
          consolidatedContent += source.content.slice(0, 60000);
        }
      } catch {
        // If not JSON, add as plain text
        consolidatedContent += source.content.slice(0, 60000);
      }
    }

    console.log(`Structured services collected deterministically: ${structuredServices.length}`);

    console.log(`Processing ${consolidatedContent.length} characters of consolidated content`);

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Use AI to consolidate and clean up all the data
    const prompt = `You are a business data consolidation expert. You have been given multiple data sources about a business (website crawl data, uploaded documents, manual text input). Your job is to consolidate ALL this information into a single, accurate business profile.

CRITICAL INSTRUCTIONS:
1. Merge and deduplicate information from all sources
2. Resolve conflicts by choosing the most complete/recent information
3. SERVICES: Only extract services from UNSTRUCTURED sources (PDF text, manual text). Sources marked "already extracted programmatically" are handled separately — return an EMPTY services array if all sources are marked that way.
4. Consolidate business addresses (remove duplicates, standardize format)
5. Merge business hours from all sources (most complete wins)
6. Standardize pricing format — NEVER invent a price that is not explicitly in the source data
7. Provide a confidence score (0-1) based on data consistency

Return ONLY valid JSON in this exact format:
{
  "businessName": "Complete Business Name",
  "businessAddresses": [
    "Complete address 1 with city, state, zip",
    "Complete address 2 if multiple locations"
  ],
  "businessHours": [
    {
      "day": "Monday",
      "open_time": "10:00 AM",
      "close_time": "7:00 PM", 
      "is_closed": false
    }
  ],
  "services": [
    {
      "name": "Service Name",
      "description": "Complete description",
      "price": "$XX.XX"
    }
  ],
  "confidence": 0.85
}

BUSINESS NAME RULES:
- Use the most complete business name found across all sources
- Remove common prefixes like "Welcome to" or "Home |"
- Prefer official business names over website titles

ADDRESS CONSOLIDATION:
- Merge duplicate addresses 
- Use most complete format (include city, state, zip)
- If multiple legitimate locations exist, include all

SERVICE CONSOLIDATION (unstructured sources only):
- Merge similar services (e.g., "Haircut" and "Hair Cut" = "Haircut")
- Remove fragments like "Call us for", "We offer", navigation items
- Include services WITHOUT prices — many businesses don't publish prices
- Keep only actual service names, not descriptions or contact info
- Remove any service longer than 100 characters (likely junk)

PRICING STANDARDIZATION:
- Use explicit prices when available: $50, $75.00, etc.
- For ranges like "$50-80", use starting price: "$50"
- If no pricing in any source, omit price field entirely
- Never invent prices

HOURS CONSOLIDATION:
- Use most complete hours information found
- Convert to standard 12-hour format (10:00 AM, 5:30 PM)
- If sources conflict, prefer the most detailed/recent

CONFIDENCE SCORING:
- 0.9+ = Multiple sources with consistent data
- 0.7-0.9 = Good data but some inconsistencies resolved
- 0.5-0.7 = Limited data or significant conflicts resolved
- Below 0.5 = Poor/insufficient data

Consolidated Data Sources:
${consolidatedContent}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    let aiResponse = data.choices[0].message.content.trim();
    
    // Remove code fences if present
    aiResponse = aiResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    aiResponse = aiResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    
    const consolidatedData: ConsolidatedData = JSON.parse(aiResponse);

    // ── Merge: deterministic services (source of truth) + AI extras ──────────
    // AI may have found additional services in unstructured sources (PDF/text).
    // Add those, but the structured list is never reduced or re-priced by AI.
    const aiExtras = (consolidatedData.services || []).filter(s => {
      const name = (s.name || '').trim();
      if (!name || name.length < 2 || name.length > 100 || junkPattern.test(name)) return false;
      return !seenNames.has(normName(name));
    });
    consolidatedData.services = [...structuredServices, ...aiExtras];
    console.log(`Final services: ${structuredServices.length} structured + ${aiExtras.length} AI extras = ${consolidatedData.services.length}`);

    console.log(`Consolidated data: ${consolidatedData.services?.length || 0} services, confidence: ${consolidatedData.confidence}`);

    // Save consolidated services to database
    if (consolidatedData.services && consolidatedData.services.length > 0) {
      // Clear existing services for this tenant first
      await supabase
        .from('services')
        .delete()
        .eq('tenant_id', tenantId);

      const servicesToInsert = consolidatedData.services.map((service) => ({
        tenant_id: tenantId,
        name: service.name,
        description: service.description || null,
        price: service.price ? parseFloat(service.price.replace(/[^\d.]/g, '')) : null,
        active: true
      }));

      const { error: servicesError } = await supabase
        .from('services')
        .insert(servicesToInsert);

      if (servicesError) {
        console.error('Error saving services:', servicesError);
      } else {
        console.log(`Successfully saved ${servicesToInsert.length} services`);
      }
    }

    // Persist staff (+schedules) extracted during the crawl into THIS tenant.
    // The onboarding crawl ran against the 'demo' tenant, so without this the
    // new tenant's Staff & Booking section would stay empty.
    if (crawlStaff.length > 0) {
      const dayNum: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      };
      const to24 = (t?: string): string | null => {
        const m = (t || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (!m) return null;
        let h = parseInt(m[1], 10); const min = m[2] ?? '00'; const ap = m[3]?.toLowerCase();
        if (ap === 'pm' && h !== 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        if (h > 23) return null;
        return `${String(h).padStart(2, '0')}:${min}:00`;
      };
      let savedStaff = 0;
      for (const st of crawlStaff) {
        const name = fixMojibake(String(st.name || '')).trim();
        if (!name) continue;
        try {
          const { data: row, error: stErr } = await supabase.from('staff').upsert({
            tenant_id: tenantId,
            name,
            role: st.role || null,
            specialties: Array.isArray(st.specialties) && st.specialties.length ? st.specialties : null,
            bio: st.bio ? String(st.bio).trim() : null,
            source: 'website',
            active: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id,name' }).select('id').single();
          if (stErr) { console.error('staff upsert failed:', name, stErr.message); continue; }
          savedStaff++;
          if (row?.id && Array.isArray(st.schedule) && st.schedule.length) {
            await supabase.from('staff_schedules').delete().eq('staff_id', row.id);
            const rows = st.schedule
              .map((s: any) => ({
                tenant_id: tenantId, staff_id: row.id,
                dow: dayNum[String(s.day || '').toLowerCase()] ?? null,
                start_time: to24(s.start_time), end_time: to24(s.end_time),
              }))
              .filter((r: any) => r.dow !== null && r.start_time && r.end_time);
            if (rows.length) await supabase.from('staff_schedules').insert(rows);
          }
        } catch (e) {
          console.error('staff save error (tables migrated?):', (e as Error).message);
        }
      }
      console.log(`Saved ${savedStaff}/${crawlStaff.length} staff to tenant ${tenantId}`);
    }

    // Save consolidated business hours to database
    if (consolidatedData.businessHours && consolidatedData.businessHours.length > 0) {
      // Clear existing hours for this tenant first
      await supabase
        .from('business_hours')
        .delete()
        .eq('tenant_id', tenantId);

      const to24h = (t?: string) => {
        if (!t) return null as any;
        const m = t.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
        if (!m) return t as any; // let Postgres attempt to parse if already compatible
        let [, hh, mm, ap] = m;
        let h = parseInt(hh, 10);
        if (ap) {
          const up = ap.toUpperCase();
          if (up === 'PM' && h !== 12) h += 12;
          if (up === 'AM' && h === 12) h = 0;
        }
        return `${String(h).padStart(2, '0')}:${mm}:00` as any;
      };

      const hoursToInsert = consolidatedData.businessHours
        .filter((hour) => !hour.is_closed) // Only insert open days
        .map((hour) => {
          const dayMap: { [key: string]: number } = {
            'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
            'friday': 5, 'saturday': 6, 'sunday': 0
          };

          return {
            tenant_id: tenantId,
            dow: dayMap[hour.day.toLowerCase()] ?? 1,
            open_time: to24h(hour.open_time || ''),
            close_time: to24h(hour.close_time || ''),
            is_closed: false
          };
        });

      const { error: hoursError } = await supabase
        .from('business_hours')
        .insert(hoursToInsert);

      if (hoursError) {
        console.error('Error saving business hours:', hoursError);
      } else {
        console.log(`Successfully saved ${hoursToInsert.length} business hours`);
      }
    }

    // Derive and save Quick Answers for FAQ-style responses
    try {
      // Clear existing quick answers
      await supabase.from('business_quick_answers').delete().eq('tenant_id', tenantId);

      const hoursSummary = (consolidatedData.businessHours || [])
        .map(h => `${h.day}: ${h.is_closed ? 'Closed' : `${h.open_time} - ${h.close_time}`}`)
        .join('\n');

      const topServices = (consolidatedData.services || [])
        .slice(0, 8)
        .map(s => `${s.name}${s.price ? ` - ${s.price}` : ''}`)
        .join('\n');

      const addresses = (consolidatedData.businessAddresses || []).join('\n');

      const qaRows = [
        hoursSummary && {
          tenant_id: tenantId,
          question_type: 'hours',
          question_pattern: '(hour|open|close|time)',
          answer: `Our business hours are as follows:\n${hoursSummary}`,
          confidence: 0.95
        },
        topServices && {
          tenant_id: tenantId,
          question_type: 'services',
          question_pattern: '(service|offer|treatment|menu)',
          answer: `We offer the following services:\n${topServices}`,
          confidence: 0.9
        },
        addresses && {
          tenant_id: tenantId,
          question_type: 'location',
          question_pattern: '(address|location|where.*located|directions)',
          answer: `Our locations:\n${addresses}`,
          confidence: 0.9
        },
        (consolidatedData.services || []).some(s => s.price) && {
          tenant_id: tenantId,
          question_type: 'pricing',
          question_pattern: '(price|cost|how\s*much)',
          answer: `Starting prices for popular services:\n${(consolidatedData.services || [])
            .filter(s => s.price)
            .slice(0, 6)
            .map(s => `${s.name}: ${s.price}`)
            .join('\n')}\nPrices vary by provider and service details.`,
          confidence: 0.85
        }
      ].filter(Boolean) as any[];

      if (qaRows.length) {
        const { error: qaError } = await supabase.from('business_quick_answers').insert(qaRows);
        if (qaError) console.error('Error saving quick answers:', qaError);
        else console.log(`Saved ${qaRows.length} quick answers`);
      }
    } catch (qaSaveError) {
      console.error('Quick answers generation failed:', qaSaveError);
    }

    return new Response(JSON.stringify({
      success: true,
      consolidatedData,
      sources_processed: dataSources.length,
      extraction_method: 'ai_consolidation'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in consolidate-business-data function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});