// deno-lint-ignore-file no-explicit-any
// Enhanced Supabase Edge Function: ingest with structured data extraction
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = "text-embedding-3-small";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supabase client
function createClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return {
    from(table: string) {
      return {
        async insert(data: any) {
          const r = await fetch(`${url}/rest/v1/${table}`, {
            method: "POST",
            headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Prefer": "return=representation" },
            body: JSON.stringify(data)
          });
          if (!r.ok) throw new Error(`Insert ${table} ${r.status}: ${await r.text()}`);
          return { data: await r.json() };
        }
      };
    }
  };
}

function normalizeUrl(u: string): string {
  return u.split('#')[0];
}

async function fetchText(url: string): Promise<string> {
  console.log(`Fetching: ${url}`);
  const r = await fetch(url, { 
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BusinessBot/1.0)' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  
  let html = await r.text();
  // Remove script and style tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Strip HTML tags but preserve structure
  html = html.replace(/<[^>]+>/g, ' ');
  // Clean up whitespace
  const text = html.replace(/\s+/g, ' ').trim();
  
  console.log(`Extracted ${text.length} characters`);
  return text;
}

// Enhanced structured data extraction
async function extractBusinessInfo(text: string): Promise<any> {
  const prompt = `Extract structured business information from this website text. Return JSON with:
{
  "business_hours": "string with operating hours",
  "services": ["array", "of", "services"],
  "pricing": "any pricing information",
  "contact": "contact information",
  "location": "address or location info"
}

Website text: ${text.slice(0, 3000)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.1
    }),
  });

  if (!response.ok) {
    console.warn('Failed to extract structured data, continuing with regular chunking');
    return {};
  }

  try {
    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (e) {
    console.warn('Failed to parse structured data:', e);
    return {};
  }
}

// Enhanced chunking with business context
function chunkTextEnhanced(text: string, structuredData: any, maxTokens = 700): string[] {
  const chunks: string[] = [];
  
  // Create specialized chunks for structured data
  if (structuredData.business_hours) {
    chunks.push(`Business Hours: ${structuredData.business_hours}`);
  }
  
  if (structuredData.services && structuredData.services.length > 0) {
    chunks.push(`Services Offered: ${structuredData.services.join(', ')}`);
  }
  
  if (structuredData.pricing) {
    chunks.push(`Pricing Information: ${structuredData.pricing}`);
  }
  
  if (structuredData.contact) {
    chunks.push(`Contact Information: ${structuredData.contact}`);
  }
  
  if (structuredData.location) {
    chunks.push(`Location: ${structuredData.location}`);
  }
  
  // Split remaining text into semantic chunks
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  let currentChunk = "";
  
  for (const sentence of sentences) {
    const testChunk = currentChunk + " " + sentence.trim();
    // Rough token estimation: 4 chars per token
    if (testChunk.length / 4 > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence.trim();
    } else {
      currentChunk = testChunk.trim();
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  console.log(`Created ${chunks.length} enhanced chunks (${chunks.filter(c => c.includes('Hours:')).length} structured)`);
  return chunks.filter(c => c.length > 30); // Filter out very short chunks
}

async function embedAll(chunks: string[]): Promise<number[][]> {
  console.log(`Generating embeddings for ${chunks.length} chunks`);
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: chunks, model: MODEL })
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  
  const j = await r.json() as any;
  console.log(`Generated ${j.data.length} embeddings`);
  return j.data.map((d: any) => d.embedding);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, site_url, title, allowlist } = await req.json();
    if (!tenant_id || !site_url) throw new Error("tenant_id and site_url required");
    
    // Validate allowlist if provided
    if (allowlist && !allowlist.includes(new URL(site_url).hostname)) {
      throw new Error(`Site ${site_url} not in allowlist`);
    }
    
    const url = normalizeUrl(site_url);
    console.log(`Enhanced ingesting: ${url} for tenant: ${tenant_id}`);
    
    // Fetch and clean text
    const text = await fetchText(url);
    
    // Extract structured business information
    const structuredData = await extractBusinessInfo(text);
    console.log(`Extracted structured data:`, Object.keys(structuredData));
    
    // Create enhanced chunks
    const chunks = chunkTextEnhanced(text, structuredData);
    
    // Generate embeddings
    const embeddings = await embedAll(chunks);
    
    const sb = createClient();
    
    // Insert source with metadata
    const sourceData = {
      tenant_id,
      source_url: url,
      source_type: "web",
      title: title || new URL(url).hostname,
      meta: {
        ...structuredData,
        chunk_count: chunks.length,
        ingested_at: new Date().toISOString(),
        enhanced: true
      }
    };
    
    const { data: source } = await sb.from("knowledge_sources").insert(sourceData);
    const sourceId = source[0].id;
    console.log(`Inserted enhanced source: ${sourceId}`);
    
    // Insert chunks with metadata
    const chunkData = chunks.map((content, i) => ({
      tenant_id,
      source_id: sourceId,
      content,
      embedding: embeddings[i],
      token_count: Math.ceil(content.length / 4),
      meta: {
        chunk_index: i,
        is_structured: content.includes(':') && (
          content.includes('Hours:') || 
          content.includes('Services:') || 
          content.includes('Pricing:') ||
          content.includes('Contact:') ||
          content.includes('Location:')
        )
      }
    }));
    
    await sb.from("knowledge_chunks").insert(chunkData);
    console.log(`Inserted ${chunks.length} enhanced chunks`);
    
    return new Response(JSON.stringify({ 
      ok: true, 
      source_id: sourceId,
      chunks_created: chunks.length,
      structured_chunks: chunkData.filter(c => c.meta.is_structured).length,
      business_data: structuredData
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
    
  } catch (e) {
    console.error('Enhanced ingest error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});