
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

interface ExtractedService {
  name: string;
  description?: string;
  price?: string;
  duration_minutes?: number;
}

interface ExtractedHours {
  day: string;
  open_time?: string;
  close_time?: string;
  is_closed: boolean;
}

interface ExtractionResult {
  services: ExtractedService[];
  hours: ExtractedHours[];
  pages_fetched: number;
  used_firecrawl: boolean;
  extraction_method: string;
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchWithFirecrawl(url: string, options: CrawlOptions): Promise<{ content: string; pages_fetched: number }> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("Firecrawl API key not available");
  }

  console.log('Using Firecrawl for crawling:', url);
  
  const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      limit: options.maxPages || 10,
      scrapeOptions: {
        formats: ['markdown', 'html'],
        includeTags: ['title', 'meta', 'script[type="application/ld+json"]'],
        onlyMainContent: false
      },
      crawlerOptions: {
        includes: options.includePatterns || [],
        excludes: options.excludePatterns || ['*/blog/*', '*/news/*', '*/privacy*', '*/terms*'],
        maxDepth: options.maxDepth || 2
      }
    }),
  });

  if (!crawlResponse.ok) {
    throw new Error(`Firecrawl API error: ${crawlResponse.status}`);
  }

  const crawlData = await crawlResponse.json();
  
  if (crawlData.success && crawlData.data) {
    let combinedContent = '';
    let pages_fetched = 0;
    
    for (const page of crawlData.data) {
      if (page.markdown) {
        combinedContent += `\n\n=== PAGE: ${page.metadata?.sourceURL || 'Unknown'} ===\n`;
        combinedContent += page.markdown;
        pages_fetched++;
      }
    }
    
    console.log(`Firecrawl extracted content from ${pages_fetched} pages`);
    return { content: combinedContent, pages_fetched };
  }
  
  throw new Error('Firecrawl did not return valid data');
}

async function fetchHeuristic(url: string, options: CrawlOptions): Promise<{ content: string; pages_fetched: number }> {
  console.log('Using heuristic crawling for:', url);
  
  const visitedUrls = new Set<string>();
  const toVisit: string[] = [url];
  let combinedContent = '';
  let pages_fetched = 0;
  const maxPages = options.maxPages || 5;
  
  while (toVisit.length > 0 && pages_fetched < maxPages) {
    const currentUrl = toVisit.shift()!;
    
    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);
    
    try {
      const response = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Business-Info-Extractor/1.0)'
        }
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      combinedContent += `\n\n=== PAGE: ${currentUrl} ===\n${html}`;
      pages_fetched++;
      
      // Extract additional URLs for crawling (simple heuristic)
      if (pages_fetched < maxPages) {
        const urlPattern = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = urlPattern.exec(html)) !== null) {
          const foundUrl = match[1];
          if (foundUrl.startsWith('/')) {
            const baseUrl = new URL(currentUrl).origin;
            toVisit.push(baseUrl + foundUrl);
          } else if (foundUrl.startsWith('http') && foundUrl.includes(new URL(currentUrl).hostname)) {
            toVisit.push(foundUrl);
          }
          
          if (toVisit.length >= maxPages * 2) break; // Limit queue size
        }
      }
    } catch (error) {
      console.error(`Failed to fetch ${currentUrl}:`, error);
    }
  }
  
  console.log(`Heuristic crawling extracted content from ${pages_fetched} pages`);
  return { content: combinedContent, pages_fetched };
}

