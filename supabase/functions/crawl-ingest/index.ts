
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

  console.log('Using Firecrawl for comprehensive crawling:', url);
  
  const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      limit: options.maxPages || 50,
      scrapeOptions: {
        formats: ['markdown', 'html']
      }
    }),
  });

  if (!crawlResponse.ok) {
    const errorText = await crawlResponse.text();
    console.error('Firecrawl error response:', errorText);
    throw new Error(`Firecrawl API error: ${crawlResponse.status} - ${errorText}`);
  }

  const crawlData = await crawlResponse.json();
  
  if (crawlData.success && crawlData.data) {
    let combinedContent = '';
    let pages_fetched = 0;
    
    for (const page of crawlData.data) {
      if (page.markdown || page.html) {
        const pageUrl = page.metadata?.sourceURL || 'Unknown';
        combinedContent += `\n\n=== PAGE ${pages_fetched + 1}: ${pageUrl} ===\n`;
        
        // Prioritize markdown but include HTML for structured data
        if (page.markdown) {
          combinedContent += page.markdown + '\n';
        }
        if (page.html) {
          combinedContent += `\n[HTML_CONTENT]\n${page.html}\n[/HTML_CONTENT]\n`;
        }
        
        pages_fetched++;
      }
    }
    
    console.log(`Firecrawl extracted comprehensive content from ${pages_fetched} pages`);
    console.log(`Content length: ${combinedContent.length} characters`);
    return { content: combinedContent, pages_fetched };
  }
  
  throw new Error('Firecrawl did not return valid data');
}

