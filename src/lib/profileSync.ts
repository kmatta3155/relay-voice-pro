// src/lib/profileSync.ts
import { postWebhook } from "@/lib/webhooks";

export async function suggestProfileUpdates(transcripts: string[]) {
  const faqs: any[] = [];
  const hours: any[] = [];

  transcripts.forEach((t) => {
    if (/what.*hours/i.test(t)) {
      faqs.push({ q: "What are your hours?", a: "Our current hours are ..." });
    }
    if (/how much.*oil change/i.test(t)) {
      faqs.push({ q: "How much is an oil change?", a: "Oil change starts at ..." });
    }
  });

  return { faqs, hours };
}

export async function applyProfileUpdate(update: any, setProfile: (fn: any) => void) {
  setProfile((p: any) => ({ ...p, ...update }));
  try {
    await postWebhook({ type: "profile.update", update });
  } catch {}
}
