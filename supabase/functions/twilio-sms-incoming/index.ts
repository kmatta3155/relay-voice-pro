import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Incoming SMS webhook')
    
    // Parse form data from Twilio
    const formData = await req.formData()
    const messageSid = formData.get('MessageSid')
    const from = formData.get('From')
    const to = formData.get('To')
    const body = formData.get('Body')
    
    console.log('SMS details:', { messageSid, from, to, body })

    // Get tenant_id from query params or lookup by phone number
    const url = new URL(req.url)
    let tenantId = url.searchParams.get('tenant_id')
    
    if (!tenantId && to) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      
      const { data } = await supabase
        .from('agent_settings')
        .select('tenant_id, ai_sms_autoreplies')
        .eq('twilio_number', to)
        .single()
      
      tenantId = data?.tenant_id
      
      if (!tenantId) {
        console.error('No tenant found for SMS number:', to)
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: { 'Content-Type': 'text/xml' }
        })
      }

      // Store the message
      await supabase
        .from('messages')
        .insert({
          tenant_id: tenantId,
          from: from,
          text: body,
          direction: 'inbound',
          sent_at: new Date().toISOString(),
          thread_id: crypto.randomUUID(),
          body: body
        })

      let responseText = ''

      // Check if auto-replies are enabled
      if (data?.ai_sms_autoreplies) {
        // Generate AI response
        try {
          const { data: agent } = await supabase
            .from('ai_agents')
            .select('system_prompt')
            .eq('tenant_id', tenantId)
            .single()

          if (agent) {
            const aiResponse = await generateAIResponse(body, agent.system_prompt)
            responseText = aiResponse

            // Store the AI response
            await supabase
              .from('messages')
              .insert({
                tenant_id: tenantId,
                from: to,
                text: responseText,
                direction: 'outbound',
                sent_at: new Date().toISOString(),
                thread_id: crypto.randomUUID(),
                body: responseText
              })
          }
        } catch (error) {
          console.error('Error generating AI response:', error)
          responseText = "Thank you for your message. We'll get back to you soon!"
        }
      } else {
        // Standard auto-reply
        responseText = "Thank you for your message. We'll get back to you soon!"
      }

      // Return TwiML response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseText}</Message>
</Response>`

      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })

  } catch (error) {
    console.error('SMS webhook error:', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})

async function generateAIResponse(message: string, systemPrompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `${systemPrompt}\n\nYou are responding to an SMS message. Keep your response brief (under 160 characters if possible) and helpful. If the customer needs to schedule something or has a complex request, invite them to call.`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 100,
      temperature: 0.7
    }),
  })

  const data = await response.json()
  return data.choices[0].message.content.trim()
}