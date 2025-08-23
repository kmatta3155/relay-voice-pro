import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const requestBody = await req.json().catch(() => ({}));
    const { tenant_id, instructions, voice = "alloy" } = requestBody;

    // Build domain + tenant-specific instructions
    let finalInstructions: string = instructions || "You are a helpful AI assistant.";

    try {
      if (tenant_id) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase env vars missing');
        const sb = createClient(supabaseUrl, supabaseServiceKey);

        const { data: agent, error: agentErr } = await sb
          .from('ai_agents')
          .select('name, system_prompt, overrides')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (agentErr) console.error('Fetch agent error:', agentErr);
        if (agent?.system_prompt) {
          finalInstructions = `${agent.system_prompt}\n\nCONVERSATION RULES:\n- Never reply with "not enough information"; ask concise follow-ups instead.\n- Infer likely intent from salon/industry context when details are missing.\n- Be friendly, proactive, and offer next steps (book, estimate, consult).\n- If unsure on specifics (e.g., exact price), give typical ranges and offer to confirm.\n- Prefer business info from this tenant (services, hours, quick answers).`;
        }
      }
    } catch (e) {
      console.warn('Agent prompt lookup failed, using fallback instructions:', e);
    }

    // Request an ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice,
        instructions: finalInstructions
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log("Session created:", data);
    
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});