// deno-lint-ignore-file no-explicit-any
/**
 * Universal website crawler + extractor.
 * - Crawls same eTLD+1 (+ subdomains) with respect for robots and sitemaps
 * - Follows <a> and <iframe>; whitelists common booking providers (Square, Vagaro, Fresha, Boulevard, Mindbody, GlossGenius, Acuity, Calendly)
 * - Extracts schema.org JSON-LD first; falls back to heuristics for services/prices, hours, contact, address
 * - Writes into knowledge_sources, knowledge_chunks, business_quick_answers
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
  includeBookingProviders?: boolean;
  extraAllowedHosts?: string[];
};
type Payload = { tenantId: string; url: string; options?: Options };

const DEFAULTS: Required<Options> = {
  includeSubdomains: true,
  respectRobots: true,
  followSitemaps: true,
  maxPages: 160,
  maxDepth: 4,
  rateLimitMs: 350,
  allowPatterns: [],
  denyPatterns: [],
  includeBookingProviders: true,
  extraAllowedHosts: [],
};

const BOOKING_HOSTS = new Set<string>([
  "square.site", "squareup.com",
  "vagaro.com",
  "fresha.com", "myfresha.com",
  "boulevard.io", "blvd.co",
  "mindbodyonline.com", "mindbody.io",
  "glossgenius.com",
  "acuityscheduling.com", "squarespace.com",
  "calendly.com",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEXT_MIN = 200;
const CHUNK_MAX = 1400;

function canonical(u: string) {
  try {
    const url = new URL(u);
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    return url.toString();
  } catch {
    return "";
  }
}
function eTLDPlusOne(host: string) {
  const parts = host.split(".").filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}
function sameSiteOrSub(root: string, host: string, includeSubs: boolean) {
  return host === root || (includeSubs && host.endsWith("." + root));
}
function matchesAny(url: string, regexes: string[]) {
  return regexes.some((r) => new RegExp(r, "i").test(url));
}
function shouldFollowUrl(u: string, root: string, opts: Required<Options>) {
  const host = new URL(u).hostname;
  if (opts.denyPatterns.length && matchesAny(u, opts.denyPatterns)) return false;

  // Enforce allowPatterns if any
  const allowOK = !opts.allowPatterns.length || matchesAny(u, opts.allowPatterns);

  // Same domain
  if (sameSiteOrSub(root, host, opts.includeSubdomains)) return allowOK;

  // Booking providers
  if (opts.includeBookingProviders) {
    const base = host.split(".").slice(-2).join(".");
    if (BOOKING_HOSTS.has(base) || opts.extraAllowedHosts.includes(base)) {
      // Only follow booking hosts if path hints at services/booking/menu
      const bookingish = /(book|appointment|service|menu|pricing|packages|schedule)/i.test(u);
      return allowOK && bookingish;
    }
  }
  return false;
}

async function fetchText(u: string) {
  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${u}`);
  const ct = res.headers.get("content-type") || "";
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(ct);
  return { text: isHtml ? await res.text() : "", contentType: ct, ok: isHtml };
}
async function fetchRobots(base: URL) {
  try {
    const txt = await fetch(new URL("/robots.txt", base)).then((r) => (r.ok ? r.text() : ""));
    return txt;
  } catch {
    return "";
  }
}
function robotsDisallow(robotsTxt: string, path: string) {
  if (!robotsTxt) return false;
  const lines = robotsTxt.split(/\r?\n/);
  let active = false;
  const disallowed: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^user-agent:\s*\*/i.test(l)) {
      active = true;
      continue;
    }
    if (/^user-agent:/i.test(l)) {
      active = false;
      continue;
    }
    if (active) {
      const m = l.match(/^disallow:\s*(.*)$/i);
      if (m) disallowed.push(m[1].trim() || "/");
    }
  }
  return disallowed.some((p) => p !== "/" && path.startsWith(p));
}
async function parseSitemaps(baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl);
  const urls: string[] = [];
  try {
    const robots = await fetchRobots(base);
    const sm = [...robots.matchAll(/Sitemap:\s*(.+)\s*/gi)].map((m) => m[1].trim());
    for (const s of sm) {
      try {
        const xml = await fetch(s).then((r) => (r.ok ? r.text() : ""));
        for (const loc of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) urls.push(loc[1].trim());
      } catch {}
    }
  } catch {}
  for (const p of ["/sitemap.xml", "/sitemap_index.xml"]) {
    try {
      const xml = await fetch(new URL(p, base)).then((r) => (r.ok ? r.text() : ""));
      for (const loc of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) urls.push(loc[1].trim());
    } catch {}
  }
  return Array.from(new Set(urls));
}

