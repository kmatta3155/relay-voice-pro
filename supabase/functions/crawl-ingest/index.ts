
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

function parseDuration(iso: string): number | undefined {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return m ? (parseInt(m[1] || '0') * 60) + parseInt(m[2] || '0') : undefined;
}

function extractStructuredData(html: string): { services: ExtractedService[]; hours: ExtractedHours[] } {
  const services: ExtractedService[] = [];
  const hours: ExtractedHours[] = [];

  const pushService = (name: string, desc?: string, price?: string | number, dur?: string) => {
    const n = (name || '').replace(/<[^>]+>/g, '').trim();
    if (!n || n.length < 2 || n.length > 100) return;
    const priceStr = price != null && price !== '' ? `$${String(price).replace(/^\$/, '')}` : undefined;
    const durMin = dur ? parseDuration(dur) : undefined;
    services.push({ name: n, description: desc?.replace(/<[^>]+>/g, '').trim() || undefined, price: priceStr, duration_minutes: durMin });
  };

  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim());
      // Normalize: handle @graph arrays, plain arrays, and single objects
      const items: any[] = raw['@graph'] ? raw['@graph'] : Array.isArray(raw) ? raw : [raw];

      for (const item of items) {
        const type = ([] as string[]).concat(item['@type'] ?? []).join(',');

        // hasOfferCatalog (on LocalBusiness, Service, etc.)
        if (item.hasOfferCatalog?.itemListElement) {
          for (const e of ([] as any[]).concat(item.hasOfferCatalog.itemListElement)) {
            const n = e.name || e.itemOffered?.name;
            if (n) pushService(n, e.description || e.itemOffered?.description,
              e.offers?.price ?? e.price, e.offers?.duration);
          }
        }

        // makesOffer / offers array
        const offerList = ([] as any[]).concat(item.makesOffer ?? item.offers ?? []);
        for (const offer of offerList) {
          if (typeof offer !== 'object' || !offer) continue;
          const n = offer.name || offer.itemOffered?.name;
          if (n) pushService(n, offer.description || offer.itemOffered?.description,
            offer.price ?? offer.priceSpecification?.price);
        }

        // ItemList / OfferCatalog (standalone service catalog)
        if (/ItemList|OfferCatalog/.test(type) && item.itemListElement) {
          for (const el of ([] as any[]).concat(item.itemListElement)) {
            const sub = el.item ?? el;
            pushService(sub.name, sub.description, sub.offers?.price ?? sub.price);
          }
        }

        // Service type directly
        if (/Service|Product/.test(type) && item.name) {
          pushService(item.name, item.description, item.offers?.price ?? item.price);
        }

        // Menu / MenuItem (restaurants, food)
        if (/Menu$/.test(type) && item.hasMenuSection) {
          for (const sec of ([] as any[]).concat(item.hasMenuSection)) {
            for (const mi of ([] as any[]).concat(sec.hasMenuItem ?? [])) {
              pushService(mi.name, mi.description, mi.offers?.price ?? mi.suitableForDiet);
            }
          }
        }

        // Business hours — openingHoursSpecification (array of objects)
        if (item.openingHoursSpecification) {
          for (const spec of ([] as any[]).concat(item.openingHoursSpecification)) {
            for (const d of ([] as any[]).concat(spec.dayOfWeek ?? [])) {
              const day = (typeof d === 'string' ? d : '').replace(/^.*\//, '');
              if (day) hours.push({ day, open_time: spec.opens, close_time: spec.closes, is_closed: !spec.opens });
            }
          }
        }

        // Business hours — openingHours string format: "Mo-Fr 09:00-17:00"
        if (item.openingHours) {
          const abbr = ['Su','Mo','Tu','We','Th','Fr','Sa'];
          const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          for (const spec of ([] as any[]).concat(item.openingHours)) {
            const m2 = /^([A-Z][a-z])(?:-([A-Z][a-z]))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(spec);
            if (!m2) continue;
            const si = abbr.indexOf(m2[1]), ei = m2[2] ? abbr.indexOf(m2[2]) : si;
            if (si >= 0) for (let i = si; i <= ei; i++)
              hours.push({ day: names[i], open_time: m2[3], close_time: m2[4], is_closed: false });
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

  const pushService = (name: string, priceText?: string, description?: string) => {
    const nameClean = name.trim().replace(/\s{2,}/g, ' ');
    if (!nameClean || nameClean.length < 2 || nameClean.length > 100) return;
    let price: string | undefined;
    if (priceText) {
      const numMatch = priceText.match(/(\d{1,4}(?:\.\d{1,2})?)/);
      if (numMatch) price = `$${numMatch[1]}`;
    }
    const descClean = description?.trim().replace(/\s{2,}/g, ' ');
    const existing = services.find(s => s.name.toLowerCase() === nameClean.toLowerCase());
    if (existing) {
      // Enrich an earlier hit that lacked price/description
      if (!existing.price && price) existing.price = price;
      if (!existing.description && descClean) existing.description = descClean;
      return;
    }
    services.push({
      name: nameClean,
      price,
      description: descClean && descClean.length >= 10 && descClean.length <= 300 ? descClean : undefined,
    });
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

    // List items — extract with price if present, or without price when the
    // list sits under a service-category heading ("Hair Services" yes,
    // "Locations" no). Headings are tracked in document order so multi-column
    // lists under one heading all inherit it.
    const isServicePage = /service|menu|treatment|pricing|package/i.test(url);
    const navWords = /^(home|welcome|menu|blog|news|contact(\s*us)?|about(\s*us)?|login|sign[\s-]?up|faqs?|privacy(\s*policy)?|terms.*|cart|shop|search|locations?|franchise.*|deals?|memberships?|e?gift\s*cards?|book\s*(now|online|an?\s+\w+)?|view\s*(our\s*)?services|next\s*steps?|request(\s*more\s*info)?|costs?\/?fees?|hairstyle|gallery|portfolio|our\s*story|team|staff|reviews?|careers?|press|sitemap|accessibility|cookie|logout|account|profile|schedule|appointment|call\s*us|services)$/i;
    const SERVICE_HEADING = /(service|treatment|package|deal|pricing|menu|hair|beauty|colou?r|cut|styl|nail|lash|wax|facial|massage|makeup|bridal|wedding|prom|tan|spa|barber|shave|brow|skin|extension|keratin|perm|men|women|kid|child)/i;
    const NEGATIVE_HEADING = /(location|hour|contact|about|find\s*us|visit|career|team|staff|review|follow|social|partner|press|blog|faq|map|direction|neighborhood|area)/i;

    // Walk headings and lists in document order, tracking the last heading seen
    const headingOrListRe = /<(h[1-5])[^>]*>([\s\S]*?)<\/\1>|<[ou]l[^>]*>([\s\S]*?)<\/[ou]l>/gi;
    let lastHeading = '';
    let node: RegExpExecArray | null;
    while ((node = headingOrListRe.exec(html)) !== null) {
      if (node[1]) { lastHeading = clean(node[2]); continue; }   // heading
      const listHtml = node[3] ?? '';
      const isServiceList = isServicePage &&
        lastHeading !== '' &&
        SERVICE_HEADING.test(lastHeading) &&
        !NEGATIVE_HEADING.test(lastHeading);

      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRegex.exec(listHtml)) !== null) {
        const text = clean(li[1]);
        if (!text || text.length < 3 || text.length > 120) continue;
        // With explicit $ price — strong signal, no heading gate needed.
        // $ is required so numbers inside names ("Child 12 and Under") aren't prices.
        const mt = text.match(/^(.{2,100}?)[\s:,-]*\s*(\$\d[\d.+]*)(?:\s|$)/);
        if (mt) { pushService(mt[1], mt[2]); continue; }
        // Without price: only inside a service-category section.
        // Require capitalized/numeric start — prose fragments and link text
        // ("check out our rotating mixtapes") start lowercase.
        if (isServiceList &&
            !navWords.test(text) &&
            !/^[a-z]/.test(text) &&
            !/^https?:\/\//.test(text) &&
            !/^\d+$/.test(text) &&
            !/[<>{}]/.test(text)) {
          pushService(text);
        }
      }
    }

    // Page-builder layouts (Elementor, Divi, Wix): price and name in adjacent
    // headings, description in a nearby <p>. Handles both orders:
    //   <h4>$39+</h4><h2>short cut</h2><p>desc</p>   (price first)
    //   <h2>Balayage</h2><h4>$120</h4><p>desc</p>    (name first)
    const blockRe = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
    const blocks: { tag: string; text: string }[] = [];
    let blk: RegExpExecArray | null;
    while ((blk = blockRe.exec(html)) !== null) {
      const t = clean(blk[2]);
      if (t) blocks.push({ tag: blk[1].toLowerCase()[0] === 'h' ? 'h' : 'p', text: t });
    }
    const isPriceOnly = (t: string) => /^\$\s*\d[\d.,]*\s*\+?$/.test(t);
    for (let i = 0; i < blocks.length; i++) {
      if (!isPriceOnly(blocks[i].text)) continue;
      const nameBlock = [blocks[i + 1], blocks[i - 1]].find(n =>
        n && n.tag === 'h' && !isPriceOnly(n.text) &&
        n.text.length >= 3 && n.text.length <= 80 && !navWords.test(n.text));
      if (!nameBlock) continue;
      let desc: string | undefined;
      for (let j = i + 1; j <= i + 3 && j < blocks.length; j++) {
        if (blocks[j].tag === 'p' && !isPriceOnly(blocks[j].text) &&
            blocks[j].text !== nameBlock.text && blocks[j].text.length >= 15 && blocks[j].text.length <= 300) {
          desc = blocks[j].text; break;
        }
      }
      pushService(nameBlock.text, blocks[i].text, desc);
    }

    // Definition lists: <dl><dt>Service</dt><dd>$price or description</dd></dl>
    const dlRegex = /<dl[^>]*>([\s\S]*?)<\/dl>/gi;
    let dl: RegExpExecArray | null;
    while ((dl = dlRegex.exec(html)) !== null) {
      const dtMatches = [...dl[1].matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/gi)].map(m => clean(m[1]));
      const ddMatches = [...dl[1].matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)].map(m => clean(m[1]));
      for (let i = 0; i < dtMatches.length; i++) {
        const name = dtMatches[i];
        if (name && name.length > 2 && name.length < 100) {
          pushService(name, ddMatches[i]);
        }
      }
    }

    // Div/article/section cards with service-related class names
    // Matches: <div class="service-card">, <article class="treatment">, etc.
    const cardRe = /<(?:div|article|section|li|figure)[^>]*class=["'][^"']*(?:service|treatment|menu[-_]?item|package|offering|product[-_]?item|price[-_]?item)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section|li|figure)>/gi;
    let card: RegExpExecArray | null;
    while ((card = cardRe.exec(html)) !== null) {
      const inner = card[1];
      // Name: first heading or strong/b tag inside the card
      const nameMatch = inner.match(/<(?:h[2-6]|strong|b|[^>]*class=["'][^"']*(?:title|name|heading)[^"']*["'])[^>]*>([\s\S]*?)<\/(?:h[2-6]|strong|b|[^>]*)>/i);
      if (!nameMatch) continue;
      const cardName = clean(nameMatch[1]);
      if (!cardName || cardName.length < 3 || cardName.length > 100) continue;
      // Price: look for $ amount anywhere in the card
      const priceMatch = inner.match(/\$\s*(\d[\d,.]*)/);
      pushService(cardName, priceMatch ? `$${priceMatch[1]}` : undefined);
    }

    // Heading + adjacent price pattern: <h3>Service</h3> ... <span>$45</span>
    // Captures service names from heading-based layouts used by many modern CMSes
    const headingPriceRe = /<h([2-5])[^>]*>([\s\S]*?)<\/h\1>([\s\S]{0,300}?)(\$\s*\d[\d,.]*)/gi;
    let hp: RegExpExecArray | null;
    while ((hp = headingPriceRe.exec(html)) !== null) {
      const headingText = clean(hp[2]);
      const priceText = hp[4].trim();
      if (headingText && headingText.length > 2 && headingText.length < 80 &&
          !/^(our\s|about|contact|menu|home|gallery|team|staff|book|call|welcome|follow)/i.test(headingText)) {
        pushService(headingText, priceText);
      }
    }

    // Plain text lines: "Name $price" — $ required to avoid corrupting names with numbers
    const lineRegex = /([A-Za-z][A-Za-z0-9\s()\/&.-]{2,80})\s+(?:–|-|:)?\s*(\$\d[\d.+]*)(?=\s|$)/g;
    const text = clean(html);
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(text)) !== null) {
      const nm = lineMatch[1].trim();
      // Skip prose fragments: lowercase start or sentence-ending punctuation
      // ("...for every style, gender, and age. $39" is not a service)
      if (/^[a-z]/.test(nm) || /[.!?]$/.test(nm)) continue;
      pushService(nm, lineMatch[2]);
    }
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

// ── Firecrawl LLM extract mode ────────────────────────────────────────────────
// Uses Firecrawl's built-in AI extraction on a rendered page. Handles any HTML
// structure (div cards, SPAs, React/Vue/Angular, iframes) because Firecrawl
// renders JS first, then the LLM extracts from the visible content.

// Common service page paths to probe at the root domain.
// Covers: generic service pages, beauty/salon specific, restaurant menus,
// medical/spa/automotive, and common CMS slug patterns.
const COMMON_SERVICE_PATHS = [
  '/services', '/service', '/menu', '/our-menu', '/treatments', '/our-services',
  '/service-menu', '/pricing', '/packages', '/offerings', '/what-we-do',
  '/services-menu', '/beauty-services', '/hair-services', '/salon-services',
  '/spa-menu', '/spa-services', '/medical-services', '/our-work',
  '/services-and-pricing', '/services-pricing', '/services/menu',
];

async function findServicePageUrls(content: string, inputUrl: string): Promise<string[]> {
  const serviceUrlPattern = /service|treatment|menu|pricing|package|offering|our-work|what-we-do/i;
  const skipPattern = /blog|news|cart|checkout|login|wp-admin|sitemap|tag|category/i;
  const seen = new Set<string>();
  const urls: string[] = [];

  // 1. URLs already found in the crawled content
  const pageRe = /=== PAGE\s+\d+:\s+(https?:\/\/[^\s\n]+)\s+===/g;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(content)) !== null) {
    const u = m[1].trim();
    if (serviceUrlPattern.test(u) && !skipPattern.test(u) && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  // 2. Probe common service paths at the ROOT domain.
  // This handles cases where crawl started from a location-specific subpath
  // (e.g. /raleigh-nc-ridgewood) and Firecrawl never visited /services.
  try {
    const root = new URL(inputUrl).origin;
    const probes = COMMON_SERVICE_PATHS.map(p => root + p).filter(u => !seen.has(u));

    // Quick existence check — HEAD request, no body downloaded
    const checks = probes.slice(0, 10).map(async (probeUrl) => {
      try {
        const r = await fetch(probeUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VoiceRelayBot/1.0)' },
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        });
        if (r.ok) return probeUrl;
      } catch { /* ignore */ }
      return null;
    });

    const found = (await Promise.all(checks)).filter(Boolean) as string[];
    for (const u of found) {
      if (!seen.has(u)) { seen.add(u); urls.push(u); }
    }
    if (found.length > 0) console.log(`Root domain service pages found: ${found.join(', ')}`);
  } catch (e) {
    console.warn('Service page probe error:', (e as Error).message);
  }

  return urls.slice(0, 5); // max 5 service pages
}

// Fetch service pages directly as plain HTML and inject into the content buffer.
// This lets extractServicesProgrammatically process all <li>/<dt>/<div> items
// without LLM token limits or price hallucination.
// Returns: updated content and any URLs that appear to be SPAs (need Firecrawl).
async function fetchAndInjectServicePages(
  urls: string[],
  content: string
): Promise<{ content: string; spaUrls: string[] }> {
  const spaUrls: string[] = [];
  let pageCount = (content.match(/=== PAGE \d+:/g) || []).length + 1;

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VoiceRelayBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) { console.log(`Skip ${url}: HTTP ${resp.status}`); continue; }

      const html = await resp.text();
      const textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      if (textOnly.length < 500) {
        // Tiny text content → likely a SPA that needs JS rendering
        spaUrls.push(url);
        console.log(`SPA detected at ${url} (${textOnly.length} text chars) — queued for Firecrawl`);
        continue;
      }

      // Plain HTML — inject for all extraction methods to process
      content += `\n\n=== PAGE ${pageCount++}: ${url} ===\n[HTML_CONTENT]\n${html}\n[/HTML_CONTENT]\n`;
      console.log(`Injected service page: ${url} (${html.length} HTML chars, ${textOnly.length} text chars)`);
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return { content, spaUrls };
}

