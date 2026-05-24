
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

// Known third-party booking/scheduling platforms used by salons, spas, etc.
const BOOKING_PLATFORMS = [
  { name: 'Zenoti',            domains: ['zenoti.com'],                         servicesPath: '/webstoreNew/services' },
  { name: 'Mindbody',         domains: ['mindbodyonline.com', 'mindbody.io'],   servicesPath: null },
  { name: 'Vagaro',           domains: ['vagaro.com'],                          servicesPath: null },
  { name: 'Acuity Scheduling',domains: ['acuityscheduling.com'],                servicesPath: null },
  { name: 'Square Appts',     domains: ['square.site', 'squareup.com'],         servicesPath: null },
  { name: 'Booker',           domains: ['booker.com'],                          servicesPath: null },
  { name: 'Fresha',           domains: ['fresha.com'],                          servicesPath: null },
  { name: 'StyleSeat',        domains: ['styleseat.com'],                       servicesPath: null },
  { name: 'GlossGenius',      domains: ['glossgenius.com'],                     servicesPath: null },
  { name: 'Schedulicity',     domains: ['schedulicity.com'],                    servicesPath: null },
  { name: 'Boulevard',        domains: ['blvd.com', 'myboulevard.com'],         servicesPath: null },
  { name: 'Mangomint',        domains: ['mangomint.com'],                       servicesPath: null },
  { name: 'Phorest',          domains: ['phorest.com'],                         servicesPath: null },
  { name: 'Timely',           domains: ['gettimely.com'],                       servicesPath: null },
  { name: 'Jane App',         domains: ['janeapp.com'],                         servicesPath: null },
  { name: 'Booksy',           domains: ['booksy.com'],                          servicesPath: null },
  { name: 'Growthzilla',     domains: ['appt.cm', 'book.appt.cm', 'growthzilla.com', 'uzeli.com'], servicesPath: null },
  { name: 'Rosy',            domains: ['rosysalon.com'],                         servicesPath: null },
  { name: 'SalonBiz',        domains: ['salonbiz.com', 'salonbizapps.com'],      servicesPath: null },
];

interface DetectedPlatform {
  platform: string;
  url: string;     // canonical URL to scrape
  rawUrls: string[];
}

interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  extraAllowedHosts?: string[];
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
  business_info?: any;
  pages_fetched: number;
  used_firecrawl: boolean;
  extraction_method: string;
  detected_platforms?: DetectedPlatform[];
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Booking platform detection ───────────────────────────────────────────────

function detectBookingPlatforms(html: string): DetectedPlatform[] {
  const results: DetectedPlatform[] = [];

  for (const platform of BOOKING_PLATFORMS) {
    const found: string[] = [];

    for (const domain of platform.domains) {
      const esc = domain.replace('.', '\\.');
      // Match any fully-qualified URL containing this domain
      const urlRe = new RegExp(`https?://[a-zA-Z0-9._-]*${esc}[^"'\\s<>]*`, 'gi');
      const matches = html.match(urlRe) ?? [];
      found.push(...matches);

      // Also look inside iframe src attributes
      const iframeRe = new RegExp(`<iframe[^>]+src=["']([^"']*${esc}[^"']*)["']`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = iframeRe.exec(html)) !== null) found.push(m[1]);
    }

    const unique = [...new Set(found)];
    if (unique.length === 0) continue;

    // Build canonical URL: prefer a services/booking page over a generic landing
    let canonical = unique[0];
    const domain = platform.domains.find(d => unique[0].includes(d))!;

    if (platform.servicesPath) {
      // Strip to base origin + known services path
      try {
        const origin = new URL(unique[0]).origin;
        canonical = `${origin}${platform.servicesPath}`;
      } catch {
        canonical = unique[0];
      }
    } else {
      // Pick the deepest / most specific URL found
      canonical = unique.reduce((best, u) => u.length > best.length ? u : best, unique[0]);
    }

    results.push({ platform: platform.name, url: canonical, rawUrls: unique.slice(0, 5) });
  }

  return results;
}

