#!/usr/bin/env node

// Simple log checker that calls your deployed functions to get their status
const https = require('https');
const fs = require('fs');

const SUPABASE_URL = 'https://gnqqktmslswgjtvxfvdo.supabase.co';

// Helper to make HTTPS requests
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function checkFunctionStatus() {
  console.log('🔍 Checking Supabase Edge Function Status\n');
  console.log('=' .repeat(80));
  
  const functions = [
    'twilio-router',
    'twilio-voice-stream',
    'twilio-voice-stream-minimal',
    'debug-logger'
  ];
  
  for (const fn of functions) {
    console.log(`\n📦 Function: ${fn}`);
    console.log('-'.repeat(40));
    
    try {
      const url = `${SUPABASE_URL}/functions/v1/${fn}`;
      const response = await httpsRequest(url, { method: 'OPTIONS' });
      
      if (response.status === 200 || response.status === 204) {
        console.log('✅ Status: DEPLOYED and RESPONDING');
        console.log(`   Endpoint: ${url}`);
        
        // Try to get version/deployment info
        if (response.headers['x-deployment-id']) {
          console.log(`   Deployment ID: ${response.headers['x-deployment-id']}`);
        }
        if (response.headers['x-deployed-at']) {
          console.log(`   Deployed: ${response.headers['x-deployed-at']}`);
        }
      } else if (response.status === 404) {
        console.log('❌ Status: NOT DEPLOYED');
        console.log(`   Deploy with: supabase functions deploy ${fn}`);
      } else {
        console.log(`⚠️  Status: UNKNOWN (HTTP ${response.status})`);
      }
    } catch (error) {
      console.log('❌ Status: ERROR');
      console.log(`   ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 Log Retrieval Instructions:\n');
  console.log('Since Supabase CLI logging is not available in this version, you can:');
  console.log('\n1. View logs in the Supabase Dashboard:');
  console.log('   https://supabase.com/dashboard/project/gnqqktmslswgjtvxfvdo/functions');
  console.log('\n2. Deploy functions with verbose output:');
  console.log('   supabase functions deploy <function-name> --debug');
  console.log('\n3. Add console.log statements in your functions and redeploy');
  console.log('\n4. Use the Supabase Management API with an access token:');
  console.log('   • Get token from: https://supabase.com/dashboard/account/tokens');
  console.log('   • Then use: node fetch-supabase-logs.cjs');
}

checkFunctionStatus();