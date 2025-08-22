// deno-lint-ignore-file no-explicit-any
/**
 * Simplified AI-Powered Business Intelligence Extraction Service
 */
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://esm.sh/linkedom@0.16.10/worker";

// Types
interface ExtractedService {
  name: string;
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

// Configuration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize clients
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openaiKey = Deno.env.get('OPENAI_API_KEY');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
}

if (!openaiKey) {
  console.log('OpenAI API key not found, will use fallback extraction');
}

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

async function fetchWebsite(url: string): Promise<string> {
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
    console.error(`Failed to fetch ${url}:`, error);
    throw error;
  }
}

function extractStructuredData(htmlContent: string): Partial<ExtractedBusinessInfo> {
  const result: Partial<ExtractedBusinessInfo> = {};
  
  // Extract JSON-LD structured data
  const jsonLdMatches = htmlContent.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      try {
        const jsonLdContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim();
        const jsonLd = JSON.parse(jsonLdContent);
        
        if (jsonLd['@type'] === 'LocalBusiness' || jsonLd['@type'] === 'Organization') {
          if (jsonLd.name) result.name = jsonLd.name;
          if (jsonLd.telephone) result.phone = jsonLd.telephone;
          if (jsonLd.email) result.email = jsonLd.email;
          if (jsonLd.description) result.description = jsonLd.description;
          
          if (jsonLd.address) {
            result.address = typeof jsonLd.address === 'string' ? 
              jsonLd.address : 
              `${jsonLd.address.streetAddress || ''} ${jsonLd.address.addressLocality || ''} ${jsonLd.address.addressRegion || ''} ${jsonLd.address.postalCode || ''}`.trim();
          }
          
          if (jsonLd.openingHoursSpecification) {
            const hours = Array.isArray(jsonLd.openingHoursSpecification) ? 
              jsonLd.openingHoursSpecification : [jsonLd.openingHoursSpecification];
            
            result.businessHours = hours.map((h: any) => ({
              day: h.dayOfWeek?.replace('https://schema.org/', '') || h.dayOfWeek,
              opens: h.opens,
              closes: h.closes,
              isClosed: false
            }));
          }
        }
      } catch (e) {
        console.log('Failed to parse JSON-LD section:', e);
      }
    }
  }
  
  // Extract basic info from HTML if not found in structured data
  if (!result.name) {
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) result.name = titleMatch[1].trim().replace(/\s+/g, ' ');
  }
  
  // Extract phone numbers
  if (!result.phone) {
    const phoneMatch = htmlContent.match(/(?:tel:|phone:|call:)\s*([+\d\s\-\(\)\.]+)/i) ||
                     htmlContent.match(/(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/);
    if (phoneMatch) result.phone = phoneMatch[1].trim();
  }
  
  // Extract email
  if (!result.email) {
    const emailMatch = htmlContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) result.email = emailMatch[0];
  }
  
  return result;
}

async function extractWithAI(htmlContent: string, url: string): Promise<ExtractedBusinessInfo> {
  // First try structured data extraction
  const structuredData = extractStructuredData(htmlContent);
  console.log('Structured data extracted:', structuredData);
  
  // If we have OpenAI API key, enhance with AI
  if (openaiKey && openaiKey !== 'your-openai-api-key') {
    try {
      const systemPrompt = `You are an AI that extracts business information from website content. 
Extract information and return valid JSON in this exact format:

{
  "name": "Business name or null",
  "phone": "Phone number or null", 
  "email": "Email address or null",
  "address": "Full address or null",
  "website": "Website URL or null",
  "description": "Brief description or null",
  "services": [
    {
      "name": "Service name",
      "price": "Price as number or string",
      "duration": "Duration in minutes as number",
      "category": "Service category or null"
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

Only extract factual information. Use null for missing data. Return valid JSON only.`;

      const prompt = `Extract business information from this website:

URL: ${url}

Content:
${htmlContent.slice(0, 8000)}`;

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

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (content) {
          const aiData = JSON.parse(content);
          console.log('AI extracted data:', aiData);
          
          // Merge AI data with structured data, prioritizing AI data
          return {
            name: aiData.name || structuredData.name || 'Business',
            phone: aiData.phone || structuredData.phone || null,
            email: aiData.email || structuredData.email || null,
            address: aiData.address || structuredData.address || null,
            website: url,
            description: aiData.description || structuredData.description || 'Business information extracted from website',
            services: aiData.services || [],
            businessHours: aiData.businessHours || structuredData.businessHours || []
          };
        }
      } else {
        console.error(`OpenAI API error: ${response.status}`);
      }
    } catch (error) {
      console.error('AI extraction failed, using structured data only:', error);
    }
  } else {
    console.log('No OpenAI API key, using structured data extraction only');
  }
  
  // Fallback to structured data only
  return {
    name: structuredData.name || 'Business',
    phone: structuredData.phone || null,
    email: structuredData.email || null,
    address: structuredData.address || null,
    website: url,
    description: structuredData.description || 'Business information extracted from website',
    services: [],
    businessHours: structuredData.businessHours || []
  };
}

async function saveToDatabase(tenantId: string, businessInfo: ExtractedBusinessInfo, url: string) {
  try {
    // Save knowledge source
    const { data: sourceData, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert({
        tenant_id: tenantId,
        source_url: url,
        title: businessInfo.name || 'Website Content',
        source_type: 'web',
        meta: {
          business_info: businessInfo,
          extraction_date: new Date().toISOString(),
        }
      })
      .select()
      .single();

    if (sourceError) {
      console.error('Failed to save knowledge source:', sourceError);
    }

    // Save business hours
    if (businessInfo.businessHours?.length > 0) {
      const dayMap: { [key: string]: number } = {
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 
        'thursday': 4, 'friday': 5, 'saturday': 6
      };

      const hoursToInsert = businessInfo.businessHours
        .map(hour => {
          const dow = dayMap[hour.day.toLowerCase()];
          if (dow === undefined) return null;
          
          return {
            tenant_id: tenantId,
            dow,
            open_time: hour.opens,
            close_time: hour.closes,
          };
        })
        .filter(Boolean);

      if (hoursToInsert.length > 0) {
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
        price: typeof service.price === 'number' ? service.price : 
               parseFloat(String(service.price || '0').replace(/[^\d.]/g, '')) || null,
        duration_minutes: service.duration || 30,
      }));

      const { error: servicesError } = await supabase
        .from('services')
        .upsert(servicesToInsert, { onConflict: 'tenant_id,name' });

      if (servicesError) {
        console.error('Failed to save services:', servicesError);
      }
    }

    // Generate quick answers
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
      }
    ];

    await supabase.from('business_quick_answers').delete().eq('tenant_id', tenantId);
    
    const { error: answersError } = await supabase
      .from('business_quick_answers')
      .insert(quickAnswers);

    if (answersError) {
      console.error('Failed to save quick answers:', answersError);
    }

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
    const { tenantId, url } = await req.json();

    if (!tenantId || !url) {
      return new Response(JSON.stringify({ error: 'Missing tenantId or url' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Starting extraction for tenant ${tenantId} from ${url}`);

    // Step 1: Fetch the website
    const htmlContent = await fetchWebsite(url);
    
    // Step 2: Extract business information using AI
    const businessInfo = await extractWithAI(htmlContent, url);
    
    // Step 3: Save to database
    await saveToDatabase(tenantId, businessInfo, url);

    // Step 4: Return results
    const response = {
      success: true,
      data: {
        businessInfo,
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
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});