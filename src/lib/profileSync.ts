export async function suggestProfileUpdates(transcripts: any[]) {
  const faqs: any[] = [];
  transcripts.forEach((t) => {
    if (t.intent === "faq" && !faqs.find((f) => f.q === t.q)) {
      faqs.push({ q: t.q, a: t.a });
    }
  });
  return { faqs };
}

export function applyProfileUpdate(update: any, setProfile: (fn: any) => void) {
  setProfile((cur: any) => ({ ...cur, ...update }));
}
