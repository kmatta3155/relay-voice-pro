// deno-lint-ignore-file no-explicit-any
/**
 * AI-Powered Business Intelligence Extraction Service
 * - Crawls business websites with intelligent routing
 * - Uses OpenAI GPT for structured data extraction
 * - Extracts services, pricing, business hours, and contact info
 * - Provides SaaS-grade error handling and logging
 */
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://esm.sh/linkedom@0.16.10/worker";

// Types
interface CrawlOptions {
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
}

interface ExtractedService {
  name: string;
  description?: string;
  price?: number | string;
  duration?: number;
  category?: string;
}

interface ExtractedHours {
  day: string;
  opens: string;
  closes: string;
  isClosed?: boolean;
}

interface ExtractedBusinessInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  services: ExtractedService[];
  businessHours: ExtractedHours[];
  description?: string;
}

interface CrawlPayload {
  tenantId: string;
  url: string;
  options?: CrawlOptions;
}

// Configuration
const DEFAULTS: Required<CrawlOptions> = {
  includeSubdomains: true,
  respectRobots: true,
  followSitemaps: true,
  maxPages: 50,
  maxDepth: 3,
  rateLimitMs: 500,
  allowPatterns: ["services", "pricing", "packages", "menu", "treatment", "book", "appointment", "schedule", "about"],
  denyPatterns: ["\\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mp3)$", "wp-admin", "login", "register"],
  includeBookingProviders: true,
  extraAllowedHosts: [],
};

const BOOKING_HOSTS = new Set([
  "square.site", "squareup.com", "vagaro.com", "fresha.com", "myfresha.com",
  "boulevard.io", "blvd.co", "mindbodyonline.com", "mindbody.io",
  "glossgenius.com", "acuityscheduling.com", "calendly.com"
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize clients
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openaiKey = Deno.env.get('OPENAI_API_KEY');

if (!supabaseUrl || !supabaseServiceKey || !openaiKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Utility functions
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function isAllowedHost(url: string, baseUrl: string, options: Required<CrawlOptions>): boolean {
  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);
    
    // Check booking providers
    if (options.includeBookingProviders && BOOKING_HOSTS.has(urlObj.hostname)) {
      return true;
    }
    
    // Check extra allowed hosts
    if (options.extraAllowedHosts.includes(urlObj.hostname)) {
      return true;
    }
    
    // Check same domain or subdomain
    if (options.includeSubdomains) {
      return urlObj.hostname === baseObj.hostname || urlObj.hostname.endsWith('.' + baseObj.hostname);
    }
    
    return urlObj.hostname === baseObj.hostname;
  } catch {
    return false;
  }
}

function shouldCrawlUrl(url: string, options: Required<CrawlOptions>): boolean {
  // Check deny patterns
  for (const pattern of options.denyPatterns) {
    if (new RegExp(pattern, 'i').test(url)) {
      return false;
    }
  }
  
  // Check allow patterns (if any specified)
  if (options.allowPatterns.length > 0) {
    return options.allowPatterns.some(pattern => 
      new RegExp(pattern, 'i').test(url)
    );
  }
  
  return true;
}

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AI-Receptionist-Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      console.log(`Fetch attempt ${i + 1} failed for ${url}:`, error.message);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('All fetch attempts failed');
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links: string[] = [];
    
    // Extract from anchor tags
    const anchors = doc.querySelectorAll('a[href]');
    for (const anchor of Array.from(anchors)) {
      try {
        const href = anchor.getAttribute('href');
        if (href) {
          const absoluteUrl = new URL(href, baseUrl).toString();
          links.push(absoluteUrl);
        }
      } catch {
        // Skip invalid URLs
      }
    }
    
    // Extract from iframes (booking widgets)
    const iframes = doc.querySelectorAll('iframe[src]');
    for (const iframe of Array.from(iframes)) {
      try {
        const src = iframe.getAttribute('src');
        if (src) {
          const absoluteUrl = new URL(src, baseUrl).toString();
          links.push(absoluteUrl);
        }
      } catch {
        // Skip invalid URLs
      }
    }
    
    return [...new Set(links)]; // Remove duplicates
  } catch (error) {
    console.error('Error extracting links:', error);
    return [];
  }
}

async function callOpenAI(prompt: string, systemPrompt: string): Promise<any> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid response from OpenAI');
    }

    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    throw error;
  }
}

