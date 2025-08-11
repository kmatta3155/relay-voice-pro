import Stripe from "https://esm.sh/stripe@14.21.0";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Missing STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const { planId } = await req.json();
    const origin = req.headers.get("origin") || "https://gnqqktmslswgjtvxfvdo.supabase.co";

    // If a real Stripe price id is provided (starts with price_), use it. Otherwise fallback to test price_data
    const lineItem = planId && planId.startsWith("price_")
      ? { price: planId, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            product_data: { name: planId || "Receptionist + CRM" },
            unit_amount: 799, // $7.99 test amount
            recurring: { interval: "month" },
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [lineItem],
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=canceled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
