#!/usr/bin/env -S deno run --allow-net --allow-env

// Fetch recent Twilio call logs
const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('❌ Missing Twilio credentials')
  Deno.exit(1)
}

// Create Basic Auth header
const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)

// Get calls from last 24 hours
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)

const params = new URLSearchParams({
  StartTimeAfter: yesterday.toISOString().split('T')[0],
  PageSize: '10',
  Status: 'completed'
})

const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json?${params}`

console.log('📞 Fetching recent call logs...\n')

try {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${credentials}`
    }
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('❌ Failed to fetch calls:', error)
    Deno.exit(1)
  }

  const data = await response.json()
  
  if (!data.calls || data.calls.length === 0) {
    console.log('No calls found in the last 24 hours')
    Deno.exit(0)
  }

  console.log(`Found ${data.calls.length} recent call(s)\n`)
  console.log('='.repeat(80))
  
  // Show most recent call first
  const mostRecent = data.calls[0]
  console.log('📱 MOST RECENT CALL:')
  console.log('='.repeat(80))
  console.log(`Call SID:      ${mostRecent.sid}`)
  console.log(`From:          ${mostRecent.from_formatted || mostRecent.from}`)
  console.log(`To:            ${mostRecent.to_formatted || mostRecent.to}`)
  console.log(`Direction:     ${mostRecent.direction}`)
  console.log(`Status:        ${mostRecent.status}`)
  console.log(`Started:       ${mostRecent.start_time}`)
  console.log(`Duration:      ${mostRecent.duration} seconds`)
  console.log(`Price:         ${mostRecent.price || 'N/A'} ${mostRecent.price_unit || ''}`)
  
  // Check for recordings
  if (mostRecent.subresource_uris?.recordings) {
    console.log('\n📼 Checking for recordings...')
    const recordingsUrl = `https://api.twilio.com${mostRecent.subresource_uris.recordings}`
    const recResponse = await fetch(recordingsUrl, {
      headers: { 'Authorization': `Basic ${credentials}` }
    })
    
    if (recResponse.ok) {
      const recData = await recResponse.json()
      if (recData.recordings && recData.recordings.length > 0) {
        console.log(`Found ${recData.recordings.length} recording(s)`)
      } else {
        console.log('No recordings found')
      }
    }
  }
  
  // Show all recent calls summary
  if (data.calls.length > 1) {
    console.log('\n' + '='.repeat(80))
    console.log('📋 ALL RECENT CALLS SUMMARY:')
    console.log('='.repeat(80))
    
    for (const call of data.calls) {
      const duration = call.duration ? `${call.duration}s` : 'N/A'
      const time = new Date(call.start_time).toLocaleTimeString()
      console.log(`${time} | ${call.direction.padEnd(15)} | ${call.from_formatted || call.from} → ${call.to_formatted || call.to} | Duration: ${duration}`)
    }
  }
  
  // Try to fetch call events for the most recent call
  console.log('\n' + '='.repeat(80))
  console.log('📊 CALL EVENTS & MEDIA STREAMS:')
  console.log('='.repeat(80))
  
  // Note: Events API might require additional permissions
  const eventsUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${mostRecent.sid}/Events.json`
  const eventsResponse = await fetch(eventsUrl, {
    headers: { 'Authorization': `Basic ${credentials}` }
  })
  
  if (eventsResponse.ok) {
    const eventsData = await eventsResponse.json()
    if (eventsData.events && eventsData.events.length > 0) {
      console.log(`Found ${eventsData.events.length} event(s)`)
      for (const event of eventsData.events) {
        console.log(`  - ${event.request_method} ${event.request_url}`)
      }
    } else {
      console.log('No events data available')
    }
  } else {
    console.log('Events API not accessible (might need additional permissions)')
  }
  
} catch (error) {
  console.error('❌ Error fetching call logs:', error)
  Deno.exit(1)
}