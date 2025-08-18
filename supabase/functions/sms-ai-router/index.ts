import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/*
 * sms-ai-router
 *
 * This function handles incoming SMS conversations and decides how to respond
 * using your AI receptionist. In your final system this router would check
 * for opt-out keywords (STOP/START/HELP), look up the tenant via the "To"
 * number, fetch knowledge from Supabase and possibly OpenAI, parse booking
 * requests, reschedule appointments, etc. For now this skeleton simply
 * acknowledges receipt of the SMS body and returns a canned response.
 */

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    const body: string = payload.body ?? "";
    // Placeholder AI logic: simply echo the inbound message.
    const reply = `AI receptionist received: ${body}`;
    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
});