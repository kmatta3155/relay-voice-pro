import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.54.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

/**
 * Robust XML escape helper to encode special characters
 */
function xmlEscape(value: string): string {
  if (!value) return '';
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      headers: { 
        "Access-Control-Allow-Origin": "*", 
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" 
      } 
    });
  }

  try {
    // Parse Twilio call parameters
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

    console.log(`Incoming call: ${from} -> ${to}, CallSid: ${callSid}`);

    // Look up tenant via numbers table
    const { data: numberRow } = await supabase
      .from("numbers")
      .select("tenant_id")
      .eq("phone_number", to)
      .maybeSingle();

    const tenantId = numberRow?.tenant_id;
    if (!tenantId) {
      console.log(`No tenant found for number: ${to}`);
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>This number is not configured. Goodbye.</Say>\n  <Hangup/>\n</Response>`,
        { headers: { "Content-Type": "text/xml" } }
      );
    }

    console.log(`Found tenant: ${tenantId}`);

    // Check agent status
    const { data: agentRow } = await supabase
      .from("ai_agents")
      .select("mode, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const agentIsLive = agentRow && agentRow.mode === "live" && agentRow.status === "ready";
    console.log(`Agent status - mode: ${agentRow?.mode}, status: ${agentRow?.status}, isLive: ${agentIsLive}`);

    // Fetch business name
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();

    const businessName = tenantRow?.name || "this business";
    console.log(`Business name: ${businessName}`);

    // Log the call
    await supabase.from("calls").insert({
      tenant_id: tenantId,
      from,
      to,
      at: new Date().toISOString(),
      outcome: "incoming",
    });

    console.log("Call logged successfully");

    let twiml = "";

    if (agentIsLive) {
      // Streaming branch - agent is live and ready
      const streamUrl = `wss://${projectRef}.functions.supabase.co/twilio-voice-stream?tenant_id=${tenantId}&call_sid=${callSid}`;
      
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! You're connected to ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Connect>
    <Stream url="${xmlEscape(streamUrl)}">
      <Parameter name="tenantId" value="${xmlEscape(tenantId)}"/>
      <Parameter name="businessName" value="${xmlEscape(businessName)}"/>
      <Parameter name="phoneNumber" value="${xmlEscape(from)}"/>
    </Stream>
  </Connect>
</Response>`;

      console.log("Returning streaming TwiML for live agent");
    } else {
      // Fallback/Gather branch - agent not live or in training
      const intentUrl = `https://${projectRef}.supabase.co/functions/v1/handle-intent?tenant_id=${xmlEscape(tenantId)}&business_name=${encodeURIComponent(businessName)}`;
      
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! I'm the AI receptionist for ${xmlEscape(businessName)}. How can I help you today?</Say>
  <Gather input="speech" language="en-US" speechTimeout="auto" action="${xmlEscape(intentUrl)}" method="POST">
    <Say>I'm listening…</Say>
  </Gather>
</Response>`;

      console.log("Returning gather TwiML for fallback mode");
    }

    return new Response(twiml, { 
      headers: { "Content-Type": "text/xml" } 
    });

  } catch (err) {
    console.error("Error in twilio-router:", err);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say>\n  <Hangup/>\n</Response>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  }
});