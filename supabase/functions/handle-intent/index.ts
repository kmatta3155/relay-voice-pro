import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const functionsDomain = `${projectRef}.functions.supabase.co`;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getReplyFromLLM(transcript: string, tenantId: string, businessName: string): Promise<string> {
  try {
    // Get grounding context for the tenant
    const { data: searchResults } = await supabase
      .rpc('search_knowledge_keywords', {
        p_tenant: tenantId,
        p_query: transcript,
        p_match_count: 3
      });

    let context = '';
    if (searchResults && searchResults.length > 0) {
      context = searchResults.map((r: any) => r.content).join('\n');
    }

    // Simple mock response for now - replace with actual LLM call
    if (transcript.toLowerCase().includes('hour')) {
      return `Our hours vary by day. Let me check our current schedule for you. Is there a specific day you'd like to know about?`;
    } else if (transcript.toLowerCase().includes('price') || transcript.toLowerCase().includes('cost')) {
      return `I'd be happy to help with pricing information. What service are you interested in?`;
    } else if (transcript.toLowerCase().includes('appointment') || transcript.toLowerCase().includes('book')) {
      return `I can help you schedule an appointment. What type of service would you like to book?`;
    } else if (transcript.toLowerCase().includes('thank')) {
      return `You're welcome! Is there anything else I can help you with today?`;
    } else if (transcript.toLowerCase().includes('bye') || transcript.toLowerCase().includes('goodbye')) {
      return `Thank you for calling ${businessName}. Have a great day!`;
    } else {
      return `I understand you're asking about "${transcript}". Let me help you with that. Could you please be more specific about what you need?`;
    }
  } catch (error) {
    console.error('Error getting LLM reply:', error);
    return `I'm sorry, I didn't catch that. Could you please repeat your question?`;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenant_id');
    const businessName = url.searchParams.get('business_name') || 'this business';

    if (!tenantId) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, there was a configuration error. Please try again later.</Say>
  <Hangup/>
</Response>`;
      return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    let transcript = '';
    
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.formData();
        transcript = (formData.get('SpeechResult') as string) || '';
        
        // Log the interaction
        console.log(`[INTENT] Tenant: ${tenantId}, Speech: "${transcript}"`);
      }
    }

    // Handle empty or failed speech recognition
    if (!transcript || transcript.trim() === '') {
      const retryTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I didn't catch that. Could you please repeat your question?</Say>
  <Gather input="speech" language="en-US" speechTimeout="3" action="${xmlEscape(req.url)}" method="POST">
    <Say voice="alice">I'm listening...</Say>
  </Gather>
  <Say voice="alice">Thank you for calling. Goodbye!</Say>
  <Hangup/>
</Response>`;
      return new Response(retryTwiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // Get AI response
    const reply = await getReplyFromLLM(transcript, tenantId, businessName);

    // Continue conversation
    const continueTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${xmlEscape(reply)}</Say>
  <Gather input="speech" language="en-US" speechTimeout="auto" action="${xmlEscape(req.url)}" method="POST">
    <Say voice="alice">What else can I help you with?</Say>
  </Gather>
  <Say voice="alice">Thank you for calling ${xmlEscape(businessName)}. Have a great day!</Say>
  <Hangup/>
</Response>`;

    return new Response(continueTwiml, { headers: { 'Content-Type': 'text/xml' } });

  } catch (error) {
    console.error('Handle intent error:', error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, I'm experiencing technical difficulties. Please try calling back in a few minutes.</Say>
  <Hangup/>
</Response>`;
    
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }
});