// Structured data extraction
function readJsonLd(doc: any) {
  const out: any[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s: any) => {
    try {
      const val = JSON.parse(s.textContent || "null");
      if (!val) return;
      Array.isArray(val) ? out.push(...val) : out.push(val);
    } catch {}
  });
  return out;
}
function pickFirst<T>(list: (T | null | undefined)[]) {
  for (const x of list) if (x) return x as T;
  return null;
}
function normalizeHoursFromJsonLd(entries: any[]) {
  const hours: Array<{ day: string; opens: string; closes: string }> = [];
  const specs = entries.flatMap((e) =>
    e?.openingHoursSpecification
      ? Array.isArray(e.openingHoursSpecification)
        ? e.openingHoursSpecification
        : [e.openingHoursSpecification]
      : [],
  );
  for (const s of specs) {
    const days = s.dayOfWeek
      ? Array.isArray(s.dayOfWeek)
        ? s.dayOfWeek
        : [s.dayOfWeek]
      : [];
    for (const d of days) {
      const dd = d.split("/").pop() || d;
      if (s.opens && s.closes) hours.push({ day: dd, opens: s.opens, closes: s.closes });
    }
  }
  const ohText = entries.flatMap((e) =>
    e.openingHours ? (Array.isArray(e.openingHours) ? e.openingHours : [e.openingHours]) : [],
  );
  for (const line of ohText) {
    const m = String(line).match(
      /(Mo|Tu|We|Th|Fr|Sa|Su)[^\d]*?(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/i,
    );
    if (m) hours.push({ day: m[1], opens: m[2], closes: m[3] });
  }
  return hours;
}
function extractFromSchema(doc: any) {
  const jsonld = readJsonLd(doc);
  const tel = pickFirst(jsonld.map((j) => j?.telephone)) || undefined;
  const email = pickFirst(jsonld.map((j) => j?.email)) || undefined;
  const addr = pickFirst(jsonld.map((j) => {
    const a = j?.address;
    if (!a) return null;
    if (typeof a === "string") return a;
    const parts = [
      a.streetAddress,
      a.addressLocality,
      a.addressRegion,
      a.postalCode,
    ].filter(Boolean);
    return parts.join(", ");
  })) || undefined;

  const services: Array<{ name: string; price?: string }> = [];
  const addOffer = (o: any) => {
    if (!o) return;
    const name = o.itemOffered?.name || o.name || o.description;
    const price = o.price || o.priceSpecification?.price || o.offers?.price;
    if (name) services.push({ name: String(name).slice(0, 160), price: price ? `$${price}` : undefined });
  };
  jsonld.forEach((j) => {
    const cat = j?.hasOfferCatalog;
    if (cat) {
      const items = cat.itemListElement || cat.itemList || [];
      (Array.isArray(items) ? items : [items]).forEach((it: any) => addOffer(it));
    }
    const offers = j?.offers || j?.makesOffer;
    if (offers) (Array.isArray(offers) ? offers : [offers]).forEach((o: any) => addOffer(o));
  });

  const business_hours = normalizeHoursFromJsonLd(jsonld);
  return { phone: tel, email, address: addr, services, business_hours };
}

// Heuristics extraction
const DAY_MAP: Record<string, string> = {
  mon: "Mon",
  monday: "Mon",
  tue: "Tue",
  tuesday: "Tue",
  wed: "Wed",
  wednesday: "Wed",
  thu: "Thu",
  thursday: "Thu",
  fri: "Fri",
  friday: "Fri",
  sat: "Sat",
  saturday: "Sat",
  sun: "Sun",
  sunday: "Sun",
};
function normalizeDayToken(tok: string) {
  const key = tok.toLowerCase().slice(0, 9);
  return DAY_MAP[key] || tok;
}
function cleanBodyText(doc: any) {
  doc
    .querySelectorAll(
      "script,style,noscript,svg,iframe,canvas,form,nav,footer,header,aside",
    )
    .forEach((n: any) => n.remove());
  const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  return text;
}
function splitChunks(text: string) {
  if (!text || text.length < TEXT_MIN) return [];
  const out: string[] = [];
  let buf = "";
  for (const seg of text.split(/(?<=[\.\!\?])\s+/)) {
    if ((buf + " " + seg).length > CHUNK_MAX) {
      if (buf.trim().length) out.push(buf.trim());
      buf = seg;
    } else {
      buf = buf ? buf + " " + seg : seg;
    }
  }
  if (buf.trim().length) out.push(buf.trim());
  return out.filter((p) => p.length >= TEXT_MIN);
}
function heuristicExtract(doc: any, pageText: string) {
  const phone =
    pageText.match(/(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0] ||
    undefined;
  const email =
    pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || undefined;
  const address = pageText.match(
    /\d{2,5}\s+[A-Za-z][A-Za-z\s\.\-]+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b.*?\b[A-Z]{2}\b\s+\d{5}/i,
  )?.[0];

  const hours: Array<{ day: string; opens: string; closes: string }> = [];
  const lines = pageText.split(/[\r\n]+/).concat(
    Array.from(doc.querySelectorAll("li,p,div,span")).map((el: any) =>
      (el.textContent || "").replace(/\s+/g, " ").trim()
    ),
  );
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    // Range "Mon–Fri 9–5"
    const mRange = t.match(
      /(Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun)[^\w]+(Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun).*?(\d{1,2}(:\d{2})?\s?(AM|PM)?)[\s\-–]+(\d{1,2}(:\d{2})?\s?(AM|PM)?)/i,
    );
    if (mRange) {
      const d1 = normalizeDayToken(mRange[1]);
      const d2 = normalizeDayToken(mRange[2]);
      const opens = mRange[3];
      const closes = mRange[6];
      const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const i1 = order.indexOf(d1);
      const i2 = order.indexOf(d2);
      if (i1 >= 0 && i2 >= i1) {
        for (let i = i1; i <= i2; i++) hours.push({ day: order[i], opens, closes });
      }
      continue;
    }
    // Single day "Mon 9–5"
    const mSingle = t.match(
      /(Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun)\s*[:\-]?\s*(\d{1,2}(:\d{2})?\s?(AM|PM)?)\s*[-–]\s*(\d{1,2}(:\d{2})?\s?(AM|PM)?)/i,
    );
    if (mSingle) {
      hours.push({
        day: normalizeDayToken(mSingle[1]),
        opens: mSingle[2],
        closes: mSingle[5],
      });
    }
  }

  const services: Array<{ name: string; price?: string }> = [];
  const nodes = Array.from(
    doc.querySelectorAll("table tr, ul li, ol li, .service, .pricing, p, div"),
  );
  for (const el of nodes) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 6) continue;
    const price = t.match(/[$£€]\s?\d{1,4}(\.\d{2})?/);
    const hasSvc = /(hair|cut|color|colour|balayage|foil|highlight|style|perm|treatment|massage|facial|wax|thread|mani|pedi|consult|package|service|blowout|toner|gloss|brazilian)/i.test(
      t,
    );
    if (price && hasSvc) {
      const name = t.replace(/[$£€]\s?\d{1,4}(\.\d{2})?/g, "").trim();
      services.push({ name: name.slice(0, 160), price: price[0] });
    }
  }
  const uniq = new Map<string, { name: string; price?: string }>();
  for (const s of services) uniq.set((s.name + "|" + (s.price || "")).toLowerCase(), s);
  return {
    phone,
    email,
    address,
    business_hours: hours,
    services: Array.from(uniq.values()),
  };
}

