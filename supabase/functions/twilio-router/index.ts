import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.54.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

function xmlEscape(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }
  try {
    // Parse Twilio params
    let callSid = "";
    let from = "";
    let to = "";
    if (req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      callSid = (form.get("CallSid") as string) || "";
      from = (form.get("From") as string) || "";
      to = (form.get("To") as string) || "";
    } else {
      const url = new URL(req.url);
      callSid = url.searchParams.get("CallSid") || "";
      from = url.searchParams.get("From") || "";
      to = url.searchParams.get("To") || "";
    }

    // Look up tenantId via numbers table
    const { data: numberRow } = await supabase
      .from("numbers")
      .select("tenant_id")
      .eq("phone_number", to)
      .maybeSingle();
    const tenantId = numberRow?.tenant_id;
    if (!tenantId) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not configured. Goodbye.</Say><Hangup/></Response>`, { headers: { "Content-Type": "text/xml" } });
    }

    // Check agent status
    const { data: agentRow } = await supabase
      .from("ai_agents")
      .select("mode, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const agentIsLive = agentRow && agentRow.mode === "live" && agentRow.status === "ready";

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

    let twiml = "";
    if (agentIsLive) {
      const streamUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Hello! You’re connected to ${xmlEscape(businessName)}. How can I help you today?</Say>\n  <Connect>\n    <Stream url="${xmlEscape(streamUrl)}">\n      <Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>\n      <Parameter name="businessName" value="${xmlEscape(businessName)}"/>\n      <Parameter name="phoneNumber" value="${xmlEscape(from || "")}"/>\n    </Stream>\n  </Connect>\n</Response>`;
    } else {
      const intentUrl = `https://${projectRef}.supabase.co/functions/v1/handle-intent?tenant_id=${xmlEscape(tenantId)}&business_name=${encodeURIComponent(businessName)}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Hello! I’m the AI receptionist for ${xmlEscape(businessName)}. How can I help you today?</Say>\n  <Gather input="speech" language="en-US" speechTimeout="auto" action="${xmlEscape(intentUrl)}" method="POST">\n    <Say>I’m listening…</Say>\n  </Gather>\n</Response>`;
    }
    return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
  } catch (err) {
    console.error(err);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we’re experiencing technical difficulties. Please try again later.</Say><Hangup/></Response>`, { headers: { "Content-Type": "text/xml" } });
  }
});