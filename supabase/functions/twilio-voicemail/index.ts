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
    console.log('Voicemail recording received')
    
    // Parse form data from Twilio
    const formData = await req.formData()
    const recordingUrl = formData.get('RecordingUrl')
    const recordingSid = formData.get('RecordingSid')
    const callSid = formData.get('CallSid')
    const from = formData.get('From')
    const to = formData.get('To')
    const recordingDuration = formData.get('RecordingDuration')
    
    console.log('Voicemail details:', { 
      recordingUrl, 
      recordingSid, 
      callSid, 
      from, 
      to,
      recordingDuration 
    })

    // Get tenant_id from query params
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')
    
    if (!tenantId) {
      console.error('Missing tenant_id parameter')
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    // Store voicemail in database
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.38.4')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Store as a message with recording URL
    await supabase
      .from('messages')
      .insert({
        tenant_id: tenantId,
        from: from,
        text: `Voicemail recording (${recordingDuration}s)`,
        direction: 'inbound',
        sent_at: new Date().toISOString(),
        thread_id: crypto.randomUUID(),
        body: JSON.stringify({
          type: 'voicemail',
          recordingUrl: recordingUrl,
          recordingSid: recordingSid,
          duration: recordingDuration
        })
      })

    // Update call record
    await supabase
      .from('calls')
      .update({ 
        outcome: 'voicemail',
        duration: parseInt(recordingDuration as string || '0'),
        summary: `Voicemail left (${recordingDuration}s)`
      })
      .eq('tenant_id', tenantId)
      .eq('from', from)
      .order('at', { ascending: false })
      .limit(1)

    // Optionally transcribe the voicemail using OpenAI Whisper
    try {
      if (recordingUrl) {
        const transcription = await transcribeVoicemail(recordingUrl as string)
        
        if (transcription) {
          await supabase
            .from('messages')
            .insert({
              tenant_id: tenantId,
              from: from,
              text: `Voicemail transcription: ${transcription}`,
              direction: 'inbound',
              sent_at: new Date().toISOString(),
              thread_id: crypto.randomUUID(),
              body: transcription
            })
        }
      }
    } catch (error) {
      console.error('Error transcribing voicemail:', error)
    }

    console.log('Voicemail stored successfully')

    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })

  } catch (error) {
    console.error('Voicemail webhook error:', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
})

async function transcribeVoicemail(recordingUrl: string): Promise<string | null> {
  try {
    // Download the recording
    const response = await fetch(recordingUrl)
    const audioBuffer = await response.arrayBuffer()
    
    // Create form data for OpenAI Whisper
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'voicemail.wav')
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'text')
    
    // Call OpenAI Whisper API
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    })

    if (!whisperResponse.ok) {
      throw new Error(`Whisper API error: ${whisperResponse.status}`)
    }

    const transcription = await whisperResponse.text()
    console.log('Voicemail transcribed:', transcription)
    
    return transcription.trim()
  } catch (error) {
    console.error('Error transcribing voicemail:', error)
    return null
  }
}