serve(async (req) => {
  try {
    const payload = (await req.json()) as Payload;
    const opts = { ...DEFAULTS, ...(payload.options || {}) };
    const start = new URL(payload.url);
    const root = eTLDPlusOne(start.hostname);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const visited = new Set<string>();
    const queue: Array<{ u: string; depth: number }> = [
      { u: canonical(start.toString()), depth: 0 },
    ];
    const discovered: string[] = [];

    // preload sitemaps
    if (opts.followSitemaps) {
      const sm = await parseSitemaps(start.toString());
      for (const u of sm.slice(0, 300)) {
        const cu = canonical(u);
        if (cu && shouldFollowUrl(cu, root, opts)) {
          queue.push({ u: cu, depth: 0 });
        }
      }
    }

    const robotsTxt = opts.respectRobots ? await fetchRobots(start) : "";

    while (queue.length && discovered.length < opts.maxPages) {
      const { u, depth } = queue.shift()!;
      if (!u || visited.has(u)) continue;
      const uObj = new URL(u);

      // skip disallowed
      if (
        opts.respectRobots &&
        robotsDisallow(robotsTxt, uObj.pathname) &&
        sameSiteOrSub(root, uObj.hostname, opts.includeSubdomains)
      ) {
        continue;
      }
      if (!shouldFollowUrl(u, root, opts)) continue;

      visited.add(u);
      await sleep(opts.rateLimitMs);

      let html = "";
      let ok = false;
      try {
        const res = await fetchText(u);
        html = res.text;
        ok = res.ok;
      } catch {
        continue;
      }
      if (!ok || !html) continue;

      discovered.push(u);

      const dom = new DOMParser().parseFromString(html, "text/html");
      const title =
        dom.querySelector("title")?.textContent?.trim() || uObj.hostname;

      const schemaBits = extractFromSchema(dom);
      const pageText = cleanBodyText(dom);
      const chunks = splitChunks(pageText);
      const heur = heuristicExtract(dom, pageText);

      const phone = schemaBits.phone || heur.phone;
      const email = schemaBits.email || heur.email;
      const address = schemaBits.address || heur.address;
      const services =
        schemaBits.services?.length > 0 ? schemaBits.services : heur.services;
      const business_hours =
        schemaBits.business_hours?.length > 0
          ? schemaBits.business_hours
          : heur.business_hours;

      const { data: srcRow, error: sErr } = await sb
        .from("knowledge_sources")
        .insert({
          tenant_id: payload.tenantId,
          source_url: u,
          title,
          meta: {
            crawl_method: "crawler",
            description:
              dom
                .querySelector('meta[name="description"]')
                ?.getAttribute("content") || "",
            business_info: {
              source_url: u,
              phone,
              email,
              address,
              services,
              business_hours,
            },
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

      if (phone) {
        await sb.from("business_quick_answers").upsert(
          {
            tenant_id: payload.tenantId,
            question_type: "phone",
            answer: phone,
          },
          { onConflict: "tenant_id,question_type" },
        );
      }
      if (email) {
        await sb.from("business_quick_answers").upsert(
          {
            tenant_id: payload.tenantId,
            question_type: "email",
            answer: email,
          },
          { onConflict: "tenant_id,question_type" },
        );
      }
      if (business_hours?.length) {
        const hoursText = business_hours
          .map((h: any) =>
            h.day && h.opens && h.closes
              ? `${h.day}: ${h.opens}-${h.closes}`
              : String(h.day || ""),
          )
          .filter(Boolean)
          .join(" | ");
        if (hoursText) {
          await sb.from("business_quick_answers").upsert(
            {
              tenant_id: payload.tenantId,
              question_type: "hours",
              answer: hoursText,
            },
            { onConflict: "tenant_id,question_type" },
          );
        }
      }

      // follow next links
      if (depth < opts.maxDepth) {
        const candidates: string[] = [];
        dom.querySelectorAll("a[href]").forEach((a: any) => {
          const h = a.getAttribute("href") || "";
          if (!h || h.startsWith("mailto:") || h.startsWith("tel:")) return;
          candidates.push(h);
        });
        dom.querySelectorAll("iframe[src]").forEach((f: any) => {
          const s = f.getAttribute("src") || "";
          if (s) candidates.push(s);
        });
        for (const href of candidates) {
          try {
            const next = canonical(new URL(href, u).toString());
            if (!next || visited.has(next)) continue;
            if (!shouldFollowUrl(next, root, opts)) continue;
            queue.push({ u: next, depth: depth + 1 });
          } catch {}
        }
      }
    }

    // Choose best business_info from recent pages (prefers more services/hours)
    const { data: rec } = await sb
      .from("knowledge_sources")
      .select("meta")
      .eq("tenant_id", payload.tenantId)
      .order("created_at", { ascending: false })
      .limit(40);

    let best: any = null;
    for (const row of rec || []) {
      const bi = (row.meta as any)?.business_info;
      if (!bi) continue;
      const score =
        (bi.services?.length ? 1 : 0) +
        (bi.business_hours?.length ? 1 : 0) +
        (bi.phone ? 0.25 : 0) +
        (bi.email ? 0.25 : 0);
      if (!best || score > best._score) {
        best = { ...bi, _score: score };
      }
    }
    if (best) delete best._score;

    return new Response(
      JSON.stringify({
        ok: true,
        pagesIndexed: discovered.length,
        business_info: best || null,
      }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 400 },
    );
  }
});
