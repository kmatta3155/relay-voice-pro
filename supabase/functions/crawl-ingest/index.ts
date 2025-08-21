// deno-lint-ignore-file no-explicit-any
/**
 * Generic, site-agnostic website crawler + extractor for SMBs.
 * - Crawls same eTLD+1 (optionally subdomains), respects robots + sitemaps
 * - Extracts schema.org JSON-LD / microdata first, then heuristics
 * - Writes to knowledge_sources, knowledge_chunks, business_quick_answers
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://esm.sh/linkedom@0.16.10/worker";

type Options = {
  includeSubdomains?: boolean;
  respectRobots?: boolean;
  followSitemaps?: boolean;
  maxPages?: number;
  maxDepth?: number;
  rateLimitMs?: number;
  allowPatterns?: string[];
  denyPatterns?: string[];
};
type Payload = { tenantId: string; url: string; options?: Options };

const DEFAULTS: Required<Options> = {
  includeSubdomains: true,
  respectRobots: true,
  followSitemaps: true,
  maxPages: 120,
  maxDepth: 4,
  rateLimitMs: 400,
  allowPatterns: [],
  denyPatterns: [],
};

const TEXT_MIN = 200;
const CHUNK_MAX = 1400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function canonical(u: string) {
  try { const url = new URL(u); url.hash = ""; if (!url.pathname) url.pathname = "/"; return url.toString(); } catch { return ""; }
}
function eTLDPlusOne(host: string) { const p = host.split(".").filter(Boolean); return p.length <= 2 ? host : p.slice(-2).join("."); }
function sameSiteOrSub(root: string, host: string, includeSubs: boolean) { return host === root || (includeSubs && host.endsWith("." + root)); }
function matches(url: string, allow: string[], deny: string[]) {
  if (deny.length && deny.some((r) => new RegExp(r, "i").test(url))) return false;
  if (allow.length) return allow.some((r) => new RegExp(r, "i").test(url));
  return true;
}
async function fetchText(u: string) {
  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${u}`);
  const ct = res.headers.get("content-type") || "";
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(ct);
  return { text: isHtml ? await res.text() : "", contentType: ct, ok: isHtml };
}
async function fetchRobots(base: URL) { try { const txt = await fetch(new URL("/robots.txt", base)).then(r => r.ok ? r.text() : ""); return txt; } catch { return ""; } }
function robotsDisallow(robotsTxt: string, path: string) {
  if (!robotsTxt) return false;
  const lines = robotsTxt.split(/\r?\n/); let active = false; const disallowed: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^user-agent:\s*\*/i.test(l)) { active = true; continue; }
    if (/^user-agent:/i.test(l)) { active = false; continue; }
    if (active) { const m = l.match(/^disallow:\s*(.*)$/i); if (m) disallowed.push(m[1].trim() || "/"); }
  }
  return disallowed.some((p) => p !== "/" && path.startsWith(p));
}
async function parseSitemaps(baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl); const urls: string[] = [];
  try {
    const robots = await fetchRobots(base);
    const sm = [...robots.matchAll(/Sitemap:\s*(.+)\s*/ig)].map(m => m[1].trim());
    for (const s of sm) {
      try { const xml = await fetch(s).then(r => r.ok ? r.text() : ""); for (const loc of xml.matchAll(/<loc>([^<]+)<\/loc>/ig)) urls.push(loc[1].trim()); } catch {}
    }
  } catch {}
  for (const p of ["/sitemap.xml", "/sitemap_index.xml"]) {
    try { const xml = await fetch(new URL(p, base)).then(r => r.ok ? r.text() : ""); for (const loc of xml.matchAll(/<loc>([^<]+)<\/loc>/ig)) urls.push(loc[1].trim()); } catch {}
  }
  return Array.from(new Set(urls));
}

