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
