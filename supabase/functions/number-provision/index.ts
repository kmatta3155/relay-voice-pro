import { serve } from "https://deno.land/std@0.223.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Cmd =
  | { action: "search"; country?: string; areaCode?: string }
  | { action: "purchase"; phoneNumber: string; tenantId: string; projectBase: string };

const twilioFetch = async (path: string, method = "GET", body?: URLSearchParams) => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const url = `https://api.twilio.com/2010-04-01${path}`;
  const auth = "Basic " + btoa(`${sid}:${tok}`);
  const opts: RequestInit = { 
    method, 
    headers: { 
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    } 
  };
  if (body) opts.body = body;
  
  console.log(`Twilio API call: ${method} ${url}`);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Twilio API error: ${res.status} - ${errorText}`);
    throw new Error(`Twilio API error: ${res.status} - ${errorText}`);
  }
  return res.json();
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as Cmd;
    console.log(`Number provision action: ${body.action}`);

    if (body.action === "search") {
      const country = body.country ?? "US";
      const qs = new URLSearchParams({ PageSize: "10" });
      if (body.areaCode) qs.set("AreaCode", body.areaCode);
      
      const data = await twilioFetch(
        `/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/AvailablePhoneNumbers/${country}/Local.json?${qs}`
      );
      
      return new Response(JSON.stringify({ 
        ok: true, 
        numbers: data.available_phone_numbers 
      }), { 
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }

    if (body.action === "purchase") {
      const form = new URLSearchParams({ 
        PhoneNumber: body.phoneNumber, 
        SmsEnabled: "true", 
        VoiceEnabled: "true" 
      });
      
      const bought = await twilioFetch(
        `/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/IncomingPhoneNumbers.json`, 
        "POST", 
        form
      );

      console.log(`Purchased phone number: ${bought.phone_number} with SID: ${bought.sid}`);

      // Configure webhooks - point to Supabase Functions
      const base = body.projectBase.replace(/\/$/, "");
      const sid = bought.sid;
      const setHooks = new URLSearchParams({
        VoiceUrl: `${base}/functions/v1/twilio-router?tenant_id=${body.tenantId}`,
        StatusCallback: `${base}/functions/v1/twilio-status?tenant_id=${body.tenantId}`,
        SmsUrl: `${base}/functions/v1/twilio-sms-incoming?tenant_id=${body.tenantId}`,
      });
      
      await twilioFetch(
        `/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/IncomingPhoneNumbers/${sid}.json`, 
        "POST", 
        setHooks
      );

      console.log(`Configured webhooks for number: ${bought.phone_number}`);

      return new Response(JSON.stringify({ 
        ok: true, 
        sid, 
        phoneNumber: bought.phone_number 
      }), { 
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "unknown action" }), { 
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  } catch (e) {
    console.error("Number provision error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { 
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  }
});