// ── Scrape a booking platform page (JS-rendered SPA) via Firecrawl ──────────

async function scrapeBookingPlatformWithFirecrawl(detected: DetectedPlatform[]): Promise<string> {
  if (!FIRECRAWL_API_KEY || detected.length === 0) return '';

  let combined = '';

  for (const { platform, url } of detected) {
    console.log(`Scraping booking platform [${platform}]: ${url}`);
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          waitFor: 6000,          // wait for JS framework to render service list
          onlyMainContent: true,
          actions: [{ type: 'wait', milliseconds: 4000 }],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        console.warn(`Firecrawl scrape failed for ${url}: ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const md = data?.data?.markdown ?? data?.markdown ?? '';
      if (md && md.length > 100) {
        combined += `\n\n=== BOOKING PLATFORM [${platform}]: ${url} ===\n${md}`;
        console.log(`Got ${md.length} chars from ${platform}`);
      }
    } catch (err) {
      console.error(`Error scraping ${platform}:`, err);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return combined;
}

// ── Zenoti direct API scraper ────────────────────────────────────────────────
// Zenoti's webstore is a React SPA, so the HTML returns empty. Instead, call
// their internal catalog API which the SPA itself uses — no auth required for
// public-facing webstore endpoints.

async function scrapeZenotiApi(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    const base = parsed.origin; // e.g. https://tinavora.zenoti.com
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; VoiceRelayBot/1.0)',
      'Origin': base,
      'Referer': `${base}/webstoreNew/services`,
    };

    // Step 1: Get center config to find the center_id UUID
    let centerId = '';
    for (const configUrl of [
      `${base}/webstoreNew/api/v1/centers/current`,
      `${base}/webstoreNew/api/v2/centers/current`,
    ]) {
      try {
        const r = await fetch(configUrl, { headers, signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const j = await r.json();
        centerId = j?.center_id ?? j?.id ?? j?.data?.center_id ?? j?.center?.center_id ?? '';
        if (centerId) { console.log(`Zenoti center ID: ${centerId}`); break; }
      } catch { /* try next */ }
    }

    // Step 2: Try catalog endpoints (ordered by likelihood of having prices)
    const candidates = [
      centerId && `${base}/webstoreNew/api/v1/catalog?center_id=${centerId}`,
      `${base}/webstoreNew/api/v1/catalog`,
      `${base}/webstoreNew/api/v2/catalog`,
      centerId && `${base}/webstoreNew/api/v1/services?center_id=${centerId}&pageSize=200`,
      `${base}/webstoreNew/api/v1/services?pageSize=200`,
      `${base}/webstoreNew/api/v2/services?pageSize=200`,
    ].filter(Boolean) as string[];

    for (const apiUrl of candidates) {
      try {
        console.log(`Trying Zenoti API: ${apiUrl}`);
        const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8000) });
        if (!resp.ok) { console.log(`Zenoti API ${resp.status}: ${apiUrl}`); continue; }
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;

        const data = await resp.json();

        // Flatten services from various response shapes
        let items: any[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else {
          items = data?.services ?? data?.items ?? data?.data?.services ?? [];
          // Catalog may nest services under categories
          if (items.length === 0 && data?.categories) {
            for (const cat of (data.categories as any[])) {
              if (cat.services) items.push(...cat.services);
            }
          }
          if (items.length === 0 && data?.catalog) {
            items = data.catalog?.services ?? [];
            if (items.length === 0 && data.catalog?.categories) {
              for (const cat of (data.catalog.categories as any[])) {
                if (cat.services) items.push(...cat.services);
              }
            }
          }
        }

        if (items.length === 0) { console.log(`Zenoti API: no services in response from ${apiUrl}`); continue; }

        console.log(`Zenoti API returned ${items.length} services from ${apiUrl}`);

        const lines = items.map((svc: any) => {
          const name = svc.name || svc.service_name || svc.display_name || svc.title || 'Service';
          // Zenoti price field variants
          const rawPrice =
            svc.price?.sales_price ?? svc.price?.price ??
            svc.sales_price ?? svc.starting_price ?? svc.min_price ??
            svc.price ?? '';
          const price = rawPrice && rawPrice !== 0 ? `$${rawPrice}` : '';
          const desc = (svc.description || svc.short_description || '')
            .replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
          const dur = svc.duration || svc.duration_minutes || svc.service_duration || '';
          return [
            `**${name}**`,
            price ? `Starting ${price}` : '',
            dur ? `${dur} min` : '',
            desc ? `- ${desc}` : '',
          ].filter(Boolean).join(' ');
        });

        return `\n\n=== BOOKING PLATFORM [Zenoti API]: ${apiUrl} ===\n${lines.join('\n')}`;
      } catch (e) { console.log(`Zenoti API error at ${apiUrl}:`, (e as Error).message); }
    }

    // All JSON API endpoints failed — fall back to extracting globalJson from the HTML page.
    // Zenoti embeds a `globalJson` variable server-side that contains promotions / deals
    // with prices (e.g. "BAMBOO ANTI-AGING FACIAL - $99"). This is the only publicly
    // accessible price data without going through the per-stylist booking flow.
    console.log('JSON API endpoints failed — trying globalJson extraction from HTML page');
    try {
      const pageResp = await fetch(url, {
        headers: { ...headers, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (pageResp.ok) {
        const html = await pageResp.text();

        // Extract globalJson (server-rendered, contains promo text with prices)
        const gjMatch = html.match(/var globalJson\s*=\s*(\{[\s\S]*?\});\s*\n/);
        if (gjMatch) {
          try {
            const gj = JSON.parse(gjMatch[1]);
            const details: any[] = gj?.templateSettings?.details ?? [];
            const priceLines: string[] = [];
            for (const d of details) {
              const raw = d.value ?? '';
              if (raw.includes('$') && raw.length < 500) {
                const decoded = raw
                  .replace(/</g, '<').replace(/>/g, '>')
                  .replace(/&/g, '&').replace(/&nbsp;/g, ' ')
                  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (decoded && /\$\d/.test(decoded)) priceLines.push(decoded);
              }
            }
            if (priceLines.length > 0) {
              console.log(`Extracted ${priceLines.length} price lines from Zenoti globalJson`);
              return `\n\n=== BOOKING PLATFORM [Zenoti Promotions/Pricing]: ${url} ===\nNOTE: Zenoti pricing is per-stylist; the following promotional prices give approximate ranges:\n${priceLines.join('\n')}`;
            }
          } catch { /* ignore JSON parse errors */ }
        }
      }
    } catch { /* ignore */ }

    console.log('All Zenoti extraction methods failed — service names will be extracted by Firecrawl but prices require booking-flow selection');
    return '';
  } catch (err) {
    console.error('Zenoti API scrape error:', err);
    return '';
  }
}

// ── Fallback: basic fetch for booking platform (may miss JS-rendered content)

async function scrapeBookingPlatformBasic(detected: DetectedPlatform[]): Promise<string> {
  if (detected.length === 0) return '';
  let combined = '';

  for (const { platform, url } of detected) {
    // Platform-specific API scrapers (avoid blank SPA responses)
    if (platform === 'Zenoti') {
      const zenotiData = await scrapeZenotiApi(url);
      if (zenotiData) {
        combined += zenotiData;
        console.log(`Zenoti API scrape succeeded (${zenotiData.length} chars)`);
        continue;
      }
    }

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VoiceRelayBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      // Strip tags for basic readability
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20000);

      if (text.length > 200) {
        combined += `\n\n=== BOOKING PLATFORM [${platform}] (basic fetch — JS may not have rendered): ${url} ===\n${text}`;
        console.log(`Basic fetch got ${text.length} chars from ${platform}`);
      }
    } catch (err) {
      console.error(`Basic fetch failed for ${platform}:`, err);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return combined;
}

// ── Main crawl methods ────────────────────────────────────────────────────────

async function fetchWithFirecrawl(url: string, options: CrawlOptions): Promise<{ content: string; pages_fetched: number }> {
  if (!FIRECRAWL_API_KEY) throw new Error("Firecrawl API key not available");

  console.log('Using Firecrawl for comprehensive crawling:', url);

  const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      limit: options.maxPages || 50,
      scrapeOptions: { formats: ['markdown', 'html'] }
    }),
  });

  if (!crawlResponse.ok) {
    const errorText = await crawlResponse.text();
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
        if (page.markdown) combinedContent += page.markdown + '\n';
        if (page.html) combinedContent += `\n[HTML_CONTENT]\n${page.html}\n[/HTML_CONTENT]\n`;
        pages_fetched++;
      }
    }

    console.log(`Firecrawl extracted content from ${pages_fetched} pages (${combinedContent.length} chars)`);
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
  const maxPages = options.maxPages || 25;

  // Build allowed host set from base domain + any extra hosts
  const baseHost = new URL(url).hostname;
  const allowedHosts = new Set<string>([baseHost]);
  for (const h of (options.extraAllowedHosts ?? [])) allowedHosts.add(h.trim().toLowerCase());

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
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) { console.log(`Skip ${currentUrl}: HTTP ${response.status}`); continue; }

      const html = await response.text();
      combinedContent += `\n\n=== PAGE ${pages_fetched + 1}: ${currentUrl} ===\n${html}`;
      pages_fetched++;

      if (pages_fetched < maxPages) {
        const foundUrls: { url: string; priority: number }[] = [];
        const urlPattern = /href=["']([^"']+)["']/gi;
        let match: RegExpExecArray | null;

        while ((match = urlPattern.exec(html)) !== null) {
          let foundUrl = match[1].trim();
          if (foundUrl.startsWith('#') || foundUrl.startsWith('mailto:') || foundUrl.startsWith('tel:') || foundUrl.startsWith('javascript:')) continue;

          if (foundUrl.startsWith('/')) {
            foundUrl = new URL(currentUrl).origin + foundUrl;
          } else if (!foundUrl.startsWith('http')) {
            foundUrl = new URL(foundUrl, currentUrl).href;
          }

          try {
            const foundHost = new URL(foundUrl).hostname;
            // Allow same domain AND explicitly allowed booking hosts
            if (!allowedHosts.has(foundHost) && ![...allowedHosts].some(h => foundHost.endsWith('.' + h))) continue;
          } catch { continue; }

          if (visitedUrls.has(foundUrl)) continue;

          let priority = 0;
          const urlLower = foundUrl.toLowerCase();
          priorityPatterns.forEach(p => { if (p.test(urlLower)) priority += 10; });
          if (/service|treatment|pricing|package/.test(urlLower)) priority += 20;
          if (/admin|login|wp-|blog/.test(urlLower)) priority -= 20;

          foundUrls.push({ url: foundUrl, priority });
        }

        foundUrls.sort((a, b) => b.priority - a.priority);
        foundUrls.slice(0, 10).forEach(item => {
          if (!toVisit.includes(item.url)) toVisit.push(item.url);
        });
      }
    } catch (error) {
      console.error(`Failed to fetch ${currentUrl}:`, error);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Heuristic: ${pages_fetched} pages, ${combinedContent.length} chars`);
  return { content: combinedContent, pages_fetched };
}

// ── Structured data extraction (JSON-LD, schema.org) ─────────────────────────

function extractStructuredData(html: string): { services: ExtractedService[]; hours: ExtractedHours[] } {
  const services: ExtractedService[] = [];
  const hours: ExtractedHours[] = [];

  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  let match: RegExpExecArray | null;

  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      let jsonData = JSON.parse(match[1].trim());
      if (Array.isArray(jsonData)) jsonData = jsonData[0];
      else if (jsonData['@graph']) jsonData = jsonData['@graph'][0];

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

      if (jsonData.openingHours || jsonData.openingHoursSpecification) {
        const hoursSpec = jsonData.openingHoursSpecification || jsonData.openingHours;
        if (Array.isArray(hoursSpec)) {
          for (const spec of hoursSpec) {
            const dayName = spec.dayOfWeek?.replace('https://schema.org/', '') || spec.dayOfWeek;
            hours.push({ day: dayName, open_time: spec.opens, close_time: spec.closes, is_closed: !spec.opens || !spec.closes });
          }
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  return { services, hours };
}

// ── Deterministic HTML service extraction ─────────────────────────────────────

function extractServicesProgrammatically(content: string): ExtractedService[] {
  const services: ExtractedService[] = [];
  const pageRegex = /=== PAGE\s+\d+:\s+([^\n]+)\s+===\n([\s\S]*?)(?=\n=== PAGE|\s*$)/g;
  const candidateUrlPattern = /(service|pricing|menu|treatment|booking|platform)/i;

  const clean = (html: string) => html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

  const pushService = (name: string, priceText?: string) => {
    const nameClean = name.trim().replace(/\s{2,}/g, ' ');
    if (!nameClean || nameClean.length < 2 || nameClean.length > 100) return;
    let price: string | undefined;
    if (priceText) {
      const numMatch = priceText.match(/(\d{1,4}(?:\.\d{1,2})?)/);
      if (numMatch) price = `$${numMatch[1]}`;
    }
    if (services.find(s => s.name.toLowerCase() === nameClean.toLowerCase())) return;
    services.push({ name: nameClean, price });
  };

  let m: RegExpExecArray | null;
  while ((m = pageRegex.exec(content)) !== null) {
    const url = m[1];
    const html = m[2];
    if (!candidateUrlPattern.test(url)) continue;

    // Table rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let r: RegExpExecArray | null;
    while ((r = rowRegex.exec(html)) !== null) {
      const cells = [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => clean(c[1]));
      if (cells.length >= 2) {
        const priceCell = cells.slice(1).find(c => /\$?\d/.test(c));
        if (cells[0] && priceCell) { pushService(cells[0], priceCell); continue; }
      }
    }

    // List items — extract with price if present, or without price on service pages
    const isServicePage = /service|menu|treatment|pricing|package/i.test(url);
    const navWords = /^(home|menu|blog|news|contact|about|login|sign[\s-]?up|faq|privacy|terms|cart|shop|search|locations?|franchise|deals?|memberships?|gift\s*cards?|book\s*(now|online)?|view\s*(our\s*)?services|next\s*steps?|request|hairstyle|gallery|portfolio|our\s*story|team|staff|reviews?|careers?|press|sitemap|accessibility|cookie|logout|account|profile|schedule|appointment|call\s*us)$/i;
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let li: RegExpExecArray | null;
    while ((li = liRegex.exec(html)) !== null) {
      const text = clean(li[1]);
      if (!text || text.length < 3 || text.length > 120) continue;
      // Try with price first
      const mt = text.match(/^(.{2,100}?)[\s:,-]*\s*(\$?\d[\d.+]*)(?:\s|$)/);
      if (mt) { pushService(mt[1], mt[2]); continue; }
      // On service/menu pages: extract list items even without price,
      // filtering out navigation items, URLs, and obvious non-service text
      if (isServicePage &&
          !navWords.test(text) &&
          !/^https?:\/\//.test(text) &&
          !/^\d+$/.test(text) &&
          !/[<>{}]/.test(text)) {
        pushService(text);
      }
    }

    // Plain text lines: "Name $price"
    const lineRegex = /([A-Za-z][A-Za-z0-9\s()\/&.-]{2,80})\s+(?:–|-|:)?\s*(\$?\d[\d.+]*)(?=\s|$)/g;
    const text = clean(html);
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(text)) !== null) pushService(lineMatch[1], lineMatch[2]);
  }

  // Also parse BOOKING PLATFORM sections (don't require URL pattern)
  const platformRegex = /=== BOOKING PLATFORM \[[^\]]+\]:[^\n]+\n([\s\S]*?)(?=\n=== |\s*$)/g;
  while ((m = platformRegex.exec(content)) !== null) {
    const sectionText = m[1];

    // Look for markdown service listings: "**Service Name** $price" or "Service Name Starting $XX"
    const mdLineRe = /\*?\*?([A-Z][A-Z0-9 &'()-]{3,80})\*?\*?\s*(?:Starting\s+)?\$(\d[\d.]*)/g;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdLineRe.exec(sectionText)) !== null) {
      pushService(mdMatch[1], `$${mdMatch[2]}`);
    }

    // Markdown headers as categories with prices below
    const headerRe = /#+\s+([A-Z][A-Z\s&'()-]{3,60})\n([\s\S]*?)(?=\n#|\s*$)/g;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headerRe.exec(sectionText)) !== null) {
      const category = hMatch[1].trim();
      const block = hMatch[2];
      // look for price lines within the block
      const itemRe = /([A-Za-z][A-Za-z0-9\s&'().,/-]{3,80})\s+(?:Starting\s+)?\$(\d[\d.]*)/g;
      let iMatch: RegExpExecArray | null;
      while ((iMatch = itemRe.exec(block)) !== null) {
        pushService(iMatch[1].trim(), `$${iMatch[2]}`);
      }
    }
  }

  console.log(`Deterministic extraction found ${services.length} services`);
  return services;
}

// ── AI extraction ────────────────────────────────────────────────────────────

async function extractWithAI(content: string): Promise<{ services: ExtractedService[]; hours: ExtractedHours[]; business_info?: any }> {
  if (!OPENAI_API_KEY) return { services: [], hours: [] };

  // Strip HTML tags to compress raw crawl HTML before sending to AI.
  // Preserves section markers (=== PAGE / === BOOKING PLATFORM) so the
  // prioritization below still works. Reduces 2MB+ to ~200-400KB.
  const cleanContent = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/\s{3,}/g, '\n')
    .slice(0, 400000); // hard cap at 400KB after stripping

  console.log(`AI input: ${content.length} chars raw → ${cleanContent.length} chars stripped`);

  const serviceKeywords = ['service', 'treatment', 'pricing', 'price', 'package', 'facial', 'massage', 'hair', 'nail', 'spa', 'salon', 'menu', 'booking', 'platform'];
  const hoursKeywords = ['hours', 'open', 'close', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const maxChunkSize = 25000;
  const maxChunks = 5;
  const chunks: string[] = [];

  // Prioritize sections with service/platform keywords
  const contentSections = cleanContent.split(/=== (?:PAGE \d+|BOOKING PLATFORM)/);
  const prioritized = contentSections.sort((a, b) => {
    const score = (s: string) =>
      serviceKeywords.reduce((n, k) => n + (s.toLowerCase().includes(k) ? 10 : 0), 0) +
      hoursKeywords.reduce((n, k) => n + (s.toLowerCase().includes(k) ? 5 : 0), 0);
    return score(b) - score(a);
  });

  let currentChunk = '';
  for (const section of prioritized) {
    if (currentChunk.length + section.length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = section;
      if (chunks.length >= maxChunks) break;
    } else {
      currentChunk += '\n=== ' + section;
    }
  }
  if (currentChunk && chunks.length < maxChunks) chunks.push(currentChunk);

  let allServices: ExtractedService[] = [];
  let allHours: ExtractedHours[] = [];
  let businessInfo: any = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prompt = `You are a business data extraction expert. Extract ALL services/treatments/packages, business hours, and business contact info from this content.

NOTE: Some sections labelled "BOOKING PLATFORM" contain data from a third-party booking system (like Zenoti, Mindbody, Vagaro). These sections are the MOST RELIABLE source for the complete service catalog with accurate pricing. Prioritize them.

INSTRUCTIONS:
1. Extract ONLY legitimate service names — not navigation, headers, or contact phrases
2. Extract service names EVEN WHEN NO PRICE IS PRESENT — a service list on a services/menu page is valid even without prices. Many salons and franchises don't publish prices publicly.
3. For prices, use only explicitly stated values ($50, $85, Starting $116, etc.)
4. For ranges like "$50-$80" use the starting price
5. Never invent prices — omit the price field entirely if not explicitly stated
6. Extract all business hours, phone, email, and addresses found
7. Service names from booking platforms are authoritative — include ALL of them
8. If a page is a services/menu/treatments page, extract EVERY item listed, even without a price

Return ONLY valid JSON:
{
  "services": [{"name": "...", "description": "...", "price": "$XX", "duration_minutes": 60}],
  "hours": [{"day": "Monday", "open_time": "10:00 AM", "close_time": "7:00 PM", "is_closed": false}],
  "business_info": {"name": "...", "addresses": ["..."], "phone": "...", "email": "..."}
}

Content chunk ${i + 1}:
${chunk}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4000,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) { console.error(`OpenAI error for chunk ${i + 1}: ${response.status}`); continue; }

      const data = await response.json();
      let aiResp = data.choices[0].message.content.trim()
        .replace(/^```json\s*/, '').replace(/\s*```$/, '')
        .replace(/^```\s*/, '').replace(/\s*```$/, '');

      const parsed = JSON.parse(aiResp);
      if (parsed.services?.length) allServices.push(...parsed.services);
      if (parsed.hours?.length) allHours.push(...parsed.hours);
      if (parsed.business_info && !businessInfo) businessInfo = parsed.business_info;

      console.log(`Chunk ${i + 1}: ${parsed.services?.length ?? 0} services, ${parsed.hours?.length ?? 0} hours`);
    } catch (err) {
      console.error(`AI extraction failed for chunk ${i + 1}:`, err);
    }

    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  const uniqueServices = allServices.filter((s, i, arr) =>
    arr.findIndex(x => x.name.toLowerCase().trim() === s.name.toLowerCase().trim()) === i
  );
  const uniqueHours = allHours.filter((h, i, arr) =>
    arr.findIndex(x => x.day.toLowerCase() === h.day.toLowerCase()) === i
  );

  console.log(`AI final: ${uniqueServices.length} services, ${uniqueHours.length} hours`);
  return { services: uniqueServices, hours: uniqueHours, business_info: businessInfo };
}

// ── Database save ─────────────────────────────────────────────────────────────

function mapDayToNumber(day: string): number {
  return { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[day.toLowerCase()] ?? 1;
}

function normalizeTime(t: string): string {
  if (!t) return '';
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const h = parseInt(m[1]);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m[2]} ${ap}`;
  }
  return t;
}

async function saveToDatabase(tenantId: string, services: ExtractedService[], hours: ExtractedHours[]) {
  for (const service of services) {
    const price = service.price ? Number(String(service.price).replace(/[^0-9.]/g, '')) : null;
    const { error } = await supabase.from('services').upsert({
      tenant_id: tenantId,
      name: service.name,
      description: service.description,
      price: price || null,
      duration_minutes: service.duration_minutes ?? 30,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id,name' });
    if (error) console.error('Failed to save service:', service.name, error);
  }

  for (const hour of hours) {
    const open = hour.is_closed ? '00:00' : normalizeTime(hour.open_time ?? '09:00 AM');
    const close = hour.is_closed ? '00:00' : normalizeTime(hour.close_time ?? '05:00 PM');
    const { error } = await supabase.from('business_hours').upsert({
      tenant_id: tenantId,
      dow: mapDayToNumber(hour.day),
      open_time: open,
      close_time: close,
      is_closed: hour.is_closed,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id,dow' });
    if (error) console.error('Failed to save hours:', hour.day, error);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { url, tenant_id, tenantId, options = {}, crawlOptions = {} } = body;
    const finalTenantId = tenant_id || tenantId;
    const mergedOptions: CrawlOptions = { ...crawlOptions, ...options };

    if (!url || !finalTenantId) throw new Error('url and tenant_id are required');

    console.log(`Starting extraction for ${url}`);

    // ── Step 1: Crawl main site ──────────────────────────────────────────────
    let content = '';
    let pages_fetched = 0;
    let used_firecrawl = false;
    let extraction_method = 'heuristic';

    try {
      if (FIRECRAWL_API_KEY) {
        const r = await fetchWithFirecrawl(url, mergedOptions);
        content = r.content; pages_fetched = r.pages_fetched;
        used_firecrawl = true; extraction_method = 'firecrawl';
      } else { throw new Error('No Firecrawl key'); }
    } catch (e) {
      console.log('Firecrawl failed, using heuristic:', (e as Error).message);
      const r = await fetchHeuristic(url, mergedOptions);
      content = r.content; pages_fetched = r.pages_fetched;
    }

    if (!content) throw new Error('No content extracted from website');

    // ── Step 2: Detect third-party booking platforms ─────────────────────────
    const detected = detectBookingPlatforms(content);
    console.log(`Detected ${detected.length} booking platform(s):`, detected.map(d => d.platform).join(', ') || 'none');

    // ── Step 3: Scrape booking platforms ────────────────────────────────────
    // Strategy: always try direct API first (structured JSON with prices),
    // then supplement with Firecrawl (JS-rendered HTML) regardless.
    // Zenoti's webstore SPA does not show prices in the HTML rendering,
    // but the underlying catalog API returns price fields.
    let platformContent = '';
    if (detected.length > 0) {
      // Direct API scraping (has price data from JSON responses)
      const apiContent = await scrapeBookingPlatformBasic(detected);
      if (apiContent) {
        platformContent += apiContent;
        console.log(`Direct API: ${apiContent.length} chars from booking platform`);
      }

      // Supplement with Firecrawl (catches any content not in the API)
      if (FIRECRAWL_API_KEY) {
        const fcContent = await scrapeBookingPlatformWithFirecrawl(detected);
        if (fcContent) {
          platformContent += fcContent;
          console.log(`Firecrawl supplement: ${fcContent.length} chars from booking platform`);
        }
      }

      if (platformContent) {
        content += platformContent;
        console.log(`Total booking platform content: ${platformContent.length} chars`);
      }
    }

    // ── Step 3b: Trim main-site content when booking platform data is rich ───
    // 2.4MB of raw HTML overwhelms the AI extraction CPU budget. When we already
    // have authoritative service data from a booking platform, cap the main-site
    // portion to 200KB so the AI can reach the booking platform section.
    if (platformContent.length > 500 && content.length > 300000) {
      const mainEnd = content.indexOf('\n\n=== BOOKING PLATFORM');
      if (mainEnd > 0) {
        const mainTrimmed = content.slice(0, Math.min(mainEnd, 200000));
        content = mainTrimmed + content.slice(mainEnd);
        console.log(`Trimmed main-site content to ${content.length} chars (booking platform data takes priority)`);
      }
    }

    // ── Step 4: Multi-method data extraction ─────────────────────────────────
    const structuredData = extractStructuredData(content);
    const deterministicServices = extractServicesProgrammatically(content);
    const aiData = await extractWithAI(content);

    const allServices = [...deterministicServices, ...structuredData.services, ...aiData.services];
    const allHours = [...structuredData.hours, ...aiData.hours];

    const uniqueServices = allServices.filter((s, i, arr) =>
      arr.findIndex(x => x.name.toLowerCase() === s.name.toLowerCase()) === i
    );
    const uniqueHours = allHours.filter((h, i, arr) =>
      arr.findIndex(x => x.day.toLowerCase() === h.day.toLowerCase()) === i
    );

    console.log(`Final: ${uniqueServices.length} services, ${uniqueHours.length} hours`);

    // ── Step 5: Save to database ─────────────────────────────────────────────
    if (finalTenantId !== 'demo') {
      await saveToDatabase(finalTenantId, uniqueServices, uniqueHours);
    }

    const result: ExtractionResult = {
      services: uniqueServices,
      hours: uniqueHours,
      business_info: aiData.business_info,
      pages_fetched,
      used_firecrawl,
      extraction_method: `${extraction_method}+deterministic+ai${detected.length ? '+booking-platforms' : ''}`,
      detected_platforms: detected,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = (error as Error).message;
    console.error('crawl-ingest error:', msg);
    return new Response(JSON.stringify({
      error: msg, services: [], hours: [],
      pages_fetched: 0, used_firecrawl: false, extraction_method: 'failed'
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