async function extractBusinessInfoWithAI(htmlContent: string, url: string): Promise<ExtractedBusinessInfo> {
  const systemPrompt = `You are an AI assistant that extracts business information from website content. 
Extract the following information and return it as valid JSON:

{
  "name": "Business name",
  "phone": "Phone number in format (xxx) xxx-xxxx",
  "email": "Email address",
  "address": "Full address",
  "website": "Website URL",
  "description": "Brief business description",
  "services": [
    {
      "name": "Service name",
      "description": "Service description",
      "price": "Price as number or string",
      "duration": "Duration in minutes as number",
      "category": "Service category"
    }
  ],
  "businessHours": [
    {
      "day": "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday",
      "opens": "HH:MM AM/PM",
      "closes": "HH:MM AM/PM",
      "isClosed": false
    }
  ]
}

Rules:
- Extract only factual information present in the content
- For services, look for pricing, treatments, packages, menus
- For hours, look for operating hours, business hours, store hours
- Use null for missing information
- Ensure valid JSON format
- Be conservative - only extract clear, unambiguous information`;

  const prompt = `Extract business information from this website content:

URL: ${url}

Content:
${htmlContent.slice(0, 8000)}...`;

  try {
    return await callOpenAI(prompt, systemPrompt);
  } catch (error) {
    console.error('AI extraction failed:', error);
    return {
      services: [],
      businessHours: [],
    };
  }
}

function extractStructuredData(html: string): Partial<ExtractedBusinessInfo> {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    
    for (const script of Array.from(scripts)) {
      try {
        const data = JSON.parse(script.textContent || '');
        
        if (data['@type'] === 'LocalBusiness' || data['@type'] === 'Organization') {
          const extracted: Partial<ExtractedBusinessInfo> = {
            name: data.name,
            phone: data.telephone,
            email: data.email,
            address: typeof data.address === 'string' ? data.address : 
                    data.address ? `${data.address.streetAddress || ''} ${data.address.addressLocality || ''} ${data.address.addressRegion || ''} ${data.address.postalCode || ''}`.trim() : undefined,
            website: data.url,
            description: data.description,
            services: [],
            businessHours: [],
          };
          
          // Extract opening hours
          if (data.openingHours || data.openingHoursSpecification) {
            const hours = data.openingHours || data.openingHoursSpecification;
            if (Array.isArray(hours)) {
              extracted.businessHours = hours.map((hour: any) => ({
                day: hour.dayOfWeek || hour.days,
                opens: hour.opens,
                closes: hour.closes,
                isClosed: false
              })).filter(h => h.day && h.opens && h.closes);
            }
          }
          
          return extracted;
        }
      } catch (error) {
        console.log('Error parsing structured data:', error);
      }
    }
    
    return { services: [], businessHours: [] };
  } catch (error) {
    console.error('Error extracting structured data:', error);
    return { services: [], businessHours: [] };
  }
}

async function crawlWebsite(startUrl: string, options: Required<CrawlOptions>): Promise<{ pages: Array<{ url: string; content: string }>, totalPages: number }> {
  const visited = new Set<string>();
  const toVisit: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const pages: Array<{ url: string; content: string }> = [];
  
  console.log(`Starting crawl of ${startUrl} with options:`, options);
  
  while (toVisit.length > 0 && pages.length < options.maxPages) {
    const { url, depth } = toVisit.shift()!;
    
    if (visited.has(url) || depth > options.maxDepth) {
      continue;
    }
    
    visited.add(url);
    
    try {
      console.log(`Crawling (depth ${depth}): ${url}`);
      
      const html = await fetchWithRetry(url);
      pages.push({ url, content: html });
      
      // Extract links for next level
      if (depth < options.maxDepth) {
        const links = extractLinksFromHtml(html, url);
        
        for (const link of links) {
          const normalizedLink = normalizeUrl(link);
          
          if (!visited.has(normalizedLink) && 
              isAllowedHost(normalizedLink, startUrl, options) &&
              shouldCrawlUrl(normalizedLink, options)) {
            toVisit.push({ url: normalizedLink, depth: depth + 1 });
          }
        }
      }
      
      // Rate limiting
      if (options.rateLimitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, options.rateLimitMs));
      }
      
    } catch (error) {
      console.error(`Failed to crawl ${url}:`, error.message);
    }
  }
  
  console.log(`Crawl completed. Visited ${pages.length} pages out of ${visited.size} discovered URLs.`);
  return { pages, totalPages: pages.length };
}

