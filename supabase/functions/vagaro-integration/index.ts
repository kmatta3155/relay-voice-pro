import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.54.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const VAGARO_BASE = "https://api.vagaro.com";

// Exchange the salon's API credentials for a bearer access token.
// Confirmed endpoint: POST {base}/{region}/api/v2/merchants/generate-access-token
async function generateVagaroToken(region: string, clientId: string, clientSecret: string, scope: string) {
  const url = `${VAGARO_BASE}/${region}/api/v2/merchants/generate-access-token`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ clientId, clientSecretKey: clientSecret, scope }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* non-json */ }
  if (!resp.ok) {
    throw new Error(`Vagaro auth ${resp.status}: ${text.slice(0, 200)}`);
  }
  // Token field name varies; accept common shapes
  const token = body.access_token || body.accessToken || body.token || body.data?.access_token;
  const expiresIn = body.expires_in || body.expiresIn || 3600;
  if (!token) throw new Error("Vagaro returned no access token (check scope/credentials)");
  return { token, expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000).toISOString() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Require an authenticated member of the tenant
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !u?.user) {
      return json({ error: "Authentication required" }, 401);
    }
    const { action, tenantId, provider = "vagaro", region, clientId, clientSecret, scope = "" } = await req.json();
    if (!tenantId) return json({ error: "tenantId required" }, 400);

    const { data: mem } = await admin.from("memberships")
      .select("user_id").eq("tenant_id", tenantId).eq("user_id", u.user.id).maybeSingle();
    if (!mem) return json({ error: "Not authorized for this tenant" }, 403);

    if (action === "status") {
      const { data } = await admin.from("booking_integrations")
        .select("provider,region,status,external_business_id,last_synced_at,last_error")
        .eq("tenant_id", tenantId).maybeSingle();
      return json({ integration: data || { status: "disconnected" } });
    }

    if (action === "disconnect") {
      await admin.from("booking_integrations").delete().eq("tenant_id", tenantId);
      return json({ ok: true, status: "disconnected" });
    }

    if (action === "connect") {
      if (provider !== "vagaro") return json({ error: `Provider ${provider} not supported yet` }, 400);
      if (!region || !clientId || !clientSecret) {
        return json({ error: "region, clientId, and clientSecret are required" }, 400);
      }
      try {
        const { token, expiresAt } = await generateVagaroToken(region, clientId, clientSecret, scope);
        await admin.from("booking_integrations").upsert({
          tenant_id: tenantId,
          provider: "vagaro",
          region,
          client_id: clientId,
          client_secret: clientSecret,
          access_token: token,
          token_expires_at: expiresAt,
          status: "connected",
          last_error: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id" });
        return json({ ok: true, status: "connected" });
      } catch (e) {
        const msg = (e as Error).message;
        await admin.from("booking_integrations").upsert({
          tenant_id: tenantId, provider: "vagaro", region,
          client_id: clientId, client_secret: clientSecret,
          status: "error", last_error: msg, updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id" });
        return json({ error: msg, status: "error" }, 400);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
