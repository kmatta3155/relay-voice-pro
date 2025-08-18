import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/*
 * tenant-create
 *
 * This function is invoked from the admin UI to create a new tenant. A tenant is
 * a separate customer space for your AI receptionist. In a real implementation
 * you might insert rows into several tables (tenants, memberships, agent_settings, etc.)
 * and seed demo data. For this skeleton we simply echo the payload back and
 * return a 200 response so that it can be deployed without error.
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
    // In a complete implementation you would authenticate the caller and use
    // the service role key to insert a new tenant row. For now, just echo.
    return new Response(JSON.stringify({ ok: true, received: payload }), {
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