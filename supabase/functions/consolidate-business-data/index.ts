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
    const { dataSources, tenantId } = await req.json();

    if (!dataSources || !Array.isArray(dataSources) || dataSources.length === 0) {
      return new Response(JSON.stringify({ error: 'No data sources provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Tenant ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Consolidating ${dataSources.length} data sources for tenant: ${tenantId}`);

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
          consolidatedContent += `Services found: ${parsed.services?.length || 0}\n`;
          consolidatedContent += `Hours found: ${parsed.hours?.length || 0}\n`;
          if (parsed.business_info) {
            consolidatedContent += `Business info: ${JSON.stringify(parsed.business_info)}\n`;
          }
          // Add raw data for AI to process
          consolidatedContent += `Raw data: ${JSON.stringify(parsed)}\n`;
        } else {
          consolidatedContent += source.content;
        }
      } catch {
        // If not JSON, add as plain text
        consolidatedContent += source.content;
      }
    }

    console.log(`Processing ${consolidatedContent.length} characters of consolidated content`);

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Use AI to consolidate and clean up all the data
    const prompt = `You are a business data consolidation expert. You have been given multiple data sources about a business (website crawl data, uploaded documents, manual text input). Your job is to consolidate ALL this information into a single, accurate business profile.

CRITICAL INSTRUCTIONS:
1. Merge and deduplicate information from all sources
2. Resolve conflicts by choosing the most complete/recent information
3. Extract ONLY legitimate business services - no navigation text or fragments
4. Consolidate business addresses (remove duplicates, standardize format)
5. Merge business hours from all sources (most complete wins)
6. Clean up service names and remove junk data
7. Standardize pricing format
8. Provide a confidence score (0-1) based on data consistency

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

SERVICE CONSOLIDATION:
- Merge similar services (e.g., "Haircut" and "Hair Cut" = "Haircut")
- Remove fragments like "Call us for", "We offer", navigation items
- Prefer services with pricing information
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