async function fetchHeuristic(url: string, options: CrawlOptions): Promise<{ content: string; pages_fetched: number }> {
  console.log('Using comprehensive heuristic crawling for:', url);
  
  const visitedUrls = new Set<string>();
  const toVisit: string[] = [url];
  let combinedContent = '';
  let pages_fetched = 0;
  const maxPages = options.maxPages || 25; // Increased from 5
  
  // Priority patterns for salon/spa websites
  const priorityPatterns = [
    /services?/i, /pricing/i, /packages?/i, /menu/i, /treatments?/i,
    /book/i, /appointment/i, /schedule/i, /about/i, /hours?/i,
    /contact/i, /location/i, /staff/i, /salon/i, /spa/i, /facial/i,
    /massage/i, /hair/i, /nail/i, /skin/i, /beauty/i
  ];
  
  while (toVisit.length > 0 && pages_fetched < maxPages) {
    const currentUrl = toVisit.shift()!;
    
    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);
    
    try {
      console.log(`Fetching page ${pages_fetched + 1}: ${currentUrl}`);
      
      const response = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Business-Info-Extractor/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!response.ok) {
        console.log(`Skipping ${currentUrl}: HTTP ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      combinedContent += `\n\n=== PAGE ${pages_fetched + 1}: ${currentUrl} ===\n${html}`;
      pages_fetched++;
      
      // Extract additional URLs for crawling with priority scoring
      if (pages_fetched < maxPages) {
        const foundUrls: { url: string; priority: number }[] = [];
        const urlPattern = /href=["']([^"']+)["']/gi;
        let match;
        
        while ((match = urlPattern.exec(html)) !== null) {
          let foundUrl = match[1].trim();
          
          // Skip non-relevant URLs
          if (foundUrl.startsWith('#') || foundUrl.startsWith('mailto:') || 
              foundUrl.startsWith('tel:') || foundUrl.startsWith('javascript:')) {
            continue;
          }
          
          // Convert relative URLs to absolute
          if (foundUrl.startsWith('/')) {
            const baseUrl = new URL(currentUrl).origin;
            foundUrl = baseUrl + foundUrl;
          } else if (!foundUrl.startsWith('http')) {
            const baseUrl = new URL(currentUrl);
            foundUrl = new URL(foundUrl, baseUrl.href).href;
          }
          
          // Only process URLs from the same domain
          try {
            const foundDomain = new URL(foundUrl).hostname;
            const currentDomain = new URL(currentUrl).hostname;
            if (foundDomain !== currentDomain) continue;
          } catch {
            continue;
          }
          
          // Skip already visited URLs
          if (visitedUrls.has(foundUrl)) continue;
          
          // Calculate priority based on URL content
          let priority = 0;
          const urlLower = foundUrl.toLowerCase();
          
          priorityPatterns.forEach(pattern => {
            if (pattern.test(urlLower)) priority += 10;
          });
          
          // Boost priority for pages that might contain service info
          if (urlLower.includes('service') || urlLower.includes('treatment') || 
              urlLower.includes('pricing') || urlLower.includes('package')) {
            priority += 20;
          }
          
          // Lower priority for admin/system pages
          if (urlLower.includes('admin') || urlLower.includes('login') || 
              urlLower.includes('wp-') || urlLower.includes('blog')) {
            priority -= 20;
          }
          
          foundUrls.push({ url: foundUrl, priority });
        }
        
        // Sort by priority and add to visit queue
        foundUrls.sort((a, b) => b.priority - a.priority);
        foundUrls.slice(0, 10).forEach(item => { // Limit to top 10 per page
          if (!toVisit.includes(item.url)) {
            toVisit.push(item.url);
          }
        });
      }
    } catch (error) {
      console.error(`Failed to fetch ${currentUrl}:`, error);
    }
    
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log(`Heuristic crawling extracted content from ${pages_fetched} pages`);
  console.log(`Total content length: ${combinedContent.length} characters`);
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
  
  console.log('Using OpenAI for comprehensive content extraction');
  console.log(`Processing ${content.length} characters of content`);
  
  // Split content into chunks to process more data
  const maxChunkSize = 30000; // Increased from 15000
  const chunks = [];
  for (let i = 0; i < content.length; i += maxChunkSize) {
    chunks.push(content.slice(i, i + maxChunkSize));
  }
  
  console.log(`Processing ${chunks.length} content chunks`);
  
  let allServices: ExtractedService[] = [];
  let allHours: ExtractedHours[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const prompt = `You are a business data extraction expert. Extract ALL services, treatments, packages, and business hours from this salon/spa website content. Be comprehensive and capture every service offered.

CRITICAL INSTRUCTIONS:
1. Extract EVERY service, treatment, package, and offering mentioned
2. Include service packages, bundles, and individual treatments
3. Look for pricing information in multiple formats ($X, $XX.XX, etc.)
4. Extract duration from text like "60 minutes", "1 hour", "90 min"
5. Find business hours from any mention of opening/closing times
6. Include special services, seasonal offerings, and promotions

Return ONLY valid JSON:
{
  "services": [
    {
      "name": "Complete Service Name",
      "description": "Detailed description if available",
      "price": "$XX.XX",
      "duration_minutes": 60
    }
  ],
  "hours": [
    {
      "day": "Monday",
      "open_time": "10:00 AM",
      "close_time": "7:00 PM",
      "is_closed": false
    }
  ]
}

PRICING EXTRACTION RULES:
- Extract all price formats: $50, $50.00, 50.00, etc.
- For price ranges like "$50-80", use the starting price
- For packages, extract the package price
- If no price found, omit the price field

HOURS EXTRACTION RULES:
- Convert all time formats to 12-hour (9:00 AM, 5:30 PM)
- Handle ranges like "10AM-7PM" or "10:00-19:00"
- If a day is not mentioned, don't include it
- Sunday closure should be marked as is_closed: true

Website Content Chunk ${i + 1}:
${chunk}`;

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
          max_tokens: 3000, // Increased for more comprehensive extraction
          temperature: 0.1, // Lower temperature for more consistent extraction
        }),
      });

      if (!response.ok) {
        console.error(`OpenAI API error for chunk ${i + 1}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      let aiResponse = data.choices[0].message.content.trim();
      
      // Remove code fences if present
      aiResponse = aiResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      aiResponse = aiResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      
      const parsed = JSON.parse(aiResponse);
      
      if (parsed.services && Array.isArray(parsed.services)) {
        allServices.push(...parsed.services);
      }
      if (parsed.hours && Array.isArray(parsed.hours)) {
        allHours.push(...parsed.hours);
      }
      
      console.log(`Chunk ${i + 1} extracted: ${parsed.services?.length || 0} services, ${parsed.hours?.length || 0} hours`);
      
    } catch (error) {
      console.error(`AI extraction failed for chunk ${i + 1}:`, error);
      continue;
    }
    
    // Add small delay between requests to avoid rate limits
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Deduplicate services by name (case insensitive)
  const uniqueServices = allServices.filter((service, index, arr) => 
    arr.findIndex(s => s.name.toLowerCase().trim() === service.name.toLowerCase().trim()) === index
  );
  
  // Deduplicate hours by day
  const uniqueHours = allHours.filter((hour, index, arr) => 
    arr.findIndex(h => h.day.toLowerCase() === hour.day.toLowerCase()) === index
  );
  
  console.log(`Final AI extraction: ${uniqueServices.length} unique services, ${uniqueHours.length} unique hours`);
  
  return {
    services: uniqueServices,
    hours: uniqueHours
  };
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
