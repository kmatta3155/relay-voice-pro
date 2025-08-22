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

if (!supabaseUrl || !supabaseServiceKey || !openaiKey) {
  console.error('Missing environment variables');
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

async function extractWithAI(htmlContent: string, url: string): Promise<ExtractedBusinessInfo> {
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
${htmlContent.slice(0, 10000)}`;

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
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content from OpenAI');
    }

    return JSON.parse(content);
  } catch (error) {
    console.error('AI extraction failed:', error);
    return {
      services: [],
      businessHours: [],
    };
  }
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