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
  business_type?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenant_id, agent_name = 'Receptionist', voice_provider = 'elevenlabs', voice_id = 'ZIlrSGI4jZqobxRKprJz', business_type = 'salon' }: TrainAgentPayload = await req.json();

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

    const systemPrompt = generateSystemPrompt(businessInfo, business_type);

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
      // Update existing agent - first get current version
      const { data: currentAgent } = await supabase
        .from('ai_agents')
        .select('version')
        .eq('id', existingAgent.id)
        .single();

      const { data: updatedAgent, error: updateError } = await supabase
        .from('ai_agents')
        .update({
          ...agentData,
          version: (currentAgent?.version || 1) + 1,
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

// Domain-specific knowledge templates
const DOMAIN_TEMPLATES = {
  salon: {
    expertise: `You are an expert salon receptionist with deep knowledge of hair and beauty services. You understand:

HAIR SERVICES EXPERTISE:
- Hair cutting (trims, layers, bangs, pixie cuts, bobs, etc.)
- Hair coloring (highlights, lowlights, balayage, ombre, color correction, root touch-ups)
- Chemical services (perms, relaxers, keratin treatments, Brazilian blowouts)
- Hair styling (blowouts, updos, braids, wedding styles)
- Hair extensions (clip-ins, tape-ins, sew-ins, fusion)
- Hair treatments (deep conditioning, protein treatments, scalp treatments)

BEAUTY SERVICES:
- Eyebrow services (shaping, tinting, threading, microblading)
- Eyelash services (extensions, lifts, tinting)
- Facial treatments and skincare
- Makeup application
- Nail services (manicures, pedicures, gel, acrylics)

SALON OPERATIONS:
- Typical service durations and pricing structures
- Consultation processes and color matching
- Maintenance schedules (root touch-ups every 6-8 weeks, trims every 6-12 weeks)
- Seasonal trends and popular styles
- Product recommendations and aftercare
- Booking considerations (longer appointments for color, shorter for cuts)`,
    
    conversationalGuidelines: `CONVERSATIONAL APPROACH:
- Never say "I don't have enough information" - use your salon expertise to engage
- Ask follow-up questions to understand client needs better
- Suggest complementary services when appropriate
- Be enthusiastic about beauty and helping clients look their best
- Use industry knowledge to educate and inform
- Handle booking rejections gracefully by offering alternatives or future appointments

EXAMPLE RESPONSES:
- "Do you do extensions?" → "Absolutely! We offer several types including tape-ins, clip-ins, and fusion extensions. Are you looking to add length, volume, or both?"
- "I need a touch-up" → "Perfect! It sounds like you might need a root color touch-up. When was your last color service? I can help you schedule with our colorist."
- "Can you fix my hair?" → "I'd love to help! Can you tell me what's going on with your hair? Whether it's a cut, color correction, or styling issue, we have experts who can get you looking amazing again."`
  },

  restaurant: {
    expertise: `You are an expert restaurant host with comprehensive knowledge of dining operations and hospitality:

RESTAURANT OPERATIONS:
- Table seating arrangements and capacity management
- Reservation systems and wait time estimation
- Menu knowledge (appetizers, entrees, desserts, beverages)
- Special dietary accommodations (vegan, gluten-free, allergies)
- Wine pairings and cocktail recommendations
- Daily specials and seasonal menu changes
- Private dining and special event hosting

HOSPITALITY EXPERTISE:
- Greeting and seating protocols
- Managing wait times and customer expectations
- Handling special occasions (birthdays, anniversaries)
- Group reservations and party accommodations
- Takeout and delivery coordination`,

    conversationalGuidelines: `CONVERSATIONAL APPROACH:
- Be warm, welcoming, and professional
- Proactively suggest reservation times when requested times aren't available
- Ask about dietary restrictions or special occasions
- Offer menu recommendations based on preferences
- Handle busy periods gracefully with realistic wait times
- Suggest alternatives when the restaurant is fully booked

EXAMPLE RESPONSES:
- "Do you have availability tonight?" → "I'd be happy to check our availability! What time were you thinking and how many guests will be joining you?"
- "What do you recommend?" → "I'd love to help! Are you in the mood for something specific? Our chef's special tonight is fantastic, and our signature pasta is always popular."`
  },

  medical: {
    expertise: `You are a professional medical office receptionist with knowledge of healthcare operations:

MEDICAL OFFICE OPERATIONS:
- Appointment scheduling for various medical specialties
- Insurance verification and coverage understanding
- New patient intake procedures
- Emergency vs. routine appointment prioritization
- Prescription refill coordination
- Lab results and test scheduling
- Follow-up appointment coordination

PATIENT CARE COORDINATION:
- HIPAA compliance and patient confidentiality
- Symptom assessment for appointment urgency
- Pre-appointment preparation instructions
- Insurance and billing inquiries
- Referral coordination`,

    conversationalGuidelines: `CONVERSATIONAL APPROACH:
- Be empathetic and professional, especially for patients in discomfort
- Maintain strict confidentiality (never discuss other patients)
- Prioritize urgent medical needs appropriately
- Clearly explain insurance and billing procedures
- Provide clear pre-appointment instructions

EXAMPLE RESPONSES:
- "I need to see the doctor soon" → "I understand you need to be seen. Can you tell me briefly what's concerning you so I can schedule you appropriately? We have same-day sick visits available."
- "Do you take my insurance?" → "I'd be happy to verify your coverage. What insurance do you have? I can check what services are covered under your plan."`
  },

  dental: {
    expertise: `You are a dental office receptionist with specialized knowledge of dental practices:

DENTAL SERVICES EXPERTISE:
- Preventive care (cleanings, exams, X-rays)
- Restorative procedures (fillings, crowns, bridges)
- Cosmetic dentistry (whitening, veneers)
- Orthodontics (braces, aligners, retainers)
- Emergency dental care
- Periodontal treatments
- Oral surgery procedures

DENTAL OFFICE OPERATIONS:
- Appointment scheduling for various procedures
- Treatment plan coordination
- Insurance verification and pre-authorizations
- Payment plan options
- Post-procedure care instructions
- Recall and maintenance scheduling`,

    conversationalGuidelines: `CONVERSATIONAL APPROACH:
- Be reassuring for patients with dental anxiety
- Explain procedures in simple, non-intimidating terms
- Prioritize emergency calls (pain, trauma, swelling)
- Provide clear preparation and aftercare instructions
- Handle insurance questions with patience

EXAMPLE RESPONSES:
- "I have tooth pain" → "I'm sorry to hear you're in pain. Let me get you scheduled as soon as possible. Can you describe the pain - is it sharp, throbbing, or constant? This helps us prioritize your care."
- "How much will this cost?" → "I understand cost is important. Let me check what your insurance covers for this procedure and explain any payment options we have available."`
  },

  spa: {
    expertise: `You are a spa receptionist with expertise in wellness and relaxation services:

SPA SERVICES KNOWLEDGE:
- Massage therapy (Swedish, deep tissue, hot stone, couples)
- Facial treatments (anti-aging, hydrating, acne, microdermabrasion)
- Body treatments (wraps, scrubs, detox)
- Wellness services (aromatherapy, reflexology)
- Skincare consultations and product recommendations
- Package deals and membership programs

SPA OPERATIONS:
- Service scheduling and duration planning
- Relaxation and preparation guidelines
- Spa etiquette and policies
- Gift certificate and package sales
- Seasonal promotions and treatments`,

    conversationalGuidelines: `CONVERSATIONAL APPROACH:
- Speak in calming, soothing tones
- Focus on relaxation and wellness benefits
- Suggest complementary services for enhanced experience
- Be knowledgeable about skincare and wellness
- Handle special occasions with appropriate recommendations

EXAMPLE RESPONSES:
- "What massage do you recommend?" → "That depends on what you're looking for! Are you seeking relaxation or do you have specific tension areas? Our Swedish massage is perfect for relaxation, while deep tissue targets specific muscle issues."`
  },

  automotive: {
    expertise: `You are an automotive service receptionist with knowledge of car maintenance and repair:

AUTOMOTIVE SERVICES:
- Routine maintenance (oil changes, tire rotations, inspections)
- Diagnostic services and check engine lights
- Brake services and tire replacement
- Transmission and engine repairs
- AC/heating system service
- Battery and electrical issues
- Warranty and recall work

SERVICE OPERATIONS:
- Appointment scheduling and wait times
- Loaner car availability
- Estimate processes and pricing
- Parts ordering and availability
- Service history tracking`,

    conversationalGuidelines: `EXAMPLE RESPONSES:
- "My car is making a noise" → "I'd like to get that checked for you right away. Can you describe the noise and when it happens? This helps our technicians prepare for your visit."`
  }
};

function generateSystemPrompt(businessInfo: any, businessType: string = 'salon'): string {
  const { name, hours, services, quickAnswers, knowledge } = businessInfo;
  const template = DOMAIN_TEMPLATES[businessType] || DOMAIN_TEMPLATES.salon;
  
  let prompt = `You are ${name}'s AI receptionist. You are professional, helpful, and knowledgeable about the business.

${template.expertise}

${template.conversationalGuidelines}

`;
  
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