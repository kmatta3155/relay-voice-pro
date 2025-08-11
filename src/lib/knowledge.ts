// src/lib/knowledge.ts
import { postWebhook } from "@/lib/webhooks";

export function applySuggestionToProfile(s: any, setProfile: (updater: any) => void) {
  if (s?.type === "faq") {
    const item = {
      q: s.preview?.split(" A:")[0]?.replace("Q: ", "").trim() || "",
      a: (s.preview?.split(" A:")[1] || "").trim(),
    };
    setProfile((p: any) => ({ ...p, faqs: [...(p?.faqs || []), item] }));
    postWebhook({ type: "knowledge.apply", item: { kind: "faq", ...item } }).catch(() => {});
  }
}
