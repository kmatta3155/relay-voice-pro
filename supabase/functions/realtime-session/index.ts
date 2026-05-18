import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.54.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

    const { sdp, tenant_id, voice = 'alloy', model = 'gpt-4o-realtime-preview' } = await req.json();
    if (!sdp) throw new Error('sdp offer is required');

    // Fetch tenant system prompt if tenant_id provided
    let instructions = "You are a helpful, friendly AI voice assistant.";
    if (tenant_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && supabaseKey) {
          const sb = createClient(supabaseUrl, supabaseKey);
          const { data: agent } = await sb
            .from('ai_agents')
            .select('system_prompt')
            .eq('tenant_id', tenant_id)
            .maybeSingle();
          if (agent?.system_prompt) instructions = agent.system_prompt;
        }
      } catch (e) {
        console.warn('Agent prompt lookup failed, using default:', e);
      }
    }

    // Proxy SDP offer to OpenAI Realtime API (GA endpoint)
    const sdpResponse = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/sdp',
        },
        body: sdp,
      }
    );

    if (!sdpResponse.ok) {
      const errText = await sdpResponse.text();
      throw new Error(`OpenAI Realtime error: ${sdpResponse.status} - ${errText}`);
    }

    const answerSdp = await sdpResponse.text();

    return new Response(JSON.stringify({ sdp: answerSdp, instructions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('realtime-session error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
