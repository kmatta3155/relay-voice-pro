// src/lib/webhooks.ts
export const CONFIG = {
  COMPANY: "TODO_company",
  DOMAIN: "TODO_domain",
  PHONE: "+1-555-555-5555",
  ADDRESS: { street: "TODO street", city: "Morrisville", region: "NC", postal: "27560", country: "US" },
  GA_MEASUREMENT_ID: "G-XXXXXXX",
  WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/xxxxxxx/xxxxxxx/",
  WEBHOOK_SECRET: "",
  // 🔧 NEW: Cal.com integration (set ONE of these)
  CAL_HANDLE: "",            // e.g., "relayai"  (will use https://cal.com/relayai)
  CAL_EVENT_PATH: "",        // optional: e.g., "relayai/demo"  (uses https://cal.com/relayai/demo)
  CAL_URL: ""                // optional: full override URL if you want to paste it directly
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