// Firecrawl LLM extract — used ONLY for SPA pages where plain HTML fetch returns
// minimal content (JS-rendered sites like Zenoti, Mindbody, Vagaro).
async function extractServicesWithFirecrawlExtract(servicePageUrls: string[]): Promise<ExtractedService[]> {
  if (!FIRECRAWL_API_KEY || servicePageUrls.length === 0) return [];
  const all: ExtractedService[] = [];

  for (const url of servicePageUrls) {
    console.log(`Firecrawl extract mode (SPA): ${url}`);
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['extract'],
          waitFor: 6000,
          extract: {
            prompt: `Extract ALL services, treatments, packages, and menu items from this page.
CRITICAL RULES:
- Extract EVERY service listed, no matter how many there are — do not stop early
- NEVER invent or guess prices. If no price is shown next to a service, omit the price field completely
- Many businesses deliberately do not publish prices; that is normal
- Include service name (required), price only if explicitly displayed, description if available`,
            schema: {
              type: 'object',
              properties: {
                services: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      price: { type: 'string' },
                      description: { type: 'string' },
                      duration_minutes: { type: 'number' }
                    },
                    required: ['name']
                  }
                }
              }
            }
          }
        }),
        signal: AbortSignal.timeout(40000),
      });

      if (!resp.ok) { console.warn(`Firecrawl extract ${resp.status} for ${url}`); continue; }
      const data = await resp.json();
      const extracted: any[] = data?.data?.extract?.services ?? data?.extract?.services ?? [];
      console.log(`Firecrawl extract: ${extracted.length} services from ${url}`);

      for (const svc of extracted) {
        const name = (svc.name || '').trim();
        if (name.length < 2 || name.length > 100) continue;
        // Only use price if it looks like a real dollar amount, not a hallucination
        const priceRaw = svc.price ? String(svc.price).replace(/[^\d.]/g, '') : '';
        const price = priceRaw && parseFloat(priceRaw) > 0 ? `$${priceRaw}` : undefined;
        all.push({ name, price, description: svc.description?.trim() || undefined, duration_minutes: svc.duration_minutes || undefined });
      }
    } catch (err) {
      console.error(`Firecrawl extract error for ${url}:`, (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return all;
}

// ── Final quality pass ────────────────────────────────────────────────────────

// Repair UTF-8 bytes that were decoded as Latin-1 ("Womenâ\x80\x99s" → "Women's").
// Re-encodes char codes as bytes and decodes as UTF-8; throws (→ keep original)
// when the string isn't actually mojibake.
function fixMojibake(s: string): string {
  if (!s || !/[Â-ä]/.test(s)) return s;
  try {
    const codes = [...s].map(c => c.charCodeAt(0));
    if (codes.some(c => c > 255)) return s;
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(codes));
  } catch { return s; }
}

const SENTENCE_FRAGMENT = /\b(may be subject|are subject to|prices? (may )?vary|please call|please contact|disclaimer|terms and conditions)\b/i;
const JUNK_EXACT = /^(disclaimer|notes?|important|attention|pricing|prices|map|directions?|parking|wifi|hours?)$/i;

function finalServiceFilter(list: ExtractedService[]): ExtractedService[] {
  return list
    .map(s => ({
      ...s,
      name: fixMojibake(s.name).replace(/\s{2,}/g, ' ').trim(),
      description: s.description ? fixMojibake(s.description) : undefined,
    }))
    .filter(s => {
      const words = s.name.split(/\s+/).length;
      if (words >= 12) return false;                        // sentence fragments
      if (SENTENCE_FRAGMENT.test(s.name)) return false;     // disclaimer text
      if (JUNK_EXACT.test(s.name)) return false;
      // ALL-CAPS short names with no digits are category headers (BLOWOUTS, WAX - THREADING)
      if (/^[^a-z]+$/.test(s.name) && words <= 4 && !/\d/.test(s.name)) return false;
      return true;
    });
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { url, tenant_id, tenantId, options = {}, crawlOptions = {} } = body;
    const finalTenantId = tenant_id || tenantId;
    const mergedOptions: CrawlOptions = { ...crawlOptions, ...options };

    if (!url || !finalTenantId) {
      return new Response(JSON.stringify({ error: 'url and tenant_id are required', services: [], hours: [], pages_fetched: 0, used_firecrawl: false, extraction_method: 'failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // verify_jwt is off (public demo uses tenant 'demo' with no DB writes).
    // Writes into a REAL tenant require a valid user who is a member of it —
    // otherwise anyone with the anon key could overwrite a tenant's services.
    if (finalTenantId !== 'demo') {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Authentication required for tenant crawls' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: mem } = await supabase.from('memberships')
        .select('user_id').eq('tenant_id', finalTenantId).eq('user_id', userData.user.id).maybeSingle();
      if (!mem) {
        return new Response(JSON.stringify({ error: 'Not authorized for this tenant' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

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

    // ── Step 3c: Inject missed service pages + SPA fallback ─────────────────
    // Phase 1: Probe root domain for service pages not reached by the main crawl
    //          (e.g. user entered /raleigh-nc-ridgewood, missed /services).
    //          Fetch their HTML directly and inject into content so all
    //          extraction methods (especially programmatic <li> parsing) can use them.
    // Phase 2: Pages that return minimal HTML (SPAs) are queued for Firecrawl
    //          LLM extract which renders JS before extracting.
    let firecrawlExtractServices: ExtractedService[] = [];
    const serviceUrls = await findServicePageUrls(content, url);
    if (serviceUrls.length > 0) {
      console.log(`Service pages to process: ${serviceUrls.join(', ')}`);
      const { content: injectedContent, spaUrls } = await fetchAndInjectServicePages(serviceUrls, content);
      content = injectedContent;

      // SPA pages need Firecrawl to render JS before extracting
      if (FIRECRAWL_API_KEY && spaUrls.length > 0) {
        console.log(`Firecrawl extract on ${spaUrls.length} SPA page(s):`, spaUrls);
        firecrawlExtractServices = await extractServicesWithFirecrawlExtract(spaUrls);
        console.log(`Firecrawl SPA extract total: ${firecrawlExtractServices.length} services`);
      }
    }

    // ── Step 4: Multi-method data extraction ─────────────────────────────────
    const structuredData = extractStructuredData(content);
    const deterministicServices = extractServicesProgrammatically(content);
    const aiData = await extractWithAI(content);

    // Guard against AI hallucination: when deterministic methods already found
    // a solid catalog, the AI list only adds invented generics ("Haircut $50",
    // "Massage $90"). When deterministic found little, AI services are kept but
    // each name must actually appear somewhere in the crawled content.
    // IMPORTANT: count AFTER quality filtering so junk (nav items, category
    // headers) can't suppress legitimate AI results.
    const nonAiFiltered = finalServiceFilter([
      ...firecrawlExtractServices,
      ...deterministicServices,
      ...structuredData.services,
    ]);
    const nonAiCount = nonAiFiltered.length;
    let aiServices = aiData.services;
    if (nonAiCount >= 15) {
      console.log(`Deterministic extraction found ${nonAiCount} services — discarding ${aiServices.length} AI-extracted services (hallucination guard)`);
      aiServices = [];
    } else {
      const contentTextLower = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
      const before = aiServices.length;
      aiServices = aiServices.filter(s => contentTextLower.includes(s.name.toLowerCase()));
      if (before !== aiServices.length) console.log(`AI verification: ${before} → ${aiServices.length} services (dropped names not present in content)`);
    }

    // Merge: quality-filtered deterministic sources first, then verified AI
    const allServices = [...nonAiFiltered, ...aiServices];
    const allHours = [...structuredData.hours, ...aiData.hours];

    // Quality pass first (mojibake repair, category headers, fragments),
    // then fuzzy dedup so "Women's Haircut" and mojibaked "Womenâ€™s Haircut"
    // resolve to the same key after repair.
    const cleanedServices = finalServiceFilter(allServices);
    const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const seen = new Set<string>();
    const uniqueServices = cleanedServices.filter(s => {
      const key = normName(s.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Prefer entries that have a price over duplicates without
    // (done by ordering firecrawlExtractServices first — they're most complete)

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
      extraction_method: `${extraction_method}+llm-extract+deterministic+ai${detected.length ? '+booking-platforms' : ''}`,
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
