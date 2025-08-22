import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenantId, text } = await req.json();

    if (!tenantId || !text) {
      return new Response(JSON.stringify({ error: 'Missing tenantId or text' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Starting text extraction for tenant: ${tenantId}`);
    console.log(`Text length: ${text.length} characters`);

    // Process the text with OpenAI
    const prompt = `You are a business data extraction expert. Extract ALL services, treatments, packages, business hours, and business information from this business text content. Be comprehensive but filter out junk data.

CRITICAL INSTRUCTIONS:
1. Extract ONLY legitimate services, treatments, packages - NOT navigation text, headers, or contact info
2. Filter out fragments like "feel free to call", "you can reach us", "we have two locations" 
3. Look for actual service names like "Haircut", "Color Treatment", "Facial", "Massage"
4. Extract business addresses, phone numbers, and contact information
5. Find business hours from any mention of opening/closing times
6. If no explicit prices exist, do NOT make up prices - omit price field entirely

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
  ],
  "business_info": {
    "name": "Business Name",
    "addresses": ["Full address 1", "Full address 2"],
    "phone": "Phone number",
    "email": "Email address"
  }
}

SERVICE EXTRACTION RULES:
- ONLY extract actual service names, not contact information or location details
- Skip fragments, partial sentences, and navigation text
- Look for clear service categories like cuts, color, treatments, facials, etc.
- If a service name is longer than 100 characters, it's likely junk data - skip it

PRICING RULES:
- Extract explicit prices only: $50, $50.00, 50.00, etc.
- For price ranges like "$50-80", use the starting price  
- If NO pricing information exists on the site, omit all price fields
- Do NOT assign arbitrary high prices like $2409 or $832

ADDRESS EXTRACTION:
- Look for complete street addresses with city, state
- Extract ALL locations if multiple addresses exist
- Include zip codes when available

HOURS EXTRACTION RULES:
- Convert all time formats to 12-hour (9:00 AM, 5:30 PM)
- Handle ranges like "10AM-7PM" or "10:00-19:00"
- If a day is not mentioned, don't include it
- Mark closed days as is_closed: true

Business Text Content:
${text}`;

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
    
    const parsed = JSON.parse(aiResponse);
    
    console.log(`Extracted ${parsed.services?.length || 0} services, ${parsed.hours?.length || 0} hours`);

    // Save services to database
    if (parsed.services && parsed.services.length > 0) {
      const servicesToInsert = parsed.services.map((service: any) => ({
        tenant_id: tenantId,
        name: service.name,
        description: service.description || null,
        price: service.price ? parseFloat(service.price.replace(/[^\d.]/g, '')) : null,
        duration_minutes: service.duration_minutes || 30,
        active: true
      }));

      const { error: servicesError } = await supabase
        .from('services')
        .upsert(servicesToInsert, { 
          onConflict: 'tenant_id,name',
          ignoreDuplicates: false 
        });

      if (servicesError) {
        console.error('Error saving services:', servicesError);
      } else {
        console.log(`Successfully saved ${servicesToInsert.length} services`);
      }
    }

    // Save business hours to database
    if (parsed.hours && parsed.hours.length > 0) {
      const hoursToInsert = parsed.hours.map((hour: any) => {
        const dayMap: { [key: string]: number } = {
          'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
          'friday': 5, 'saturday': 6, 'sunday': 0
        };

        return {
          tenant_id: tenantId,
          dow: dayMap[hour.day.toLowerCase()] ?? 1,
          open_time: hour.is_closed ? null : hour.open_time,
          close_time: hour.is_closed ? null : hour.close_time,
          is_closed: hour.is_closed || false
        };
      });

      const { error: hoursError } = await supabase
        .from('business_hours')
        .upsert(hoursToInsert, { 
          onConflict: 'tenant_id,dow',
          ignoreDuplicates: false 
        });

      if (hoursError) {
        console.error('Error saving business hours:', hoursError);
      } else {
        console.log(`Successfully saved ${hoursToInsert.length} business hours`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      services: parsed.services || [],
      hours: parsed.hours || [],
      business_info: parsed.business_info || {},
      text_length: text.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in text-extract function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});