async function saveToDatabase(tenantId: string, businessInfo: ExtractedBusinessInfo, pages: Array<{ url: string; content: string }>) {
  try {
    // Save knowledge source
    const { data: sourceData, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert({
        tenant_id: tenantId,
        source_url: pages[0]?.url,
        title: businessInfo.name || 'Website Content',
        source_type: 'web',
        meta: {
          pages_crawled: pages.length,
          business_info: businessInfo,
          extraction_date: new Date().toISOString(),
        }
      })
      .select()
      .single();

    if (sourceError) {
      throw new Error(`Failed to save knowledge source: ${sourceError.message}`);
    }

    // Save business hours
    if (businessInfo.businessHours?.length > 0) {
      const hoursToInsert = businessInfo.businessHours.map(hour => ({
        tenant_id: tenantId,
        dow: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(hour.day.toLowerCase()),
        open_time: hour.opens,
        close_time: hour.closes,
      })).filter(h => h.dow >= 0);

      if (hoursToInsert.length > 0) {
        // Delete existing hours first
        await supabase.from('business_hours').delete().eq('tenant_id', tenantId);
        
        const { error: hoursError } = await supabase
          .from('business_hours')
          .insert(hoursToInsert);

        if (hoursError) {
          console.error('Failed to save business hours:', hoursError);
        }
      }
    }

    // Save services
    if (businessInfo.services?.length > 0) {
      const servicesToInsert = businessInfo.services.map(service => ({
        tenant_id: tenantId,
        name: service.name,
        price: typeof service.price === 'number' ? service.price : parseFloat(String(service.price || '0').replace(/[^\d.]/g, '')) || null,
        duration_minutes: service.duration || 30,
      }));

      const { error: servicesError } = await supabase
        .from('services')
        .upsert(servicesToInsert, { onConflict: 'tenant_id,name' });

      if (servicesError) {
        console.error('Failed to save services:', servicesError);
      }
    }

    // Generate and save quick answers
    const quickAnswers = [
      {
        tenant_id: tenantId,
        question_type: 'hours',
        question_pattern: '(hours|open|close|time|when)',
        answer: businessInfo.businessHours?.length > 0 
          ? businessInfo.businessHours.map(h => `${h.day}: ${h.opens} - ${h.closes}`).join(', ')
          : 'Please contact us for our current business hours.',
        confidence: 0.9
      },
      {
        tenant_id: tenantId,
        question_type: 'services',
        question_pattern: '(service|treatment|price|cost|menu)',
        answer: businessInfo.services?.length > 0
          ? `We offer: ${businessInfo.services.map(s => s.name + (s.price ? ` ($${s.price})` : '')).join(', ')}`
          : 'Please contact us to learn about our services.',
        confidence: 0.8
      },
      {
        tenant_id: tenantId,
        question_type: 'contact',
        question_pattern: '(phone|call|contact|number)',
        answer: businessInfo.phone || 'Please use the contact form on our website.',
        confidence: 0.9
      }
    ];

    // Delete existing quick answers
    await supabase.from('business_quick_answers').delete().eq('tenant_id', tenantId);
    
    const { error: answersError } = await supabase
      .from('business_quick_answers')
      .insert(quickAnswers);

    if (answersError) {
      console.error('Failed to save quick answers:', answersError);
    }

    console.log(`Successfully saved data for tenant ${tenantId}`);
    return sourceData;

  } catch (error) {
    console.error('Database save error:', error);
    throw error;
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: CrawlPayload = await req.json();
    const { tenantId, url, options = {} } = payload;

    if (!tenantId || !url) {
      return new Response(JSON.stringify({ error: 'Missing tenantId or url' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const finalOptions = { ...DEFAULTS, ...options };
    
    console.log(`Starting extraction for tenant ${tenantId} from ${url}`);

    // Step 1: Crawl the website
    const { pages, totalPages } = await crawlWebsite(url, finalOptions);
    
    if (pages.length === 0) {
      return new Response(JSON.stringify({ error: 'No pages could be crawled' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Extract business information using AI
    const combinedContent = pages.map(p => p.content).join('\n\n').slice(0, 15000);
    const structuredData = extractStructuredData(pages[0].content);
    const aiExtracted = await extractBusinessInfoWithAI(combinedContent, url);
    
    // Merge structured data with AI extraction
    const businessInfo: ExtractedBusinessInfo = {
      name: structuredData.name || aiExtracted.name,
      phone: structuredData.phone || aiExtracted.phone,
      email: structuredData.email || aiExtracted.email,
      address: structuredData.address || aiExtracted.address,
      website: structuredData.website || aiExtracted.website || url,
      description: structuredData.description || aiExtracted.description,
      services: [...(structuredData.services || []), ...(aiExtracted.services || [])],
      businessHours: [...(structuredData.businessHours || []), ...(aiExtracted.businessHours || [])],
    };

    // Step 3: Save to database
    const sourceData = await saveToDatabase(tenantId, businessInfo, pages);

    // Step 4: Return results
    const response = {
      success: true,
      data: {
        sourceId: sourceData.id,
        businessInfo,
        pagesCrawled: totalPages,
        extractedServices: businessInfo.services?.length || 0,
        extractedHours: businessInfo.businessHours?.length || 0,
      }
    };

    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Crawl-ingest error:', error);
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.stack?.split('\n').slice(0, 5).join('\n')
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});