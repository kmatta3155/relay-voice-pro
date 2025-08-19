import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
serve(async (req)=>{
  const { tenantId, enabled } = await req.json();
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);
  await sb.rpc("toggle_ai_sms", { p_tenant: tenantId, p_enabled: enabled });
  return new Response(JSON.stringify({ ok:true }), { headers: { "content-type": "application/json" }});
});
