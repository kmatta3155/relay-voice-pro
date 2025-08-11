// src/lib/billing.ts
import { loadStripe } from "@stripe/stripe-js";
import { postWebhook } from "@/lib/webhooks";

export async function startCheckout(planId: string) {
  const stripe = await loadStripe("pk_test_yourkeyhere");
  const session = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId }),
  }).then((res) => res.json());

  if (session.url) {
    window.location.href = session.url;
  }
}

export async function handleSubscriptionUpdate(update: any) {
  try {
    await postWebhook({ type: "subscription.update", update });
  } catch {}
}
