// src/lib/webhooks.ts
export const CONFIG = {
  COMPANY: "Voice Relay Pro",
  DOMAIN: "voicerelaypro.taskara.ai",                   // <-- set your domain (used for mailto/status links)
  PHONE: "+1-555-555-5555",
  ADDRESS: { street: "100 Main St", city: "Morrisville", region: "NC", postal: "27560", country: "US" },
  GA_MEASUREMENT_ID: "",                       // leave blank to disable GA
  WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/xxxxxxx/xxxxxxx/", // optional
  WEBHOOK_SECRET: "",                          // optional HMAC for webhook

  // Cal.com — recommended: direct to your Demo event
  CAL_HANDLE: "",
  CAL_EVENT_PATH: "relayai/30min",              // <-- set this to your event, e.g. "yourhandle/demo"
  CAL_URL: "",

  // Edge Functions (Stripe etc.) — optional serverless backend integration
  EDGE_CREATE_CHECKOUT_URL: "https://YOUR_SUPABASE_PROJECT.functions.supabase.co/create-checkout", // optional
  EDGE_PORTAL_URL: "https://YOUR_SUPABASE_PROJECT.functions.supabase.co/customer-portal"           // optional
};


export async function postWebhook(body: any) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CONFIG.WEBHOOK_SECRET && typeof window !== "undefined" && window.crypto?.subtle) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(CONFIG.WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(JSON.stringify(body)));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
    headers["X-RelayAI-Signature"] = hex;
  }
  return fetch(CONFIG.WEBHOOK_URL, { method: "POST", headers, body: JSON.stringify(body) });
}
