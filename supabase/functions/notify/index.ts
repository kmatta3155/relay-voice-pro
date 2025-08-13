// Outbound notifications (SMS/Email) via Edge Function
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TWILIO_SID = Deno.env.get("TWILIO_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_FROM");
const RESEND_KEY = Deno.env.get("RESEND_KEY");

async function sendSMS(to: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) throw new Error("Twilio not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body })
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) throw new Error("Resend not configured");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "RelayAI <noreply@yourdomain>", to: [to], subject, html }) });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const { kind, to, body, subject, html } = await req.json();
  try {
    if (kind === "sms") await sendSMS(to, body);
    else if (kind === "email") await sendEmail(to, subject, html || body);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) { return new Response(e.message, { status: 400 }); }
});