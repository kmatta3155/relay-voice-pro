import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
        },
        async delete() {
          return {
            eq(column: string, value: any) {
              return {
                async execute() {
                  const r = await fetch(`${url}/rest/v1/${table}?${column}=eq.${value}`, {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${key}`, "apikey": key }
                  });
                  if (!r.ok) throw new Error(`Delete failed: ${await r.text()}`);
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
}

// Enhanced structured data extraction function
function extractStructuredData(content: string): any {
  const businessInfo: any = {};
  
  try {
    // Extract JSON-LD structured data
    const jsonLdMatches = content.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonContent = match.replace(/<script[^>]*>/gi, '').replace(/<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          
          if (data['@type'] === 'LocalBusiness' || data['@type'] === 'Organization') {
            if (data.openingHours) businessInfo.business_hours = data.openingHours;
            if (data.telephone) businessInfo.phone = data.telephone;
            if (data.email) businessInfo.email = data.email;
            if (data.address) businessInfo.address = typeof data.address === 'string' ? data.address : JSON.stringify(data.address);
          }
        } catch (e) {
          console.log("Failed to parse JSON-LD:", e);
        }
      }
    }
    
    // Extract microdata (basic)
    const phoneRegex = /(?:phone|tel|call).*?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/gi;
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const hoursRegex = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday).*?(\d{1,2}:\d{2}\s*(?:am|pm)?.*?\d{1,2}:\d{2}\s*(?:am|pm)?)/gi;
    
    if (!businessInfo.phone) {
      const phoneMatch = content.match(phoneRegex);
      if (phoneMatch) businessInfo.phone = phoneMatch[0].replace(/.*?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}).*/, '$1');
    }
    
    if (!businessInfo.email) {
      const emailMatch = content.match(emailRegex);
      if (emailMatch) businessInfo.email = emailMatch[0];
    }
    
    if (!businessInfo.business_hours) {
      const hoursMatches = [...content.matchAll(hoursRegex)];
      if (hoursMatches.length > 0) {
        businessInfo.business_hours = hoursMatches.map(match => ({
          day: match[1].charAt(0).toUpperCase() + match[1].slice(1),
          hours: match[2].trim()
        }));
      }
    }
    
  } catch (error) {
    console.error("Structured data extraction error:", error);
  }
  
  return businessInfo;
}

// Extract business information using AI + structured data
async function extractBusinessInfo(content: string): Promise<any> {
  // First try structured data extraction
  const structuredData = extractStructuredData(content);
  
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.log("No OpenAI key, using structured data only");
    return structuredData;
  }

  try {
    const prompt = `Extract business information from this content. Focus on accuracy over completeness.
    Return JSON with ONLY the fields you find:
    - business_hours: Array like [{day: "Monday", hours: "9:00 AM - 5:00 PM"}] (be precise with formatting)
    - phone: Primary phone number (format: XXX-XXX-XXXX)
    - email: Primary business email
    - address: Complete physical address
    - services: Array of main services offered (max 10)
    - pricing: Brief pricing info if clearly stated
    - about: 1-2 sentence business description
    
    Content: ${content.slice(0, 6000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Extract only clearly stated business information. Return valid JSON. If unsure about hours format, use 24hr format or common business format." },
          { role: "user", content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return structuredData;
    }

    const result = await response.json();
    const content_text = result.choices[0].message.content;
    
    try {
      const jsonMatch = content_text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const aiData = JSON.parse(jsonMatch[0]);
        // Merge structured data with AI extraction, preferring structured data
        return { ...aiData, ...structuredData };
      }
      return structuredData;
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      return structuredData;
    }
  } catch (error) {
    console.error("Business info extraction failed:", error);
    return structuredData;
  }
}

// Generate embeddings for content chunks
async function embedAll(chunks: string[]): Promise<number[][]> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OpenAI API key not found");

  console.log(`Generating embeddings for ${chunks.length} chunks`);

  // Process chunks in smaller batches to avoid token limits
  const embeddings: any[] = [];
  const BATCH_SIZE = 3; // Reduce batch size to avoid token limits
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: batch
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embeddings ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    embeddings.push(...result.data.map((item: any) => item.embedding));
    
    console.log(`Generated ${result.data.length} embeddings for batch ${Math.floor(i/BATCH_SIZE) + 1}`);
  }

  console.log(`Generated ${embeddings.length} embeddings total`);
  return embeddings;
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

  // Hard cap any oversized chunk to avoid embedding token errors
  const hardCap = maxChunkLength; // same as above
  const normalized: string[] = [];
  for (const c of chunks) {
    if (c.length <= hardCap) {
      normalized.push(c);
    } else {
      for (let i = 0; i < c.length; i += hardCap) {
        normalized.push(c.slice(i, i + hardCap));
      }
    }
  }

  return normalized.filter(chunk => chunk.length > 50); // Filter out very short chunks
}

// Create comprehensive quick answers from business info
async function createQuickAnswers(tenantId: string, businessInfo: any, sb: any) {
  if (!businessInfo || Object.keys(businessInfo).length === 0) return;

  // Clear existing quick answers for this tenant first
  try {
    await sb.from("business_quick_answers").delete().eq("tenant_id", tenantId).execute();
    console.log("Cleared existing quick answers");
  } catch (error) {
    console.log("Could not clear existing quick answers:", error);
  }

  const quickAnswers = [];

  // Enhanced business hours patterns
  if (businessInfo.business_hours?.length) {
    const hoursText = businessInfo.business_hours.map((h: any) => `${h.day}: ${h.hours}`).join(", ");
    
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(what are|when are|business hours?|opening hours?|hours of operation|what time|when.*open|when.*close)",
      question_type: "hours",
      answer: `Our business hours are: ${hoursText}`,
      confidence: 0.98
    });
    
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(open|close|schedule|hours today|hours tomorrow)",
      question_type: "hours",
      answer: `We're open: ${hoursText}`,
      confidence: 0.95
    });
  }

  // Phone number patterns
  if (businessInfo.phone) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(phone|call|contact.*number|telephone|reach)",
      question_type: "contact",
      answer: `You can reach us at ${businessInfo.phone}`,
      confidence: 0.95
    });
  }

  // Email patterns
  if (businessInfo.email) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(email|contact.*email|send.*message)",
      question_type: "contact",
      answer: `You can email us at ${businessInfo.email}`,
      confidence: 0.92
    });
  }

  // Services patterns
  if (businessInfo.services?.length) {
    const servicesText = businessInfo.services.slice(0, 8).join(", "); // Limit to prevent too long answers
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(service|treatment|offer|what.*do|menu|procedures)",
      question_type: "services",
      answer: `We offer these services: ${servicesText}`,
      confidence: 0.88
    });
  }

  // Location patterns
  if (businessInfo.address) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(where|location|address|find.*us|directions)",
      question_type: "location",
      answer: `We're located at ${businessInfo.address}`,
      confidence: 0.93
    });
  }

  // Pricing patterns
  if (businessInfo.pricing) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(price|cost|fee|rate|how much|pricing)",
      question_type: "pricing",
      answer: `Pricing information: ${businessInfo.pricing}`,
      confidence: 0.85
    });
  }

  // About/Description patterns
  if (businessInfo.about) {
    quickAnswers.push({
      tenant_id: tenantId,
      question_pattern: "(?i)(about|who.*are|what.*business|tell.*me.*about)",
      question_type: "about",
      answer: businessInfo.about,
      confidence: 0.80
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

  console.log(`Created ${quickAnswers.length} enhanced quick answers`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== STARTING INGEST FUNCTION ===");
    const requestBody = await req.json();
    console.log("Request body:", requestBody);
    
    const { tenant_id, site_url, title } = requestBody;
    console.log(`Enhanced ingesting: ${site_url} for tenant: ${tenant_id}`);

    console.log("Creating Supabase client...");
    const sb = createClient();
    console.log("Supabase client created successfully");
    
    // Enhanced multi-page web scraping with Firecrawl API
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    let content = "";
    let crawlMethod = "basic";
    
    if (firecrawlKey) {
      console.log("Using Firecrawl for multi-page crawling");
      try {
        // First try multi-page crawl
        const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: site_url,
            limit: 5, // Crawl up to 5 pages
            scrapeOptions: {
              formats: ['markdown'],
              includeTags: ['h1', 'h2', 'h3', 'h4', 'p', 'div', 'span', 'li', 'table', 'td', 'th'],
              excludeTags: ['script', 'style', 'nav', 'footer', 'aside', 'comment'],
              onlyMainContent: true
            },
            crawlerOptions: {
              includes: ['**/hours*', '**/contact*', '**/about*', '**/services*', '**/pricing*'],
              excludes: ['**/admin*', '**/login*', '**/cart*', '**/checkout*'],
              maxDepth: 2
            }
          })
        });

        if (crawlResponse.ok) {
          const crawlResult = await crawlResponse.json();
          
          if (crawlResult.success) {
            // Check crawl status if async
            let finalData = crawlResult;
            if (crawlResult.id) {
              // Poll for completion
              let attempts = 0;
              while (attempts < 30 && finalData.status !== 'completed') {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlResult.id}`, {
                  headers: { 'Authorization': `Bearer ${firecrawlKey}` }
                });
                if (statusResponse.ok) {
                  finalData = await statusResponse.json();
                  console.log(`Crawl status: ${finalData.status}, pages: ${finalData.completed || 0}`);
                }
                attempts++;
              }
            }

            if (finalData.data && finalData.data.length > 0) {
              content = finalData.data.map((page: any) => {
                const pageContent = page.markdown || page.content || '';
                return `PAGE: ${page.metadata?.title || page.url}\n${pageContent}\n\n`;
              }).join('');
              crawlMethod = "firecrawl-multi";
              console.log(`Firecrawl crawled ${finalData.data.length} pages, extracted ${content.length} characters`);
            } else {
              throw new Error("No pages crawled successfully");
            }
          } else {
            throw new Error(`Firecrawl crawl failed: ${crawlResult.error}`);
          }
        } else {
          throw new Error(`Firecrawl API error: ${crawlResponse.status}`);
        }
      } catch (crawlError) {
        console.error("Multi-page crawl failed, trying single page:", crawlError);
        
        // Fallback to single page scrape
        try {
          const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: site_url,
              formats: ['markdown'],
              includeTags: ['h1', 'h2', 'h3', 'h4', 'p', 'div', 'span', 'li', 'table'],
              excludeTags: ['script', 'style', 'nav', 'footer'],
              onlyMainContent: true,
              waitFor: 3000
            })
          });
          
          if (scrapeResponse.ok) {
            const scrapeResult = await scrapeResponse.json();
            if (scrapeResult.success && scrapeResult.data?.markdown) {
              content = scrapeResult.data.markdown;
              crawlMethod = "firecrawl-single";
              console.log(`Firecrawl single page extracted ${content.length} characters`);
            } else {
              throw new Error("Single page scrape failed");
            }
          } else {
            throw new Error(`Firecrawl scrape error: ${scrapeResponse.status}`);
          }
        } catch (scrapeError) {
          console.error("Firecrawl single page failed, using basic fetch:", scrapeError);
          const response = await fetch(site_url);
          const html = await response.text();
          content = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          crawlMethod = "basic";
        }
      }
    } else {
      console.log("No Firecrawl key, using basic fetch");
      const response = await fetch(site_url);
      const html = await response.text();
      content = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      crawlMethod = "basic";
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
      meta: { business_info: businessInfo, crawl_method: crawlMethod }
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
      source_id: sourceId,
      business_info: businessInfo,
      crawl_method: crawlMethod
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