function extractStructuredData(html: string): { services: ExtractedService[]; hours: ExtractedHours[] } {
  const services: ExtractedService[] = [];
  const hours: ExtractedHours[] = [];
  
  // Extract JSON-LD data
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  let match;
  
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      let jsonData = JSON.parse(jsonContent);
      
      // Handle arrays and @graph
      if (Array.isArray(jsonData)) {
        jsonData = jsonData[0];
      } else if (jsonData['@graph']) {
        jsonData = jsonData['@graph'][0];
      }
      
      // Extract services
      if (jsonData.hasOfferCatalog?.itemListElement) {
        for (const item of jsonData.hasOfferCatalog.itemListElement) {
          services.push({
            name: item.name || 'Unnamed Service',
            description: item.description,
            price: item.offers?.price ? `$${item.offers.price}` : undefined,
            duration_minutes: item.offers?.duration ? parseInt(item.offers.duration) : undefined
          });
        }
      }
      
      // Extract opening hours
      if (jsonData.openingHours || jsonData.openingHoursSpecification) {
        const hoursSpec = jsonData.openingHoursSpecification || jsonData.openingHours;
        if (Array.isArray(hoursSpec)) {
          for (const spec of hoursSpec) {
            const dayName = spec.dayOfWeek?.replace('https://schema.org/', '') || spec.dayOfWeek;
            hours.push({
              day: dayName,
              open_time: spec.opens,
              close_time: spec.closes,
              is_closed: !spec.opens || !spec.closes
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse JSON-LD:', error);
    }
  }
  
  // Extract title as potential business name
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const businessName = titleMatch ? titleMatch[1].trim() : '';
  
  console.log(`Structured data extraction found ${services.length} services, ${hours.length} hours entries`);
  return { services, hours };
}

async function extractWithAI(content: string): Promise<{ services: ExtractedService[]; hours: ExtractedHours[] }> {
  if (!OPENAI_API_KEY) {
    console.log('No OpenAI API key available, skipping AI extraction');
    return { services: [], hours: [] };
  }
  
  console.log('Using OpenAI for content extraction');
  
  const prompt = `Extract business information from this website content. Return only valid JSON with this exact structure:

{
  "services": [
    {
      "name": "Service Name",
      "description": "Brief description",
      "price": "$XX.XX",
      "duration_minutes": 60
    }
  ],
  "hours": [
    {
      "day": "Monday",
      "open_time": "9:00 AM",
      "close_time": "5:00 PM",
      "is_closed": false
    }
  ]
}

Guidelines:
- Extract actual services offered (haircuts, treatments, etc.)
- Convert prices to $XX.XX format
- Convert durations to minutes (e.g., "1 hour" = 60)
- Use standard day names (Monday, Tuesday, etc.)
- Use 12-hour time format (9:00 AM, 5:00 PM)
- Set is_closed: true for days not mentioned or explicitly closed

Website content:
${content.slice(0, 15000)}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    let aiResponse = data.choices[0].message.content.trim();
    
    // Remove code fences if present
    aiResponse = aiResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    
    const parsed = JSON.parse(aiResponse);
    console.log(`AI extraction found ${parsed.services?.length || 0} services, ${parsed.hours?.length || 0} hours entries`);
    
    return {
      services: parsed.services || [],
      hours: parsed.hours || []
    };
  } catch (error) {
    console.error('AI extraction failed:', error);
    return { services: [], hours: [] };
  }
}

function mapDayToNumber(dayName: string): number {
  const dayMap: { [key: string]: number } = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6
  };
  return dayMap[dayName.toLowerCase()] ?? 1;
}

function normalizeTime(timeStr: string): string {
  if (!timeStr) return '';
  
  // Convert 24-hour to 12-hour format
  const time24Match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (time24Match) {
    const hour = parseInt(time24Match[1]);
    const minute = time24Match[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${minute} ${ampm}`;
  }
  
  return timeStr;
}

async function saveToDatabase(tenantId: string, services: ExtractedService[], hours: ExtractedHours[]) {
  console.log(`Saving ${services.length} services and ${hours.length} hours entries to database`);
  
  // Save services
  for (const service of services) {
    const { error } = await supabase
      .from('services')
      .upsert({
        tenant_id: tenantId,
        name: service.name,
        description: service.description,
        price: service.price,
        duration_minutes: service.duration_minutes,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,name'
      });
    
    if (error) {
      console.error('Failed to save service:', service.name, error);
    }
  }
  
  // Save business hours
  for (const hour of hours) {
    const { error } = await supabase
      .from('business_hours')
      .upsert({
        tenant_id: tenantId,
        dow: mapDayToNumber(hour.day),
        open_time: hour.open_time ? normalizeTime(hour.open_time) : null,
        close_time: hour.close_time ? normalizeTime(hour.close_time) : null,
        is_closed: hour.is_closed,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,dow'
      });
    
    if (error) {
      console.error('Failed to save business hours:', hour.day, error);
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('Received body:', JSON.stringify(body, null, 2));
    
    const { url, tenant_id, tenantId, options = {} } = body;
    const finalTenantId = tenant_id || tenantId;
    
    console.log(`Starting extraction for ${url} with options:`, options);
    
    if (!url || !finalTenantId) {
      throw new Error('URL and tenant_id are required');
    }

    let content = '';
    let pages_fetched = 0;
    let used_firecrawl = false;
    let extraction_method = 'heuristic';

    // Try Firecrawl first, fallback to heuristic
    try {
      if (FIRECRAWL_API_KEY) {
        const firecrawlResult = await fetchWithFirecrawl(url, options);
        content = firecrawlResult.content;
        pages_fetched = firecrawlResult.pages_fetched;
        used_firecrawl = true;
        extraction_method = 'firecrawl';
      } else {
        throw new Error('Firecrawl not available');
      }
    } catch (error) {
      console.log('Firecrawl failed, using heuristic approach:', error.message);
      const heuristicResult = await fetchHeuristic(url, options);
      content = heuristicResult.content;
      pages_fetched = heuristicResult.pages_fetched;
      used_firecrawl = false;
      extraction_method = 'heuristic';
    }

    if (!content) {
      throw new Error('No content could be extracted from the website');
    }

    // Extract data using multiple methods
    const structuredData = extractStructuredData(content);
    const aiData = await extractWithAI(content);
    
    // Combine and deduplicate results
    const allServices = [...structuredData.services, ...aiData.services];
    const allHours = [...structuredData.hours, ...aiData.hours];
    
    // Deduplicate services by name
    const uniqueServices = allServices.filter((service, index, arr) => 
      arr.findIndex(s => s.name.toLowerCase() === service.name.toLowerCase()) === index
    );
    
    // Deduplicate hours by day
    const uniqueHours = allHours.filter((hour, index, arr) => 
      arr.findIndex(h => h.day.toLowerCase() === hour.day.toLowerCase()) === index
    );

    console.log(`Final results: ${uniqueServices.length} services, ${uniqueHours.length} hours entries`);

    // Save to database
    await saveToDatabase(finalTenantId, uniqueServices, uniqueHours);

    const result: ExtractionResult = {
      services: uniqueServices,
      hours: uniqueHours,
      pages_fetched,
      used_firecrawl,
      extraction_method
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Crawl-ingest error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        services: [],
        hours: [],
        pages_fetched: 0,
        used_firecrawl: false,
        extraction_method: 'failed'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
