#!/usr/bin/env node

// Direct Supabase Edge Function log retrieval using service role key
// Uses Supabase service role key from environment to access logs

const https = require('https');
const fs = require('fs');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://gnqqktmslswgjtvxfvdo.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const PROJECT_REF = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY not found in environment');
  console.log('Please set it in your .env file or export it:');
  console.log('export SUPABASE_SERVICE_ROLE_KEY="your-service-key"');
  process.exit(1);
}

// Helper to make HTTPS requests
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Function to query logs from edge_logs table
async function fetchEdgeLogs(functionName = null, limit = 100) {
  try {
    // Query the edge_logs table directly
    let url = `${SUPABASE_URL}/rest/v1/edge_logs?select=*&order=timestamp.desc&limit=${limit}`;
    
    if (functionName) {
      url += `&function_name=eq.${functionName}`;
    }
    
    const logs = await httpsRequest(url);
    return logs;
  } catch (error) {
    console.log('edge_logs table not available, trying alternative method...');
    
    // Alternative: Try to get logs via RPC function if available
    try {
      const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/get_edge_logs`;
      const logs = await httpsRequest(rpcUrl, {
        method: 'POST',
        body: JSON.stringify({ 
          function_name: functionName,
          limit: limit 
        })
      });
      return logs;
    } catch (rpcError) {
      // If both fail, return empty
      return [];
    }
  }
}

// Function to fetch logs directly from function invocation
async function invokeDebugLogger(functionName) {
  try {
    const url = `${SUPABASE_URL}/functions/v1/debug-logger?function=${functionName}&limit=200`;
    const response = await httpsRequest(url, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response;
  } catch (error) {
    console.log('Debug logger function not available:', error.message);
    return null;
  }
}

// Display logs in a formatted way
function displayLogs(logs) {
  if (!logs || logs.length === 0) {
    console.log('\nNo logs found.\n');
    console.log('Possible reasons:');
    console.log('1. Edge functions not deployed yet');
    console.log('2. No recent function invocations');
    console.log('3. Logs may take a moment to appear after invocation');
    return;
  }
  
  console.log(`\n📋 Found ${logs.length} log entries:\n`);
  console.log('='.repeat(80));
  
  // Group logs by session/call
  const sessions = {};
  
  logs.forEach((log) => {
    // Parse log entry
    const timestamp = log.timestamp || log.created_at || log.time || new Date().toISOString();
    const time = new Date(timestamp);
    const timeStr = time.toLocaleTimeString();
    const level = log.level || log.severity || 'INFO';
    const message = log.message || log.msg || '';
    const fnName = log.function_name || log.function || 'unknown';
    
    // Extract session ID from message if available
    let sessionId = 'default';
    if (message.includes('streamSid:')) {
      const match = message.match(/streamSid:\s*([A-Z0-9]+)/);
      if (match) sessionId = match[1];
    } else if (message.includes('Call from')) {
      sessionId = timeStr; // Use time as session ID for new calls
    }
    
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }
    
    sessions[sessionId].push({
      time: timeStr,
      timestamp: time,
      level,
      message,
      function: fnName,
      data: log.metadata || log.data || log.context
    });
  });
  
  // Display logs grouped by session
  Object.entries(sessions).forEach(([sessionId, sessionLogs]) => {
    // Sort logs by timestamp within each session
    sessionLogs.sort((a, b) => a.timestamp - b.timestamp);
    
    const firstLog = sessionLogs[0];
    const lastLog = sessionLogs[sessionLogs.length - 1];
    
    console.log('\n' + '━'.repeat(80));
    console.log(`📞 Session: ${sessionId}`);
    console.log(`⏰ Duration: ${firstLog.time} - ${lastLog.time}`);
    console.log('━'.repeat(80));
    
    sessionLogs.forEach((log) => {
      // Color code by level
      let levelIcon = '•';
      let levelColor = '';
      
      if (log.level === 'ERROR' || log.level === 'error') {
        levelIcon = '❌';
        levelColor = '\x1b[31m'; // Red
      } else if (log.level === 'WARN' || log.level === 'warning') {
        levelIcon = '⚠️ ';
        levelColor = '\x1b[33m'; // Yellow
      } else if (log.level === 'DEBUG' || log.level === 'debug') {
        levelIcon = '🔍';
        levelColor = '\x1b[36m'; // Cyan
      } else if (log.message.includes('WebSocket')) {
        levelIcon = '🔌';
        levelColor = '\x1b[35m'; // Magenta
      } else if (log.message.includes('audio') || log.message.includes('Audio')) {
        levelIcon = '🔊';
        levelColor = '\x1b[34m'; // Blue
      } else {
        levelIcon = '✓';
        levelColor = '\x1b[32m'; // Green
      }
      
      console.log(`${levelIcon} [${log.time}] ${levelColor}${log.message}\x1b[0m`);
      
      // Show data if present
      if (log.data) {
        const dataStr = JSON.stringify(log.data, null, 2);
        const lines = dataStr.split('\n');
        lines.forEach(line => console.log('    ' + line));
      }
      
      // Highlight important patterns
      if (log.message.includes('static') || log.message.includes('noise')) {
        console.log('    🚨 AUDIO QUALITY ISSUE DETECTED');
      }
      if (log.message.includes('codec') || log.message.includes('format')) {
        console.log('    🎵 CODEC/FORMAT RELATED');
      }
      if (log.message.includes('Error') || log.message.includes('error')) {
        console.log('    💥 ERROR CONDITION');
      }
    });
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(`📊 Summary: ${logs.length} total logs across ${Object.keys(sessions).length} sessions`);
  
  // Count by level
  const levelCounts = {};
  logs.forEach(log => {
    const level = log.level || log.severity || 'INFO';
    levelCounts[level] = (levelCounts[level] || 0) + 1;
  });
  
  console.log('📈 Log levels:', Object.entries(levelCounts).map(([l, c]) => `${l}: ${c}`).join(', '));
  
  // Save to file for detailed analysis
  const filename = `edge-logs-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(logs, null, 2));
  console.log(`\n💾 Full logs saved to: ${filename}`);
}

// Main execution
async function main() {
  const functionName = process.argv[2] || 'twilio-voice-stream';
  const showAll = process.argv.includes('--all');
  
  console.log('🔍 Fetching Supabase Edge Function logs...');
  console.log(`📦 Project: ${PROJECT_REF}`);
  console.log(`⚡ Function: ${functionName || 'all'}\n`);
  
  try {
    // Try multiple methods to get logs
    let logs = null;
    
    // Method 1: Direct edge_logs table query
    console.log('Attempting method 1: Direct database query...');
    logs = await fetchEdgeLogs(showAll ? null : functionName, 200);
    
    if (!logs || logs.length === 0) {
      // Method 2: Debug logger function
      console.log('Attempting method 2: Debug logger function...');
      const debugResult = await invokeDebugLogger(functionName);
      if (debugResult && debugResult.logs) {
        logs = debugResult.logs;
      }
    }
    
    if (!logs || logs.length === 0) {
      console.log('\n⚠️  No logs retrieved. Checking function status...\n');
      
      // Try to invoke the function to check if it's deployed
      try {
        const testUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;
        await httpsRequest(testUrl, { method: 'OPTIONS' });
        console.log(`✅ Function "${functionName}" is deployed and responding`);
        console.log('📝 But no recent logs found. Try making a test call.');
      } catch (e) {
        console.log(`❌ Function "${functionName}" may not be deployed`);
        console.log('📌 Deploy it with: supabase functions deploy ' + functionName);
      }
    } else {
      displayLogs(logs);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Check SUPABASE_SERVICE_ROLE_KEY is set correctly');
    console.log('2. Verify function is deployed: supabase functions deploy ' + functionName);
    console.log('3. Make a test call to generate logs');
    console.log('4. Wait a few seconds for logs to propagate');
  }
}

// Watch mode
if (process.argv.includes('--watch')) {
  console.log('👁️  Watch mode enabled - refreshing every 5 seconds\n');
  setInterval(main, 5000);
} else {
  main();
}