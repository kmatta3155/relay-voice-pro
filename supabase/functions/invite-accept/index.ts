import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = { token: string; userId: string };

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, userId } = await req.json() as Payload;
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);

    // Get invite
    const { data: invite, error: e1 } = await sb.from("invites")
      .select("id, tenant_id, email, role, status, expires_at")
      .eq("token", token).single();
    if (e1) throw e1;
    
    // Validate invite
    if (invite.status !== "pending") throw new Error("Invite not pending");
    if (new Date(invite.expires_at) < new Date()) throw new Error("Invite expired");

    // Get user email
    const { data: u } = await sb.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email) throw new Error("User not found");
    if (email.toLowerCase() !== String(invite.email).toLowerCase()) {
      throw new Error("Invite email mismatch");
    }

    // Add user to tenant
    await sb.from("tenant_users").upsert({ 
      tenant_id: invite.tenant_id, 
      user_id: userId, 
      role: invite.role 
    });

    // Set active tenant
    await sb.from("profiles").update({ 
      active_tenant_id: invite.tenant_id 
    }).eq("id", userId);

    // Mark invite as accepted
    await sb.from("invites").update({ 
      status: "accepted" 
    }).eq("id", invite.id);

    return new Response(JSON.stringify({ ok: true }), { 
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  } catch (e) {
    console.error("Invite acceptance error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { 
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  }
});