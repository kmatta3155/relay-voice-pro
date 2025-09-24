#!/usr/bin/env node

// Script to retrieve and display edge function logs for debugging
// Run with: node check-edge-logs.js

const https = require('https');

const FUNCTION_NAME = 'twilio-voice-stream';
const LOG_LIMIT = 200;

function fetchLogs() {
  const options = {
    hostname: 'gnqqktmslswgjtvxfvdo.supabase.co',
    path: `/functions/v1/debug-logger?function=${FUNCTION_NAME}&limit=${LOG_LIMIT}`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.end();
  });
}

async function displayLogs() {
  try {
    console.log('Fetching edge function logs...\n');
    const result = await fetchLogs();
    
    if (result.logs && result.logs.length > 0) {
      console.log(`Found ${result.logs.length} log entries:\n`);
      console.log('=' .repeat(80));
      
      // Group logs by timestamp
      let currentCall = null;
      
      result.logs.forEach((log) => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        
        // Detect new call session
        if (log.message && log.message.includes('WebSocket connection established')) {
          console.log('\n' + '='.repeat(80));
          console.log(`NEW CALL SESSION at ${time}`);
          console.log('='.repeat(80));
          currentCall = time;
        }
        
        // Format log level with color codes
        let levelStr = log.level;
        if (log.level === 'ERROR') {
          levelStr = '\x1b[31m' + log.level + '\x1b[0m'; // Red
        } else if (log.level === 'WARN') {
          levelStr = '\x1b[33m' + log.level + '\x1b[0m'; // Yellow
        } else if (log.level === 'DEBUG') {
          levelStr = '\x1b[36m' + log.level + '\x1b[0m'; // Cyan
        } else {
          levelStr = '\x1b[32m' + log.level + '\x1b[0m'; // Green
        }
        
        console.log(`[${time}] [${levelStr}] ${log.message}`);
        
        if (log.data) {
          // Pretty print data with indentation
          const dataStr = JSON.stringify(log.data, null, 2);
          const indented = dataStr.split('\n').map(line => '  ' + line).join('\n');
          console.log(indented);
        }
        
        // Highlight critical information
        if (log.message.includes('CODEC') || log.message.includes('codec')) {
          console.log('  ⚠️  CODEC DETECTION');
        }
        if (log.message.includes('hex') || log.message.includes('Hex')) {
          console.log('  🔍 BINARY DATA');
        }
        if (log.message.includes('static') || log.message.includes('noise')) {
          console.log('  🔊 AUDIO ISSUE');
        }
      });
      
      console.log('\n' + '='.repeat(80));
      console.log(`Total logs: ${result.totalCount}`);
      
      // Save to file for analysis
      const fs = require('fs');
      const filename = `edge-logs-${Date.now()}.json`;
      fs.writeFileSync(filename, JSON.stringify(result.logs, null, 2));
      console.log(`\nLogs saved to: ${filename}`);
      
    } else {
      console.log('No logs found. Make sure to:');
      console.log('1. Deploy the debug-logger function to Supabase');
      console.log('2. Deploy the updated twilio-voice-stream function');
      console.log('3. Make a test call to generate logs');
    }
  } catch (error) {
    console.error('Error fetching logs:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure debug-logger function is deployed');
    console.log('2. Check if the Supabase project URL is correct');
  }
}

// Auto-refresh mode
if (process.argv.includes('--watch')) {
  console.log('Running in watch mode - refreshing every 5 seconds...\n');
  setInterval(displayLogs, 5000);
} else {
  displayLogs();
}