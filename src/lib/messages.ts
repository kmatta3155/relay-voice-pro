// src/lib/messages.ts
import { postWebhook } from "@/lib/webhooks";

export async function sendAgentMessage(th: any, text: string, setThreads: (updater: any) => void) {
  if (!text?.trim() || !th) return;
  const msg = { from: "agent", at: new Date().toISOString(), text };

  setThreads((cur: any[]) => cur.map(t => (t.id === th.id ? { ...t, thread: [...t.thread, msg] } : t)));

  try {
    await postWebhook({ type: "message.sent", to: th.with, message: msg });
  } catch {
    // swallow errors to avoid UX disruption
  }
}
