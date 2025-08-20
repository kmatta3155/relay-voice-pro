import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Cmd =
  | { action: "upsert_hours"; tenantId: string; hours: Array<{ dow:number; open: string; close: string }> }
  | { action: "upsert_holidays"; tenantId: string; holidays: Array<{ day: string; name?: string }> }
  | { action: "upsert_services"; tenantId: string; services: Array<{ id?:string; name:string; duration_minutes:number; price?:number; active?:boolean }> }
  | { action: "update_branding"; tenantId: string; brand_color?:string; logo_url?:string }
  | { action: "update_agent"; tenantId: string; greeting?:string; forward_number?:string; agent_ws_url?:string; website_url?:string; ai_sms_autoreplies?:boolean }
  | { action: "invite"; tenantId: string; email: string; role: "admin"|"manager"|"staff" };

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!, 
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  
  try {
    const body = await req.json() as Cmd;
    console.log(`Admin control action: ${body.action} for tenant: ${body.tenantId}`);

    if (body.action === "upsert_hours") {
      // Delete existing hours and insert new ones
      await sb.from("business_hours").delete().eq("tenant_id", body.tenantId);
      const hoursData = body.hours.map(h => ({ 
        tenant_id: body.tenantId, 
        dow: h.dow, 
        open_time: h.open, 
        close_time: h.close 
      }));
      await sb.from("business_hours").insert(hoursData);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    if (body.action === "upsert_holidays") {
      // Delete existing holidays and insert new ones
      await sb.from("holidays").delete().eq("tenant_id", body.tenantId);
      const holidaysData = body.holidays.map(h => ({ 
        tenant_id: body.tenantId, 
        day: h.day, 
        name: h.name ?? null 
      }));
      await sb.from("holidays").insert(holidaysData);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    if (body.action === "upsert_services") {
      // Upsert services one by one
      for (const s of body.services) {
        if (s.id) {
          // Update existing service
          await sb.from("services").upsert({ 
            ...s, 
            tenant_id: body.tenantId, 
            id: s.id 
          });
        } else {
          // Check if service with same name exists
          const { data: exists } = await sb
            .from("services")
            .select("id")
            .eq("tenant_id", body.tenantId)
            .eq("name", s.name)
            .maybeSingle();
          
          if (exists?.id) {
            // Update existing
            await sb.from("services").update({ ...s }).eq("id", exists.id);
          } else {
            // Insert new
            await sb.from("services").insert({ ...s, tenant_id: body.tenantId });
          }
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    if (body.action === "update_branding") {
      await sb.from("tenant_branding").upsert({ 
        tenant_id: body.tenantId, 
        brand_color: body.brand_color, 
        logo_url: body.logo_url, 
        updated_at: new Date().toISOString() 
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    if (body.action === "update_agent") {
      const updateData: any = {};
      if (body.greeting !== undefined) updateData.greeting = body.greeting;
      if (body.forward_number !== undefined) updateData.forward_number = body.forward_number;
      if (body.agent_ws_url !== undefined) updateData.agent_ws_url = body.agent_ws_url;
      if (body.website_url !== undefined) updateData.website_url = body.website_url;
      if (body.ai_sms_autoreplies !== undefined) updateData.ai_sms_autoreplies = body.ai_sms_autoreplies;
      
      await sb.from("agent_settings").update(updateData).eq("tenant_id", body.tenantId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    if (body.action === "invite") {
      await sb.from("invites").insert({ 
        tenant_id: body.tenantId, 
        email: body.email, 
        role: body.role 
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
    
    return new Response(JSON.stringify({ ok:false, error: "unknown action" }), { 
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  } catch (e) {
    console.error("Admin control error:", e);
    return new Response(JSON.stringify({ ok:false, error: String(e) }), { 
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  }
});