// ----- structured data + heuristics -----
function readJsonLd(doc: any) {
  const out: any[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s: any) => {
    try { const val = JSON.parse(s.textContent || "null"); if (!val) return; Array.isArray(val) ? out.push(...val) : out.push(val); } catch {}
  });
  return out;
}
function pickFirst<T>(list: (T | null | undefined)[]): T | null { for (const x of list) if (x) return x as T; return null; }
function normalizeHoursFromJsonLd(entries: any[]) {
  const hours: Array<{ day: string; opens: string; closes: string }> = [];
  const specNodes = entries.flatMap(e =>
    e?.openingHoursSpecification ? (Array.isArray(e.openingHoursSpecification) ? e.openingHoursSpecification : [e.openingHoursSpecification]) : []
  );
  for (const spec of specNodes) {
    const days = spec.dayOfWeek ? (Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek]).map((d: string) => d.split("/").pop() || d) : [];
    for (const d of days) if (spec.opens && spec.closes) hours.push({ day: d, opens: spec.opens, closes: spec.closes });
  }
  const ohText = entries.flatMap(e => (e.openingHours ? (Array.isArray(e.openingHours) ? e.openingHours : [e.openingHours]) : []));
  for (const line of ohText) {
    const m = String(line).match(/(Mo|Tu|We|Th|Fr|Sa|Su)[^\d]*?(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/i);
    if (m) hours.push({ day: m[1], opens: m[2], closes: m[3] });
  }
  return hours;
}
function extractFromSchema(doc: any) {
  const jsonld = readJsonLd(doc);
  const tel = pickFirst(jsonld.map(j => j?.telephone)) || undefined;
  const email = pickFirst(jsonld.map(j => j?.email)) || undefined;
  const addr = pickFirst(jsonld.map(j => {
    const a = j?.address; if (!a) return null; if (typeof a === "string") return a;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean); return parts.join(", ");
  })) || undefined;

  const services: Array<{ name: string; price?: string }> = [];
  const addOffer = (o: any) => {
    if (!o) return;
    const name = o.itemOffered?.name || o.name || o.description;
    const price = o.price || o.priceSpecification?.price || o.offers?.price;
    if (name) services.push({ name: String(name).slice(0, 140), price: price ? `$${price}` : undefined });
  };
  jsonld.forEach((j) => {
    const catalogs = j?.hasOfferCatalog;
    if (catalogs) {
      const items = catalogs.itemListElement || catalogs.itemList || [];
      (Array.isArray(items) ? items : [items]).forEach((it: any) => addOffer(it));
    }
    const offers = j?.offers || j?.makesOffer;
    if (offers) (Array.isArray(offers) ? offers : [offers]).forEach((o: any) => addOffer(o));
  });

  const business_hours = normalizeHoursFromJsonLd(jsonld);
  return { phone: tel, email, address: addr, services, business_hours };
}
function cleanBodyText(doc: any) {
  doc.querySelectorAll("script,style,noscript,svg,iframe,canvas,form,nav,footer,header,aside").forEach((n: any) => n.remove());
  doc.querySelectorAll('[role="navigation"], [aria-label*="menu" i]').forEach((n: any) => n.remove());
  const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  return text;
}
function splitChunks(text: string) {
  if (!text || text.length < TEXT_MIN) return [];
  const parts: string[] = []; let buf = "";
  for (const seg of text.split(/(?<=[\.\!\?])\s+/)) {
    if ((buf + " " + seg).length > CHUNK_MAX) { if (buf.trim().length) parts.push(buf.trim()); buf = seg; }
    else buf = buf ? buf + " " + seg : seg;
  }
  if (buf.trim().length) parts.push(buf.trim());
  return parts.filter((p) => p.length >= TEXT_MIN);
}
function heuristicExtract(doc: any, pageText: string) {
  const phone = pageText.match(/(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0] || undefined;
  const email = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || undefined;
  const address = pageText.match(/\d{2,5}\s+[A-Za-z][A-Za-z\s\.\-]+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b.*?\b[A-Z]{2}\b\s+\d{5}/i)?.[0];
  const hoursLines: string[] = [];
  doc.querySelectorAll("li, p, div, span").forEach((el: any) => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (!t) return;
    if (/Mon(day)?|Tue(s(day)?)?|Wed(nesday)?|Thu(rsday)?|Fri(day)?|Sat(urday)?|Sun(day)?/i.test(t) &&
        /\d{1,2}(:\d{2})?\s?(AM|PM)?\s?[-–—]\s?\d{1,2}(:\d{2})?\s?(AM|PM)?/i.test(t)) hoursLines.push(t);
  });
  const services: Array<{ name: string; price?: string }> = [];
  doc.querySelectorAll("li, p, div, table").forEach((el: any) => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (!t || t.length < 6) return;
    const price = t.match(/[$£€]\s?\d{1,4}(\.\d{2})?/);
    const hasSvc = /cut|color|colour|balayage|foil|highlight|style|perm|treatment|massage|facial|wax|thread|mani|pedi|consult/i.test(t);
    if (price && hasSvc) { const name = t.replace(/[$£€]\s?\d{1,4}(\.\d{2})?/g, "").trim(); services.push({ name: name.slice(0,140), price: price[0] }); }
  });
  return {
    phone, email, address,
    business_hours: Array.from(new Set(hoursLines)).slice(0,10).map(line => ({ day: line, opens: "", closes: "" })),
    services,
  };
}

