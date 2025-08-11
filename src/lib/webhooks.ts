// src/lib/webhooks.ts
export const CONFIG = {
  COMPANY: "TODO_company",
  DOMAIN: "TODO_domain",
  WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/xxxxxxx/xxxxxxx/",
  WEBHOOK_SECRET: "", // optional: HMAC signing
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
