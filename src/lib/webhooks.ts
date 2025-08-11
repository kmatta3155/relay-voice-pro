// Webhook config and helpers for RelayAI landing
// Replace TODO_* values before production

export const CONFIG = {
  COMPANY: "TODO_company",
  DOMAIN: "TODO_domain",
  PHONE: "+1-555-555-5555",
  ADDRESS: {
    street: "TODO street",
    city: "Morrisville",
    region: "NC",
    postal: "27560",
    country: "US",
  },
  GA_MEASUREMENT_ID: "G-XXXXXXX", // leave blank to disable GA
  WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/xxxxxxx/xxxxxxx/",
  WEBHOOK_SECRET: "", // optional: if set, requests will be HMAC-signed
} as const;

// SIGNED WEBHOOK HELPER
export async function postWebhook(body: any) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    if (CONFIG.WEBHOOK_SECRET) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(CONFIG.WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(JSON.stringify(body))
      );
      const hex = [...new Uint8Array(signature)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      headers["X-RelayAI-Signature"] = hex;
    }
  } catch (e) {
    // If crypto.subtle is unavailable, proceed without signature
  }

  return fetch(CONFIG.WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// EXTRA HOOKS YOU CAN CALL IN YOUR COMPONENTS
export async function emitLeadCreated(lead: any) {
  try {
    await postWebhook({ type: "lead.created", lead });
  } catch {}
}

export async function emitKnowledgeApplied(item: any) {
  try {
    await postWebhook({ type: "knowledge.apply", item });
  } catch {}
}

export async function emitAppointmentCreated(appointment: any) {
  try {
    await postWebhook({ type: "appointment.created", appointment });
  } catch {}
}

export async function emitMessageSent(to: string, message: any) {
  try {
    await postWebhook({ type: "message.sent", to, message });
  } catch {}
}

export async function emitInstantFollowUp(lead: any, message: string) {
  try {
    await postWebhook({ type: "instant_followup", lead, message });
  } catch {}
}
