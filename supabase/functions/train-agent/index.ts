import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrainAgentPayload {
  tenant_id: string;
  agent_name?: string;
  voice_provider?: string;
  voice_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenant_id, agent_name = 'Receptionist', voice_provider = 'elevenlabs', voice_id = '9BWtsMINqrJLrRacOk9x' }: TrainAgentPayload = await req.json();

    console.log('Training agent for tenant:', tenant_id);

    // 1. Get tenant information
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name, slug')
      .eq('id', tenant_id)
      .single();

    if (tenantError) {
      throw new Error(`Failed to fetch tenant: ${tenantError.message}`);
    }

    // 2. Get business data (hours, services, quick answers, knowledge)
    const [businessHours, services, quickAnswers, knowledgeChunks] = await Promise.all([
      supabase.from('business_hours').select('*').eq('tenant_id', tenant_id),
      supabase.from('services').select('*').eq('tenant_id', tenant_id).eq('active', true),
      supabase.from('business_quick_answers').select('*').eq('tenant_id', tenant_id),
      supabase.from('knowledge_chunks').select('content').eq('tenant_id', tenant_id).limit(20)
    ]);

    // 3. Generate system prompt based on business data
    const businessInfo = {
      name: tenant.name,
      hours: businessHours.data || [],
      services: services.data || [],
      quickAnswers: quickAnswers.data || [],
      knowledge: knowledgeChunks.data?.map(k => k.content).join('\n') || ''
    };

    const systemPrompt = generateSystemPrompt(businessInfo);

    // 4. Create or update AI agent record
    const agentData = {
      tenant_id,
      name: agent_name,
      system_prompt: systemPrompt,
      voice_provider,
      voice_id,
      status: 'training',
      tools: {
        booking: services.data && services.data.length > 0,
        knowledge_base: knowledgeChunks.data && knowledgeChunks.data.length > 0,
        quick_answers: quickAnswers.data && quickAnswers.data.length > 0
      },
      overrides: {
        firstMessage: `Hello! I'm ${agent_name}, your AI receptionist for ${tenant.name}. How can I help you today?`,
        language: 'en'
      }
    };

    const { data: existingAgent } = await supabase
      .from('ai_agents')
      .select('id')
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    let agentId: string;

    if (existingAgent) {
      // Update existing agent
      const { data: updatedAgent, error: updateError } = await supabase
        .from('ai_agents')
        .update({
          ...agentData,
          version: existingAgent.version + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAgent.id)
        .select('id')
        .single();

      if (updateError) throw updateError;
      agentId = updatedAgent.id;
    } else {
      // Create new agent
      const { data: newAgent, error: insertError } = await supabase
        .from('ai_agents')
        .insert(agentData)
        .select('id')
        .single();

      if (insertError) throw insertError;
      agentId = newAgent.id;
    }

    // 5. Create training job record
    const { data: trainingJob, error: jobError } = await supabase
      .from('agent_training_jobs')
      .insert({
        tenant_id,
        agent_id: agentId,
        status: 'running',
        started_at: new Date().toISOString(),
        params: { voice_provider, voice_id }
      })
      .select('id')
      .single();

    if (jobError) throw jobError;

    // 6. Simulate training completion (in real implementation, this would be async)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 7. Update agent and job status
    await Promise.all([
      supabase
        .from('ai_agents')
        .update({
          status: 'ready',
          trained_at: new Date().toISOString()
        })
        .eq('id', agentId),
      
      supabase
        .from('agent_training_jobs')
        .update({
          status: 'succeeded',
          finished_at: new Date().toISOString()
        })
        .eq('id', trainingJob.id)
    ]);

    // 8. Create runtime binding for ElevenLabs if specified
    if (voice_provider === 'elevenlabs') {
      await supabase
        .from('agent_runtimes')
        .upsert({
          tenant_id,
          agent_id: agentId,
          provider: 'elevenlabs',
          settings: {
            voice_id,
            model: 'eleven_multilingual_v2'
          }
        }, {
          onConflict: 'agent_id,provider'
        });
    }

    return new Response(JSON.stringify({
      success: true,
      agent_id: agentId,
      training_job_id: trainingJob.id,
      status: 'ready'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Agent training error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function generateSystemPrompt(businessInfo: any): string {
  const { name, hours, services, quickAnswers, knowledge } = businessInfo;
  
  let prompt = `You are ${name}'s AI receptionist. You are professional, helpful, and knowledgeable about the business.\n\n`;
  
  // Business hours
  if (hours.length > 0) {
    prompt += "BUSINESS HOURS:\n";
    hours.forEach((h: any) => {
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][h.dow];
      if (h.is_closed) {
        prompt += `${dayName}: Closed\n`;
      } else {
        prompt += `${dayName}: ${h.open_time} - ${h.close_time}\n`;
      }
    });
    prompt += "\n";
  }
  
  // Services
  if (services.length > 0) {
    prompt += "SERVICES OFFERED:\n";
    services.forEach((s: any) => {
      prompt += `- ${s.name}`;
      if (s.description) prompt += `: ${s.description}`;
      if (s.price) prompt += ` (Price: $${s.price})`;
      if (s.duration_minutes) prompt += ` (Duration: ${s.duration_minutes} minutes)`;
      prompt += "\n";
    });
    prompt += "\n";
  }
  
  // Quick answers
  if (quickAnswers.length > 0) {
    prompt += "QUICK ANSWERS:\n";
    quickAnswers.forEach((qa: any) => {
      prompt += `Q: ${qa.question_pattern}\nA: ${qa.answer}\n\n`;
    });
  }
  
  // Knowledge base
  if (knowledge) {
    prompt += "ADDITIONAL KNOWLEDGE:\n";
    prompt += knowledge.substring(0, 2000); // Limit length
    prompt += "\n\n";
  }
  
  prompt += "INSTRUCTIONS:\n";
  prompt += "- Be helpful and professional\n";
  prompt += "- Provide accurate information about the business\n";
  prompt += "- If asked about booking, offer to help schedule appointments\n";
  prompt += "- If you don't know something, say so politely\n";
  prompt += "- Keep responses concise but informative\n";
  
  return prompt;
}