// ----- main -----
serve(async (req) => {
  try {
    const payload = (await req.json()) as Payload;
    const opts = { ...DEFAULTS, ...(payload.options || {}) };
    const start = new URL(payload.url);
    const root = eTLDPlusOne(start.hostname);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const visited = new Set<string>();
    const queue: Array<{ u: string; depth: number }> = [{ u: canonical(start.toString()), depth: 0 }];
    const discovered: string[] = [];

    const robotsTxt = opts.respectRobots ? await fetchRobots(start) : "";
    const sitemaps = opts.followSitemaps ? await parseSitemaps(start.toString()) : [];
    for (const smUrl of sitemaps.slice(0, 200)) {
      const cu = canonical(smUrl); if (!cu) continue;
      const h = new URL(cu).hostname;
      if (sameSiteOrSub(root, h, opts.includeSubdomains) && matches(cu, opts.allowPatterns, opts.denyPatterns)) {
        queue.push({ u: cu, depth: 0 });
      }
    }

    while (queue.length && discovered.length < opts.maxPages) {
      const { u, depth } = queue.shift()!;
      if (!u || visited.has(u)) continue;
      const urlObj = new URL(u);
      if (!sameSiteOrSub(root, urlObj.hostname, opts.includeSubdomains)) continue;
      if (!matches(u, opts.allowPatterns, opts.denyPatterns)) continue;
      if (opts.respectRobots && robotsDisallow(robotsTxt, urlObj.pathname)) continue;

      visited.add(u);
      await sleep(opts.rateLimitMs);

      let html = ""; let ok = false;
      try { const res = await fetchText(u); html = res.text; ok = res.ok; } catch { continue; }
      if (!ok || !html) continue;

      discovered.push(u);

      const dom = new DOMParser().parseFromString(html, "text/html");
      const title = dom.querySelector("title")?.textContent?.trim() || urlObj.hostname;

      const schemaBits = extractFromSchema(dom);
      const pageText = cleanBodyText(dom);
      const chunks = splitChunks(pageText);
      const heur = heuristicExtract(dom, pageText);

      const phone = schemaBits.phone || heur.phone;
      const email = schemaBits.email || heur.email;
      const address = schemaBits.address || heur.address;
      const services = schemaBits.services?.length ? schemaBits.services : heur.services;
      const business_hours = schemaBits.business_hours?.length ? schemaBits.business_hours : heur.business_hours;

      const { data: srcRow, error: sErr } = await sb
        .from("knowledge_sources")
        .insert({
          tenant_id: payload.tenantId,
          source_url: u,
          title,
          meta: {
            crawl_method: "crawler",
            description: dom.querySelector('meta[name="description"]')?.getAttribute("content") || "",
            business_info: { source_url: u, phone, email, address, services, business_hours },
          },
        })
        .select("id")
        .single();
      if (sErr) continue;

      if (chunks.length) {
        const rows = chunks.slice(0, 60).map((c, i) => ({
          tenant_id: payload.tenantId,
          source_id: srcRow.id,
          content: c,
          url: u,
          position: i,
        }));
        await sb.from("knowledge_chunks").insert(rows);
      }

      if (phone) await sb.from("business_quick_answers").upsert({ tenant_id: payload.tenantId, question_type: "phone", answer: phone }, { onConflict: "tenant_id,question_type" });
      if (email) await sb.from("business_quick_answers").upsert({ tenant_id: payload.tenantId, question_type: "email", answer: email }, { onConflict: "tenant_id,question_type" });
      if (business_hours?.length) {
        await sb.from("business_quick_answers").upsert({
          tenant_id: payload.tenantId,
          question_type: "hours",
          answer: business_hours.map((h: any) => h.day && h.opens && h.closes ? `${h.day}: ${h.opens}-${h.closes}` : String(h.day || "")).filter(Boolean).join(" | "),
        }, { onConflict: "tenant_id,question_type" });
      }

      if (depth < opts.maxDepth) {
        dom.querySelectorAll("a[href]").forEach((a: any) => {
          try {
            const href = a.getAttribute("href") || ""; if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
            const next = canonical(new URL(href, u).toString()); if (!next || visited.has(next)) return;
            const host = new URL(next).hostname;
            if (!sameSiteOrSub(root, host, opts.includeSubdomains)) return;
            if (!matches(next, opts.allowPatterns, opts.denyPatterns)) return;
            queue.push({ u: next, depth: depth + 1 });
          } catch {}
        });
      }
    }

    const { data: latest } = await sb
      .from("knowledge_sources").select("meta")
      .eq("tenant_id", payload.tenantId)
      .order("created_at", { ascending: false })
      .limit(25);

    let best: any = null;
    for (const row of latest || []) {
      const bi = (row.meta as any)?.business_info; if (!bi) continue;
      const score = (bi.services?.length ? 1 : 0) + (bi.business_hours?.length ? 1 : 0) + (bi.phone ? 0.5 : 0);
      if (!best || score > best._score) best = { ...bi, _score: score };
    }
    if (best) delete (best as any)._score;

    return new Response(JSON.stringify({ ok: true, pagesIndexed: (latest?.length ?? 0), business_info: best || null }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 400 });
  }
});
