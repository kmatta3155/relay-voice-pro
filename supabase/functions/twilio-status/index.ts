import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/*
 * twilio-status
 *
 * This edge function is invoked by Twilio when call status events occur. It
 * receives x-www-form-urlencoded data describing the call and, if desired,
 * persists the information into your Supabase database. For now this
 * skeleton simply parses the form data and returns a 204 No Content
 * response. You can extend it to insert call logs or trigger workflows.
 */

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Support CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  try {
    const formData = await req.formData();
    // Convert FormData to a plain object
    const payload: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      payload[key] = String(value);
    }
    // TODO: Insert call status into a call_logs table if desired. Example:
    // const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    // const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // await supabase.from('call_logs').insert({
    //   call_sid: payload.CallSid,
    //   status: payload.CallStatus,
    //   from: payload.From,
    //   to: payload.To,
    //   timestamp: new Date().toISOString(),
    // });
    // Respond with no content to acknowledge receipt
    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "content-type": "application/json", ...corsHeaders } },
    );
  }
});