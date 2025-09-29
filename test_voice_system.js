// Test script to verify the voice system fallback logic
const FUNCTION_URL = 'https://gnqqktmslswgjtvxfvdo.supabase.co/functions/v1/twilio-voice-stream';

// Test 1: Health check
console.log('🔍 Testing health endpoint...');
fetch(`${FUNCTION_URL}?health=1`)
  .then(r => r.json())
  .then(data => {
    console.log('✅ Health check:', data);
    console.log('📝 Version:', data.version);
    console.log('🎯 Features:', data.features);
  })
  .catch(e => console.error('❌ Health check failed:', e));

// Test 2: WebSocket simulation with wrong tenant ID 
console.log('\n🔍 Testing WebSocket with wrong tenant ID...');

// Simulate what Twilio sends when dialing +19194203058
const testUrl = new URL(FUNCTION_URL);
testUrl.searchParams.set('tenantId', 'f3760fe8-4491-4ab1-83dd-4069b1a2d688'); // Wrong ID
testUrl.searchParams.set('to', '+19194203058'); // Target number
testUrl.searchParams.set('businessName', 'Test Business');
testUrl.searchParams.set('voiceId', 'test-voice');
testUrl.searchParams.set('greeting', 'Test greeting');

console.log('🌐 Test URL:', testUrl.toString());

// Try to connect WebSocket to test fallback logic
try {
  const ws = new WebSocket(testUrl.toString().replace('https:', 'wss:'));
  
  let connected = false;
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    connected = true;
    
    // Send connected event (what Twilio sends first)
    ws.send(JSON.stringify({ event: 'connected' }));
    
    // Send start event with wrong tenant ID
    setTimeout(() => {
      ws.send(JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'test-stream-sid',
          callSid: 'test-call-sid',
          mediaFormat: {
            encoding: 'mulaw',
            sampleRate: 8000,
            channels: 1
          },
          customParameters: {
            tenantId: 'f3760fe8-4491-4ab1-83dd-4069b1a2d688', // Wrong ID
            to: '+19194203058' // This should trigger fallback lookup
          }
        }
      }));
    }, 100);
  };
  
  ws.onmessage = (event) => {
    console.log('📨 Received message:', event.data);
  };
  
  ws.onclose = (event) => {
    console.log(`🔌 WebSocket closed: ${event.code} - ${event.reason}`);
  };
  
  ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
  };
  
  // Close after 5 seconds
  setTimeout(() => {
    if (connected) {
      console.log('⏰ Closing test connection...');
      ws.close();
    }
  }, 5000);
  
} catch (error) {
  console.error('❌ WebSocket test failed:', error);
}