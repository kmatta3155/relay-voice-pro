import { CONFIG, postWebhook } from "@/lib/webhooks";

export async function followUpLeadExternal(
  ld,
  setThreads,
  postWebhook,
  domain
) {
  const first = (ld.name || "").split(" ")[0] || "";
  const message = `Hi ${first}! You can book here: https://www.${domain}/book`;

  try {
    await postWebhook({ type: "instant_followup", lead: ld, message });
  } catch {}

  setThreads((cur) => {
    const existing = cur.find((t) => t.with === ld.phone);
    const msg = { from: "agent", at: new Date().toISOString(), text: message };
    if (existing) {
      return cur.map((t) =>
        t.id === existing.id ? { ...t, thread: [...t.thread, msg] } : t
      );
    }
    return [...cur, { id: `M-${Date.now()}`, with: ld.phone, thread: [msg] }];
  });
}

// New utility: safe to import from pages/components
export async function followUpLead(ld: any, setThreads: (updater: any) => void) {
  const payload = {
    type: "instant_followup",
    lead: ld,
    message: `Hi ${ld?.name?.split(" ")[0] || ""}! You can book here: https://www.${CONFIG.DOMAIN}/book`,
  };

  try {
    await postWebhook(payload);
  } catch {
    // no-op on webhook failure
  }

  // also mirror into the Messages inbox
  setThreads((cur: any[]) => {
    const id = cur.find((t: any) => t.with === ld.phone)?.id || `M-${Date.now()}`;
    const next = cur.find((t: any) => t.id === id)
      ? cur.map((t: any) =>
          t.id === id
            ? { ...t, thread: [...t.thread, { from: "agent", at: new Date().toISOString(), text: payload.message }] }
            : t
        )
      : [
          ...cur,
          { id, with: ld.phone, thread: [{ from: "agent", at: new Date().toISOString(), text: payload.message }] },
        ];
    return next;
  });
}
