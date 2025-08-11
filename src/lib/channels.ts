// src/lib/channels.ts
import { postWebhook } from "@/lib/webhooks";

export async function ingestChannelMessage(channel: string, msg: any, setThreads: (fn: any) => void) {
  const formatted = {
    from: msg.from || "unknown",
    at: msg.at || new Date().toISOString(),
    text: msg.text || "",
    channel,
  };

  setThreads((cur: any[]) => {
    const id = `${channel}-${msg.from}`;
    const next = cur.find((t) => t.id === id)
      ? cur.map((t) =>
          t.id === id ? { ...t, thread: [...t.thread, formatted] } : t
        )
      : [...cur, { id, with: msg.from, channel, thread: [formatted] }];
    return next;
  });

  try {
    await postWebhook({ type: "channel.message", channel, message: formatted });
  } catch {}
}
