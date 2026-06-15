// Registry of booking platforms common in the salon/spa industry, with an
// HONEST capability assessment. "liveSync" = can the AI read real availability
// and write bookings back via the platform's API.
//   - "available": open, documented API a salon can self-enable
//   - "gated":     API exists but needs partner/enterprise approval per account
//   - "none":      no public booking API — use handoff (AI sends the booking link)
// Every provider supports HANDOFF today (AI gathers details, directs the caller
// to the salon's booking link), so no salon is ever blocked.

export type LiveSync = "available" | "gated" | "none";

export interface BookingProvider {
  id: string;
  name: string;
  audience: string;        // who typically uses it
  liveSync: LiveSync;
  connector?: "vagaro";    // which built-in API connector handles it (if any)
  note: string;            // shown in the UI
  bookingUrlHint?: string; // example handoff link format
}

export const BOOKING_PROVIDERS: BookingProvider[] = [
  {
    id: "vagaro", name: "Vagaro", audience: "Multi-location salons & spas",
    liveSync: "gated", connector: "vagaro",
    note: "Enterprise Business API. Requires a paid plan with card processing and an API-access request (~7 business days). Live sync supported once connected.",
    bookingUrlHint: "https://www.vagaro.com/yoursalon",
  },
  {
    id: "square", name: "Square Appointments", audience: "Solo & small salons",
    liveSync: "available",
    note: "Open Bookings API (OAuth) with availability search, booking, and webhooks. Best-supported live integration — connect the salon's Square account.",
    bookingUrlHint: "https://squareup.com/appointments/book/your-id",
  },
  {
    id: "acuity", name: "Acuity Scheduling", audience: "Independent stylists",
    liveSync: "available",
    note: "Squarespace Scheduling API (API key). Reads availability and creates appointments. Connect with the salon's Acuity API credentials.",
    bookingUrlHint: "https://yoursalon.as.me",
  },
  {
    id: "fresha", name: "Fresha", audience: "Solo & small salons (very common)",
    liveSync: "none",
    note: "World's most-used salon platform, but it has no public booking API. Use handoff — the AI sends the caller your Fresha link.",
    bookingUrlHint: "https://www.fresha.com/a/yoursalon",
  },
  {
    id: "glossgenius", name: "GlossGenius", audience: "Solo stylists",
    liveSync: "none",
    note: "No public booking API. Use handoff with your GlossGenius booking link.",
    bookingUrlHint: "https://book.glossgenius.com/yoursalon",
  },
  {
    id: "booksy", name: "Booksy", audience: "Solo stylists & suites",
    liveSync: "none",
    note: "No public booking API. Use handoff with your Booksy link.",
    bookingUrlHint: "https://booksy.com/en-us/your-salon",
  },
  {
    id: "mindbody", name: "Mindbody", audience: "Larger salons & wellness",
    liveSync: "gated",
    note: "Public API exists but requires Mindbody partner approval and per-site activation. Handoff works today; live sync can be added once approved.",
    bookingUrlHint: "https://www.mindbodyonline.com/explore/locations/your-salon",
  },
  {
    id: "boulevard", name: "Boulevard", audience: "Premium salons & spas",
    liveSync: "gated",
    note: "API is partner/enterprise-gated. Handoff today; live sync on partner approval.",
    bookingUrlHint: "https://dashboard.boulevard.io/...",
  },
  {
    id: "zenoti", name: "Zenoti", audience: "Enterprise spas & chains",
    liveSync: "gated",
    note: "Enterprise API, partner-gated. Handoff today; live sync via Zenoti enterprise integration.",
    bookingUrlHint: "https://yoursalon.zenoti.com",
  },
  {
    id: "mangomint", name: "Mangomint", audience: "Premium boutiques",
    liveSync: "gated",
    note: "Newer API, currently limited/partner-based. Handoff today.",
    bookingUrlHint: "https://booking.mangomint.com/yoursalon",
  },
  {
    id: "styleseat", name: "StyleSeat", audience: "Solo stylists",
    liveSync: "none",
    note: "No public booking API. Use handoff with your StyleSeat link.",
    bookingUrlHint: "https://www.styleseat.com/m/yoursalon",
  },
  {
    id: "other", name: "Other / custom", audience: "Any platform",
    liveSync: "none",
    note: "Use handoff — paste whatever booking link your platform gives you and the AI will direct callers there.",
  },
];

export function getProvider(id?: string | null): BookingProvider | undefined {
  if (!id) return undefined;
  return BOOKING_PROVIDERS.find(p => p.id === id.toLowerCase()) ||
    BOOKING_PROVIDERS.find(p => p.name.toLowerCase() === id.toLowerCase());
}

export function liveSyncLabel(l: LiveSync): { text: string; cls: string } {
  switch (l) {
    case "available": return { text: "Live API sync", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    case "gated": return { text: "API (approval needed)", cls: "bg-amber-100 text-amber-700 border-amber-200" };
    default: return { text: "Handoff only", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  }
}
