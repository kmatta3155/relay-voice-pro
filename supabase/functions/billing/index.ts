// Secure Stripe billing endpoints + webhook (Edge Function)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "https://esm.sh/stripe@16.6.0?target=deno";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "http://localhost:5173";

const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2024-06-20" });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getTenant(tenantId: string){
  const { data, error } = await admin.from("tenants").select("id, stripe_customer_id").eq("id", tenantId).single();
  if(error) throw error;
  return data;
}

async function ensureCustomer(tenantId: string){
  const t = await getTenant(tenantId);
  if (t.stripe_customer_id) return t.stripe_customer_id as string;
  const customer = await stripe.customers.create({ metadata: { tenant_id: tenantId } });
  await admin.from("tenants").update({ stripe_customer_id: customer.id }).eq("id", tenantId);
  return customer.id;
}

async function createCheckout(tenantId: string, priceId: string){
  const customer = await ensureCustomer(tenantId);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_BASE_URL}/#billing?success=1`,
    cancel_url: `${APP_BASE_URL}/#billing?canceled=1`,
    allow_promotion_codes: true
  });
  return { url: session.url };
}

async function createPortal(tenantId: string){
  const customer = await ensureCustomer(tenantId);
  const portal = await stripe.billingPortal.sessions.create({
    customer,
    return_url: `${APP_BASE_URL}/#billing`
  });
  return { url: portal.url };
}

async function handleWebhook(req: Request){
  const sig = req.headers.get("stripe-signature")!;
  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook error: ${(err as any).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const customer = s.customer as string | null;
    const priceId = (s as any).line_items?.data?.[0]?.price?.id || (s.metadata as any)?.price_id;
    if (customer) {
      await admin.from("tenants").update({
        stripe_customer_id: customer,
        subscription_status: "active",
        price_id: priceId || null
      }).eq("stripe_customer_id", customer);
    }
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const customer = sub.customer as string;
    await admin.from("tenants").update({
      subscription_status: sub.status,
      price_id: (sub.items.data[0]?.price?.id) || null,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString()
    }).eq("stripe_customer_id", customer);
  }
  return new Response("ok");
}

serve(async (req) => {
  const url = new URL(req.url);
  const method = req.method;

  if (url.pathname.endsWith("/webhook") && method === "POST") {
    return await handleWebhook(req);
  }

  const { action, tenantId, priceId } = await req.json().catch(()=> ({}));

  if (action === "checkout" && method === "POST") {
    if (!tenantId || !priceId) return new Response("Missing args", { status: 400 });
    const out = await createCheckout(tenantId, priceId);
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" }});
  }

  if (action === "portal" && method === "POST") {
    if (!tenantId) return new Response("Missing tenant", { status: 400 });
    const out = await createPortal(tenantId);
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" }});
  }

  return new Response("billing ok");
});
