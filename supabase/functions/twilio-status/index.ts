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
    console.log('Twilio status callback received')
    
    // Parse form data from Twilio
    const formData = await req.formData()
    const callSid = formData.get('CallSid')
    const callStatus = formData.get('CallStatus')
    const callDuration = formData.get('CallDuration')
    const from = formData.get('From')
    const to = formData.get('To')
    
    console.log('Call status update:', { 
      callSid, 
      callStatus, 
      callDuration, 
      from, 
      to 
    })

    // Update call record in database
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Look up tenant by phone number
    const { data: settings } = await supabase
      .from('agent_settings')
      .select('tenant_id')
      .eq('twilio_number', to)
      .single()

    if (settings?.tenant_id) {
      const updateData: any = {
        outcome: mapCallStatus(callStatus as string)
      }

      if (callDuration) {
        updateData.duration = parseInt(callDuration as string)
      }

      await supabase
        .from('calls')
        .update(updateData)
        .eq('tenant_id', settings.tenant_id)
        .eq('from', from)
        .order('at', { ascending: false })
        .limit(1)

      console.log('Call record updated:', updateData)

      // Log analytics event
      await supabase
        .from('logs')
        .insert({
          tenant_id: settings.tenant_id,
          event: 'call_status_update',
          data: JSON.stringify({
            callSid,
            callStatus,
            callDuration,
            from,
            to
          })
        })
    }

    return new Response('OK', {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    })

  } catch (error) {
    console.error('Status callback error:', error)
    return new Response('ERROR', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    })
  }
})

function mapCallStatus(status: string): string {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'busy':
      return 'busy'
    case 'no-answer':
      return 'no-answer'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    default:
      return status
  }
}