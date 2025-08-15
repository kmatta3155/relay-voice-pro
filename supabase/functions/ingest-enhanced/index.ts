import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import FirecrawlApp from 'npm:@mendable/firecrawl-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Enhanced Supabase client with proper methods
function createClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return {
    from(table: string) {
      return {
        async insert(data: any) {
          const r = await fetch(`${url}/rest/v1/${table}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${key}`,
              "Content-Type": "application/json",
              "apikey": key,
              "Prefer": "return=representation"
            },
            body: JSON.stringify(data)
          });
          if (!r.ok) throw new Error(`Insert failed: ${await r.text()}`);
          return { data: await r.json(), error: null };
        },
        async select(columns = "*") {
          const r = await fetch(`${url}/rest/v1/${table}?select=${columns}`, {
            headers: { "Authorization": `Bearer ${key}`, "apikey": key }
          });
          if (!r.ok) throw new Error(`Select failed: ${await r.text()}`);
          return { data: await r.json(), error: null };
        }
      };
    }
  };
}

// Extract business information using AI
async function extractBusinessInfo(content: string): Promise<any> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.log("No OpenAI key, skipping business info extraction");
    return {};
  }

  try {
    const prompt = `Extract structured business information from this website content. Return JSON with these fields:
    - business_hours: Array of day/time objects like [{day: "Monday", hours: "9:00 AM - 5:00 PM"}]
    - phone: Primary phone number
    - email: Primary email address
    - address: Physical address
    - services: Array of main services/treatments offered
    - pricing: Any price information found
    - about: Brief business description
    - social_media: Any social media handles/links
    
    Content: ${content.slice(0, 4000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a business information extraction expert. Extract structured data and return valid JSON only." },
          { role: "user", content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return {};
    }

    const result = await response.json();
    const content_text = result.choices[0].message.content;
    
    try {
      // Clean the response to extract JSON
      const jsonMatch = content_text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return {};
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      return {};
    }
  } catch (error) {
    console.error("Business info extraction failed:", error);
    return {};
  }
}

// Generate embeddings for content chunks
async function embedAll(chunks: string[]): Promise<number[][]> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OpenAI API key not found");

  console.log(`Generating embeddings for ${chunks.length} chunks`);

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: chunks
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.data.map((item: any) => item.embedding);
}

// Enhanced content chunking with business context preservation
function chunkTextEnhanced(text: string, businessInfo: any, maxTokens = 500): string[] {
  const chunks: string[] = [];
  
  // Create business info summary chunk if we have extracted data
  if (businessInfo && Object.keys(businessInfo).length > 0) {
    let businessSummary = "Business Information:\n";
    
    if (businessInfo.business_hours?.length) {
      businessSummary += "Hours: " + businessInfo.business_hours.map((h: any) => `${h.day}: ${h.hours}`).join(", ") + "\n";
    }
    if (businessInfo.phone) businessSummary += `Phone: ${businessInfo.phone}\n`;
    if (businessInfo.email) businessSummary += `Email: ${businessInfo.email}\n`;
    if (businessInfo.address) businessSummary += `Address: ${businessInfo.address}\n`;
    if (businessInfo.services?.length) businessSummary += `Services: ${businessInfo.services.join(", ")}\n`;
    if (businessInfo.about) businessSummary += `About: ${businessInfo.about}\n`;
    
    chunks.push(businessSummary);
  }

  // Split remaining content into chunks
  const sentences = text.split(/[.!?]\s+/);
  let currentChunk = "";
  const maxChunkLength = maxTokens * 4; // Rough token estimate

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence + ". ";
    } else {
      currentChunk += sentence + ". ";
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
}

// Create quick answers from business info
async function createQuickAnswers(tenantId: string, businessInfo: any, sb: any) {
  if (!businessInfo || Object.keys(businessInfo).length === 0) return;

  const quickAnswers = [];

  // Business hours
  if (businessInfo.business_hours?.length) {
    const hoursText = businessInfo.business_hours.map((h: any) => `${h.day}: ${h.hours}`).join(", ");
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(hours?|time|open|close|when.*open)",
      question_type: "hours",
      answer: `Our business hours are: ${hoursText}`,
      confidence: 0.95
    });
  }

  // Phone number
  if (businessInfo.phone) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(phone|call|number|contact)",
      question_type: "contact",
      answer: `You can reach us at ${businessInfo.phone}`,
      confidence: 0.9
    });
  }

  // Services
  if (businessInfo.services?.length) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(service|treatment|offer|do)",
      question_type: "services",
      answer: `We offer these services: ${businessInfo.services.join(", ")}`,
      confidence: 0.85
    });
  }

  // Address/Location
  if (businessInfo.address) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(where|location|address|find)",
      question_type: "location",
      answer: `We're located at ${businessInfo.address}`,
      confidence: 0.9
    });
  }

  // Insert quick answers
  for (const qa of quickAnswers) {
    try {
      await sb.from("business_quick_answers").insert(qa);
    } catch (error) {
      console.error("Failed to insert quick answer:", error);
    }
  }

  console.log(`Created ${quickAnswers.length} quick answers`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, site_url, title } = await req.json();
    console.log(`Enhanced ingesting: ${site_url} for tenant: ${tenant_id}`);

    const sb = createClient();
    
    // Initialize Firecrawl
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    let content = "";
    
    if (firecrawlKey) {
      console.log("Using Firecrawl for enhanced scraping");
      try {
        const app = new FirecrawlApp({ apiKey: firecrawlKey });
        const crawlResult = await app.scrapeUrl(site_url, {
          formats: ['markdown', 'html'],
          includeTags: ['h1', 'h2', 'h3', 'p', 'div', 'span', 'li'],
          excludeTags: ['script', 'style', 'nav', 'footer'],
          waitFor: 2000
        });
        
        if (crawlResult.success && crawlResult.data?.markdown) {
          content = crawlResult.data.markdown;
          console.log(`Firecrawl extracted ${content.length} characters`);
        } else {
          throw new Error("Firecrawl failed to extract content");
        }
      } catch (firecrawlError) {
        console.error("Firecrawl failed, falling back to basic fetch:", firecrawlError);
        // Fallback to basic fetch
        const response = await fetch(site_url);
        const html = await response.text();
        content = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } else {
      console.log("No Firecrawl key, using basic fetch");
      const response = await fetch(site_url);
      const html = await response.text();
      content = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    console.log(`Extracted ${content.length} characters`);

    // Extract business information using AI
    console.log("Extracting business information...");
    const businessInfo = await extractBusinessInfo(content);
    console.log("Extracted business info:", businessInfo);

    // Create enhanced chunks with business context
    const chunks = chunkTextEnhanced(content, businessInfo);
    console.log(`Created ${chunks.length} enhanced chunks`);

    // Generate embeddings
    const embeddings = await embedAll(chunks);
    console.log(`Generated ${embeddings.length} embeddings`);

    // Insert source
    const sourceData = {
      tenant_id,
      source_url: site_url,
      title: title || site_url,
      source_type: "web",
      meta: { business_info: businessInfo, crawl_method: firecrawlKey ? "firecrawl" : "basic" }
    };

    const { data: sourceResult } = await sb.from("knowledge_sources").insert(sourceData);
    const sourceId = sourceResult[0].id;
    console.log(`Inserted enhanced source: ${sourceId}`);

    // Insert chunks with embeddings
    const chunkInserts = chunks.map((chunk, i) => ({
      tenant_id,
      source_id: sourceId,
      content: chunk,
      token_count: Math.ceil(chunk.length / 4),
      embedding: embeddings[i],
      meta: { chunk_index: i, has_business_info: i === 0 && Object.keys(businessInfo).length > 0 }
    }));

    await sb.from("knowledge_chunks").insert(chunkInserts);
    console.log(`Inserted ${chunkInserts.length} enhanced chunks`);

    // Create quick answers from business info
    await createQuickAnswers(tenant_id, businessInfo, sb);

    return new Response(JSON.stringify({ 
      success: true, 
      chunks_created: chunks.length,
      business_info_extracted: Object.keys(businessInfo).length > 0,
      source_id: sourceId
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Enhanced ingest error:", error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});