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
        delete() {
          return {
            eq(column: string, value: any) {
              return {
                async execute() {
                  const r = await fetch(`${url}/rest/v1/${table}?${column}=eq.${encodeURIComponent(String(value))}`, {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${key}`, "apikey": key, "Prefer": "return=minimal" }
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
            if (data.hasOfferCatalog || data.makesOffer) businessInfo.services = data.hasOfferCatalog || data.makesOffer;
            if (data.priceRange) businessInfo.pricing = data.priceRange;
          }
        } catch (e) {
          console.log("Failed to parse JSON-LD:", e);
        }
      }
    }
    
    // Enhanced extraction patterns
    const phoneRegex = /(?:phone|tel|call).*?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/gi;
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const hoursRegex = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday).*?(\d{1,2}:\d{2}\s*(?:am|pm)?.*?\d{1,2}:\d{2}\s*(?:am|pm)?)/gi;
    
    // Service extraction patterns
    const serviceKeywords = ['service', 'treatment', 'procedure', 'therapy', 'care', 'consultation', 'session', 'appointment', 'class', 'program'];
    const serviceRegex = new RegExp(`(?:our\\s+)?(${serviceKeywords.join('|')})s?[\\s\\w]*(?:include|offer|provide)?[:\\s]*([^\\n\\.]{10,100})`, 'gi');
    
    // Pricing extraction patterns  
    const priceRegex = /(?:\$\d+(?:\.\d{2})?(?:\s*-\s*\$\d+(?:\.\d{2})?)?)|(?:starting\s+(?:at\s+|from\s+)?\$\d+)|(?:price[s]?[:\s]+\$?\d+)/gi;
    const priceRangeRegex = /(?:pricing|rates?|fees?|costs?)[\s:]*(?:\$?\d+(?:\.\d{2})?(?:\s*-\s*\$?\d+(?:\.\d{2})?)?)|(?:affordable|budget|premium|luxury)\s+(?:pricing|rates)/gi;
    
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
    
    // Universal service/product extraction with section-based parsing
    if (!businessInfo.services) {
      // Find content sections that typically contain services/products/offerings
      const sectionKeywords = ['services', 'products', 'offerings', 'menu', 'treatments', 'solutions', 'programs', 'packages', 'specialties', 'what we do', 'our work', 'practice areas'];
      
      let section = "";
      for (const keyword of sectionKeywords) {
        const regex = new RegExp(`(?:^|\\n)\\s*(?:our\\s+)?${keyword}\\b[\\s:]*\\n([\\s\\S]{0,2000})`, 'i');
        const match = content.match(regex);
        if (match && match[1].length > section.length) {
          section = match[1];
        }
      }
      
      // Fallback to analyzing the entire content if no specific section found
      if (!section || section.length < 100) section = content;
      
      const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
      const serviceItems: string[] = [];
      const pricePairs: { name: string; price: string }[] = [];
      
      for (const line of lines) {
        if (line.length < 5 || line.length > 200) continue;
        if (/https?:\/\//i.test(line) || /\[[^\]]+\]\([^\)]+\)/.test(line)) continue; // skip links
        if (/^(home|about|contact|copyright|terms|privacy|login|register)$/i.test(line.trim())) continue;
        
        // Fixed regex patterns - removed unicode property escapes
        const pricePattern = line.match(/^[-*•\s]*([a-zA-Z0-9][a-zA-Z0-9 &\/+''°.,()-]{3,100}?)\s*(?:[:\-–—]|)\s*((?:starting\s+(?:at\s+|from\s+)?)?(?:[$£€¥]|\b(?:USD|CAD|AUD|EUR|GBP|INR|JPY|AED|SAR|ZAR)\b)?\s?\d{1,3}(?:[\,\s]\d{3})*(?:\.\d{2})?\+?(?:\s*(?:-|to|–|—)\s*(?:[$£€¥]|\b(?:USD|CAD|AUD|EUR|GBP|INR|JPY|AED|SAR|ZAR)\b)?\s?\d{1,3}(?:[\,\s]\d{3})*(?:\.\d{2})?\+?)?(?:\s*(?:each|\/hr|\/hour|\/day|\/session|\/visit))?)\s*$/i);
        
        if (pricePattern) {
          const name = pricePattern[1].trim().replace(/\s{2,}/g, ' ');
          const price = pricePattern[2].trim();
          if (name.length >= 3 && !/^(price|pricing|rates?|cost|fee)$/i.test(name)) {
            pricePairs.push({ name, price });
            if (!serviceItems.includes(name)) serviceItems.push(name);
            continue;
          }
        }
        
        // Universal bullet/list item pattern - fixed regex
        const bulletPattern = line.match(/^[-*•]\s*([a-zA-Z0-9][a-zA-Z0-9 &\/+''°.,()-]{3,100}?)$/);
        if (bulletPattern) {
          const item = bulletPattern[1].trim().replace(/\s{2,}/g, ' ');
          if (!/\$|http|www|©|script|function/.test(item) && item.length <= 100) {
            if (!serviceItems.includes(item)) serviceItems.push(item);
          }
        }
        
        // Title-like lines that look like service/product names - fixed regex
        if (/^[A-Z][a-zA-Z0-9 &\/+''°.,()-]{6,100}$/.test(line) && 
            !/\$|http|www|©|script|function|click|read more|learn more|view all/i.test(line)) {
          if (!serviceItems.includes(line)) serviceItems.push(line);
        }
      }

      // Merge with universal price-pair extractor (handles inline + tables)
      const universalPairs = extractUniversalPricePairs(section);
      for (const p of universalPairs) {
        if (!pricePairs.some(x => x.name.toLowerCase() === p.name.toLowerCase())) pricePairs.push(p);
        if (!serviceItems.includes(p.name)) serviceItems.push(p.name);
      }

      if (serviceItems.length > 0) businessInfo.services = serviceItems.slice(0, 25);
      if (pricePairs.length > 0) {
        businessInfo.pricing_pairs = pricePairs.slice(0, 25);
        if (!businessInfo.pricing) {
          businessInfo.pricing = pricePairs.slice(0, 10).map(p => `${p.name}: ${p.price}`).join('; ');
        }
        console.log('Pricing pairs found:', pricePairs.length);
      }
    }
    
    // Professional pricing extraction - clean formats only (fallback if not set above)
    if (!businessInfo.pricing) {
      const cleanPriceRegex = /(?:\$\d+(?:\.\d{2})?(?:\s*-\s*\$\d+(?:\.\d{2})?)?)|(?:starting\s+at\s+\$\d+)|(?:from\s+\$\d+)/gi;
      const priceMatches = content.match(cleanPriceRegex);
      if (priceMatches && priceMatches.length > 0) {
        const validPrices = priceMatches.filter(price => {
          const amount = parseInt(price.replace(/\D/g, ''));
          return amount >= 10 && amount <= 1000; // Reasonable service price range
        });
        if (validPrices.length > 0) {
          businessInfo.pricing = validPrices.slice(0, 3).join(', ');
        }
      }
    }
    
  } catch (error) {
    console.error("Structured data extraction error:", error);
  }
  
  return businessInfo;
}

// Universal price pair extractor — currency-aware and table-friendly
function extractUniversalPricePairs(content: string): { name: string; price: string }[] {
  const pairs: { name: string; price: string }[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  // Currency-aware price token (supports $, £, €, ¥ and common currency codes; ranges; trailing +)
  const priceToken = /(?:(?:from|starting(?:\s+at)?)\s+)?(?:(?:[$£€¥]|(?:USD|CAD|AUD|EUR|GBP|INR|JPY|AED|SAR|ZAR)\s*)?\d{1,3}(?:[\,\s]\d{3})*(?:\.\d{2})?\+?)(?:\s*(?:-|to|–|—)\s*(?:(?:[$£€¥]|(?:USD|CAD|AUD|EUR|GBP|INR|JPY|AED|SAR|ZAR)\s*)?\d{1,3}(?:[\,\s]\d{3})*(?:\.\d{2})?\+?))?/i;

  for (const line of lines) {
    if (!priceToken.test(line)) continue;
    const m = line.match(priceToken);
    if (!m) continue;
    const price = m[0].replace(/\s+/g, ' ').trim();

    // Name: prefer text before price, otherwise remove price and separators
    let name = line.substring(0, m.index || 0).replace(/^[-*•\s]+/, '').trim();
    if (!name) name = line.replace(priceToken, '').replace(/[:\-–—|]+/g, ' ').trim();
    name = name.split('|')[0].trim();
    name = name.replace(/\b(price|pricing|rates?|cost|fee|from|starting|at)\b.*$/i, '').trim();
    if (name.length < 3 || name.length > 100) continue;
    if (/http|www|©|script|function|cookie/i.test(name)) continue;

    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ name, price });
    }
  }

  // Markdown table rows with name | price
  for (const line of lines) {
    if (!line.includes('|')) continue;
    if (!priceToken.test(line)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    const priceCell = cells.find(c => priceToken.test(c));
    const nameCell = cells.find(c => !priceToken.test(c) && c.length > 2) || cells[0];
    if (priceCell && nameCell) {
      const price = (priceCell.match(priceToken)?.[0] || '').trim();
      const name = nameCell.replace(/[:\-–—]+/g, ' ').trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        pairs.push({ name, price });
      }
    }
  }

  return pairs;
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
    const prompt = `You are a professional business intelligence analyst. Extract clean business information for ANY industry (restaurant, law firm, medical practice, retail, etc.).

    CRITICAL REQUIREMENTS:
    - Services/Products: Extract what this business offers (e.g., "Legal Consultation", "Dinner Menu", "Physical Therapy", "Retail Items")
    - NO URLs, fragments, or technical text
    - Pricing: Only clear pricing (e.g., "$50", "$75-$120", "Starting at $45")
    - Be industry-agnostic - work for ANY business type
    
    Return clean JSON with ONLY clearly stated fields:
    {
      "business_hours": [{"day": "Monday", "hours": "9:00 AM - 5:00 PM"}],
      "phone": "XXX-XXX-XXXX",
      "email": "contact@business.com", 
      "address": "Complete address",
      "services": ["What Business Offers 1", "What Business Offers 2"],
      "pricing": "Clean pricing info only",
      "about": "Professional business description",
      "specialties": ["What they specialize in 1", "What they specialize in 2"]
    }
    
    Content: ${content.slice(0, 8000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-2025-08-07",
        messages: [
          { role: "system", content: "You are a business intelligence analyst. Extract clean, customer-facing information for ANY business type (restaurant, law firm, medical, retail, etc.). Never include URLs, code, or technical fragments. Focus on what customers actually need to know." },
          { role: "user", content: prompt }
        ],
        max_completion_tokens: 1200,
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
    if (businessInfo.pricing_pairs?.length) {
      const p = businessInfo.pricing_pairs.slice(0, 8).map((x: any) => `${x.name} - ${x.price}`).join(", ");
      businessSummary += `Pricing: ${p}\n`;
    } else if (businessInfo.pricing) {
      businessSummary += `Pricing: ${businessInfo.pricing}\n`;
    }
    if (businessInfo.about) businessSummary += `About: ${businessInfo.about}\n`;
    
    chunks.push(businessSummary);
  }

  // Split remaining content into chunks
  const sentences = text.split(/[.!?]\s+/);
  let currentChunk = "";
  const maxChunkLength = maxTokens * 4; // Rough token estimate

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += " " + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
}

// Enhanced quick answer generation
async function createQuickAnswers(content: string, businessInfo: any, tenantId: string): Promise<void> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return;

  console.log("Creating quick answers for common business questions");

  try {
    const questionTypes = [
      { type: "hours", question: "What are your business hours?" },
      { type: "pricing", question: "What are your prices?" },
      { type: "contact", question: "How can I contact you?" },
      { type: "services", question: "What services do you offer?" },
      { type: "location", question: "Where are you located?" }
    ];

    for (const q of questionTypes) {
      let answer = "";
      let confidence = 0.7;

      // Generate specific answers based on business info
      if (q.type === "hours" && businessInfo.business_hours?.length) {
        answer = businessInfo.business_hours.map((h: any) => `${h.day}: ${h.hours}`).join("\n");
        confidence = 0.95;
      } else if (q.type === "pricing" && (businessInfo.pricing_pairs?.length || businessInfo.pricing)) {
        if (businessInfo.pricing_pairs?.length) {
          answer = businessInfo.pricing_pairs.slice(0, 8).map((p: any) => `${p.name}: ${p.price}`).join("\n");
        } else {
          answer = businessInfo.pricing;
        }
        confidence = 0.9;
      } else if (q.type === "contact") {
        const contactInfo = [];
        if (businessInfo.phone) contactInfo.push(`Phone: ${businessInfo.phone}`);
        if (businessInfo.email) contactInfo.push(`Email: ${businessInfo.email}`);
        if (businessInfo.address) contactInfo.push(`Address: ${businessInfo.address}`);
        if (contactInfo.length > 0) {
          answer = contactInfo.join("\n");
          confidence = 0.95;
        }
      } else if (q.type === "services" && businessInfo.services?.length) {
        answer = "We offer: " + businessInfo.services.slice(0, 10).join(", ");
        confidence = 0.9;
      } else if (q.type === "location" && businessInfo.address) {
        answer = businessInfo.address;
        confidence = 0.95;
      }

      // Store quick answer in database if we have good content
      if (answer && confidence > 0.8) {
        const supabase = createClient();
        try {
          await supabase.from("knowledge_base").insert({
            tenant_id: tenantId,
            question: q.question,
            answer: answer.trim(),
            question_type: q.type,
            confidence: confidence,
            source_url: "business_info_extraction",
            is_quick_answer: true,
            created_at: new Date().toISOString()
          });
          console.log(`Created quick answer for: ${q.type}`);
        } catch (err) {
          console.error(`Failed to store quick answer ${q.type}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("Quick answer creation failed:", error);
  }
}

// Main ingestion function
async function ingestWebsite(tenantId: string, siteUrl: string, title?: string) {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) throw new Error("Firecrawl API key not found");

  console.log(`Starting enhanced crawl for: ${siteUrl}`);

  const payload = {
    url: siteUrl,
    limit: 15,
    scrapeOptions: {
      formats: ["markdown", "html"],
      excludeTags: ["script", "style", "nav", "footer"],
      onlyMainContent: true,
    },
    crawlerOptions: {
      includes: [
        "**/services/**",
        "**/products/**", 
        "**/offerings/**",
        "**/solutions/**",
        "**/menu/**",
        "**/treatments/**",
        "**/about/**",
        "**/pricing/**",
        "**/contact/**"
      ],
      excludes: [
        "**/admin/**",
        "**/login/**",
        "**/register/**",
        "**/checkout/**",
        "**/cart/**",
        "**/*.pdf",
        "**/*.jpg",
        "**/*.png"
      ],
      maxDepth: 3,
      respectRobotsTxt: true
    }
  };

  const response = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${firecrawlKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl crawl failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const jobId = result.id;

  if (!jobId) {
    throw new Error("No job ID returned from Firecrawl");
  }

  console.log(`Crawl job started: ${jobId}`);

  // Poll for crawl completion
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes with 10-second intervals
  let crawlData: any = null;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

    const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { "Authorization": `Bearer ${firecrawlKey}` }
    });

    if (statusResponse.ok) {
      const status = await statusResponse.json();
      console.log(`Crawl status: ${status.status}, completed: ${status.completed}/${status.total}`);

      if (status.status === "completed") {
        crawlData = status.data;
        break;
      } else if (status.status === "failed") {
        throw new Error(`Crawl failed: ${status.error || "Unknown error"}`);
      }
    }

    attempts++;
  }

  if (!crawlData) {
    throw new Error("Crawl timed out after 5 minutes");
  }

  console.log(`Crawl completed successfully. Processing ${crawlData.length} pages...`);

  // Process the crawled data
  const supabase = createClient();

  // Clear existing knowledge for this tenant
  await supabase.from("knowledge_base").delete().eq("tenant_id", tenantId).execute();

  let totalChunks = 0;
  let businessInfoExtracted = null;

  for (const page of crawlData) {
    if (!page.markdown || !page.metadata?.title) continue;

    const content = page.markdown;
    const pageTitle = page.metadata.title;
    const url = page.metadata.sourceURL || siteUrl;

    console.log(`Processing page: ${pageTitle}`);

    // Extract business information from the main page (homepage or first page)
    if (!businessInfoExtracted && (url === siteUrl || content.length > 2000)) {
      businessInfoExtracted = await extractBusinessInfo(content);
      console.log("Business info extracted:", JSON.stringify(businessInfoExtracted, null, 2));
      
      // Create quick answers for common questions
      await createQuickAnswers(content, businessInfoExtracted, tenantId);
    }

    // Enhanced chunking with business context
    const chunks = chunkTextEnhanced(content, businessInfoExtracted);
    console.log(`Created ${chunks.length} chunks for ${pageTitle}`);

    if (chunks.length === 0) continue;

    // Generate embeddings
    const embeddings = await embedAll(chunks);

    // Store chunks in database
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const embedding = embeddings[i];

      try {
        await supabase.from("knowledge_base").insert({
          tenant_id: tenantId,
          content: chunkContent,
          embedding: JSON.stringify(embedding),
          source_url: url,
          title: pageTitle,
          created_at: new Date().toISOString()
        });
        totalChunks++;
      } catch (error) {
        console.error(`Failed to store chunk ${i}:`, error);
      }
    }
  }

  return {
    success: true,
    pages_processed: crawlData.length,
    chunks_created: totalChunks,
    business_info: businessInfoExtracted
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Ingest-enhanced function called, method:", req.method);
    
    let body;
    try {
      body = await req.json();
      console.log("Request body parsed:", body);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { tenant_id, site_url, title } = body;

    if (!tenant_id || !site_url) {
      return new Response(
        JSON.stringify({ error: "Missing tenant_id or site_url" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting ingestion for tenant: ${tenant_id}, URL: ${site_url}`);

    const result = await ingestWebsite(tenant_id, site_url, title);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Ingest error:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});