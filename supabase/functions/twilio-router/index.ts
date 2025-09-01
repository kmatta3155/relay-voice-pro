import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.54.0";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

// Escape special XML characters
function xmlEscape(val: string | null | undefined): string {
  return val ? val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;") : "";
}

// Normalize a phone number to E.164 (US default)
function normalizeE164(num: string): string {
  if (!num) return num;
  if (num.startsWith("+")) return num;
  const digits = num.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    // Parse Twilio parameters
    let callSid = "", from = "", to = "";
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      callSid = (form.get("CallSid") as string) || "";
      from    = (form.get("From") as string) || "";
      to      = (form.get("To")   as string) || "";
    } else {
      const url = new URL(req.url);
      callSid = url.searchParams.get("CallSid") || "";
      from    = url.searchParams.get("From")    || "";
      to      = url.searchParams.get("To")      || "";
    }

    // Normalize the number for lookup
    const toE164 = normalizeE164(to);

    // Look up the tenant: first in agent_settings, then in numbers
    let tenantId: string | null = null;
    {
      const { data } = await supabase
        .from("agent_settings")
        .select("tenant_id")
        .eq("twilio_number", toE164)
        .maybeSingle();
      tenantId = data?.tenant_id || null;
    }
    if (!tenantId) {
      const { data } = await supabase
        .from("numbers")
        .select("tenant_id")
        .eq("phone_number", toE164)
        .maybeSingle();
      tenantId = data?.tenant_id || null;
    }

    // If still not found, return unconfigured
    if (!tenantId) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This number is not configured. Goodbye.</Say>
  <Hangup/>
</Response>`;
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }

    // Check agent readiness
    const { data: agentRow } = await supabase
      .from("ai_agents")
      .select("mode, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const agentIsLive =
      agentRow && agentRow.mode === "live" && agentRow.status === "ready";

    // Fetch business name
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();
    const businessName = tenantRow?.name || "this business";

    // Log the call
    await supabase.from("calls").insert({
      tenant_id: tenantId,
      from,
      to,
      at: new Date().toISOString(),
      outcome: "incoming",
    });

    // Build TwiML
    let twiml = "";
    if (agentIsLive) {
      // Live agent: two-way media stream using <Start><Stream track="both_tracks">
      const streamUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${xmlEscape(streamUrl)}" track="both_tracks">
      <Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>
      <Parameter name="businessName" value="${xmlEscape(businessName)}"/>
      <Parameter name="phoneNumber" value="${xmlEscape(from)}"/>
    </Stream>
  </Start>
  <Pause length="600"/>
</Response>`;
    } else {
      // Fallback: Gather speech and post to handle-intent
      const intentUrl = `https://${projectRef}.supabase.co/functions/v1/handle-intent?tenant_id=${xmlEscape(tenantId)}&business_name=${encodeURIComponent(businessName)}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! I'm the AI receptionist for ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Gather input="speech" language="en-US" speechTimeout="auto"
          action="${xmlEscape(intentUrl)}" method="POST">
    <Say>I'm listening…</Say>
  </Gather>
</Response>`;
    }
    return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
  } catch (err) {
    console.error(err);
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`;
    return new Response(fallback, { headers: { "Content-Type": "text/xml" } });
  }
});
