import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = { 
  name: string; 
  userId: string; 
  website_url?: string; 
  greeting?: string; 
  brand_color?: string; 
  logo_url?: string; 
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as Payload;
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    const sb = createClient(url, key);

    console.log(`Creating tenant: ${body.name} for user: ${body.userId}`);

    // Create tenant with slug
    const baseSlug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    // Ensure slug uniqueness
    let slug = baseSlug || 'tenant';
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: exists } = await sb.from('tenants').select('id').eq('slug', slug).maybeSingle();
      if (!exists) break;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    
    const { data: tenant, error: terr } = await sb
      .from("tenants")
      .insert({ 
        name: body.name, 
        slug,
        created_by: body.userId 
      })
      .select("id")
      .single();
    
    if (terr) {
      console.error("Error creating tenant:", terr);
      throw terr;
    }
    
    const tenantId = tenant.id as string;
    console.log(`Created tenant with ID: ${tenantId}`);

    // Add user as owner (try both table names for compatibility)
    try {
      await sb.from("memberships").insert({ 
        tenant_id: tenantId, 
        user_id: body.userId, 
        role: "OWNER" 
      });
    } catch (membershipError) {
      console.log('Memberships table insert failed, trying tenant_users:', membershipError);
      await sb.from("tenant_users").insert({ 
        tenant_id: tenantId, 
        user_id: body.userId, 
        role: "owner" 
      });
    }

    // Set active tenant
    await sb.from("profiles").update({ 
      active_tenant_id: tenantId 
    }).eq("id", body.userId);

    // Create agent settings
    await sb.from("agent_settings").insert({ 
      tenant_id: tenantId, 
      greeting: body.greeting ?? `Thanks for calling ${body.name}!`, 
      website_url: body.website_url ?? null 
    });

    // Create tenant branding
    await sb.from("tenant_branding").insert({ 
      tenant_id: tenantId, 
      brand_color: body.brand_color ?? "#6d28d9", 
      logo_url: body.logo_url ?? null 
    });

    // Create Stripe customer if Stripe is configured
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
        const customer = await stripe.customers.create({ name: body.name });
        await sb.from("tenants").update({ stripe_customer_id: customer.id }).eq("id", tenantId);
        console.log(`Created Stripe customer: ${customer.id}`);
      } catch (stripeError) {
        console.warn("Failed to create Stripe customer:", stripeError);
        // Don't fail the whole operation if Stripe fails
      }
    }

    return new Response(JSON.stringify({ ok: true, tenantId }), { 
      headers: { ...corsHeaders, "content-type": "application/json" } 
    });
  } catch (e: any) {
    const message = e?.message || e?.error_description || e?.error || (()=>{ try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("Tenant creation error:", e);
    return new Response(JSON.stringify({ ok: false, error: message }), { 
      status: 400, 
      headers: { ...corsHeaders, "content-type": "application/json" } 
    });
  }
});