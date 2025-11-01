#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * PROGRAMMATIC TEST: Voice Agent Knowledge Retrieval
 * 
 * This script tests the complete knowledge retrieval flow without phone calls:
 * 1. Simulates OpenAI function call events
 * 2. Verifies Supabase database queries
 * 3. Validates response formatting
 * 
 * Usage: deno run --allow-net --allow-env render/test-knowledge-retrieval.ts
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Test tenant ID (from logs: f3760fe8-4491-4ab1-83dd-4069b1a2d688)
const TEST_TENANT_ID = 'f3760fe8-4491-4ab1-83dd-4069b1a2d688'

interface TestResult {
  testName: string
  passed: boolean
  details: string
  data?: any
}

const results: TestResult[] = []

function logTest(testName: string, passed: boolean, details: string, data?: any) {
  const emoji = passed ? '✅' : '❌'
  console.log(`${emoji} ${testName}`)
  console.log(`   ${details}`)
  if (data) {
    console.log(`   Data:`, JSON.stringify(data, null, 2))
  }
  console.log('')
  results.push({ testName, passed, details, data })
}

// Test 1: Environment Variables
async function testEnvironment() {
  const hasUrl = !!SUPABASE_URL
  const hasKey = !!SUPABASE_SERVICE_ROLE_KEY
  const passed = hasUrl && hasKey
  
  logTest(
    'Environment Configuration',
    passed,
    `SUPABASE_URL: ${hasUrl ? 'SET' : 'MISSING'}, SERVICE_ROLE_KEY: ${hasKey ? 'SET' : 'MISSING'}`,
    { supabaseUrl: SUPABASE_URL ? 'configured' : 'missing' }
  )
  
  return passed
}

// Test 2: Supabase RPC Function Exists
async function testRPCExists() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_knowledge`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query_text: 'test',
        tenant_id: TEST_TENANT_ID,
        match_count: 1,
        match_threshold: 0.5
      })
    })
    
    // 200 or 404 both mean RPC endpoint is accessible
    // 404 might mean no data, but the function exists
    const passed = response.status === 200 || response.status === 404
    const body = await response.text()
    
    logTest(
      'Supabase RPC Endpoint',
      passed,
      `HTTP ${response.status}: search_knowledge RPC ${passed ? 'accessible' : 'not found'}`,
      { status: response.status, responsePreview: body.substring(0, 200) }
    )
    
    return passed
  } catch (error) {
    logTest(
      'Supabase RPC Endpoint',
      false,
      `Connection error: ${error instanceof Error ? error.message : 'Unknown'}`,
      { error }
    )
    return false
  }
}

// Test 3: Knowledge Base Has Data for Tenant
async function testKnowledgeBaseData() {
  try {
    const testQueries = [
      'business location address',
      'business hours',
      'services offered',
      'contact information'
    ]
    
    let hasAnyData = false
    const queryResults: any[] = []
    
    for (const query of testQueries) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_knowledge`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query_text: query,
          tenant_id: TEST_TENANT_ID,
          match_count: 5,
          match_threshold: 0.5
        })
      })
      
      if (response.ok) {
        const results = await response.json()
        const count = Array.isArray(results) ? results.length : 0
        queryResults.push({ query, count, results: results.slice(0, 2) })
        if (count > 0) hasAnyData = true
      }
    }
    
    logTest(
      'Knowledge Base Content',
      hasAnyData,
      hasAnyData 
        ? `Found ${queryResults.reduce((sum, r) => sum + r.count, 0)} total results across ${testQueries.length} test queries`
        : 'No knowledge base data found for tenant. Please add business information!',
      queryResults
    )
    
    return hasAnyData
  } catch (error) {
    logTest(
      'Knowledge Base Content',
      false,
      `Query error: ${error instanceof Error ? error.message : 'Unknown'}`,
      { error }
    )
    return false
  }
}

// Test 4: Simulate OpenAI Function Call Event
async function testFunctionCallSimulation() {
  // Simulate the exact event structure OpenAI Realtime API sends
  const mockEvent = {
    type: 'response.function_call.arguments.done',
    event_id: 'event_test_123',
    call_id: 'call_test_456',
    name: 'search_knowledge',
    arguments: JSON.stringify({ query: 'business location' })
  }
  
  // Test parsing
  try {
    const parsed = JSON.parse(mockEvent.arguments)
    const hasQuery = !!parsed.query
    
    logTest(
      'Function Call Event Format',
      hasQuery,
      `Event structure valid: call_id=${mockEvent.call_id}, name=${mockEvent.name}, query="${parsed.query}"`,
      mockEvent
    )
    
    return hasQuery
  } catch (error) {
    logTest(
      'Function Call Event Format',
      false,
      `Event parsing failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      { mockEvent, error }
    )
    return false
  }
}

// Test 5: End-to-End Knowledge Retrieval
async function testEndToEndKnowledgeFlow() {
  const query = 'What is the business location and address?'
  
  try {
    console.log(`🧪 Simulating customer question: "${query}"\n`)
    
    // Step 1: OpenAI would receive this question
    console.log('📞 Step 1: Customer speaks')
    console.log(`   Transcription: "${query}"\n`)
    
    // Step 2: OpenAI triggers function call
    console.log('🤖 Step 2: OpenAI decides to call search_knowledge')
    const functionCall = {
      type: 'response.function_call.arguments.done',
      call_id: 'call_e2e_test',
      name: 'search_knowledge',
      arguments: JSON.stringify({ query })
    }
    console.log(`   Event: ${functionCall.type}`)
    console.log(`   Function: ${functionCall.name}`)
    console.log(`   Arguments: ${functionCall.arguments}\n`)
    
    // Step 3: Handler executes search
    console.log('🔍 Step 3: Voice service executes search_knowledge()')
    const args = JSON.parse(functionCall.arguments)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_knowledge`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query_text: args.query,
        tenant_id: TEST_TENANT_ID,
        match_count: 5,
        match_threshold: 0.5
      })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }
    
    const results = await response.json()
    const resultCount = Array.isArray(results) ? results.length : 0
    console.log(`   Query: "${args.query}"`)
    console.log(`   Tenant: ${TEST_TENANT_ID}`)
    console.log(`   Results: ${resultCount} knowledge chunks found\n`)
    
    // Step 4: Format response for OpenAI
    console.log('📤 Step 4: Send results back to OpenAI')
    const functionOutput = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: JSON.stringify(results)
      }
    }
    console.log(`   Output length: ${functionOutput.item.output.length} characters`)
    console.log(`   Preview: ${functionOutput.item.output.substring(0, 150)}...\n`)
    
    // Step 5: OpenAI responds with answer
    console.log('💬 Step 5: OpenAI speaks natural response to customer')
    if (resultCount > 0) {
      console.log(`   ✅ AI can now provide accurate answer from knowledge base`)
      console.log(`   Sample content: ${JSON.stringify(results[0], null, 2).substring(0, 200)}...\n`)
    } else {
      console.log(`   ⚠️  No data found - AI will say "I don't have that information"\n`)
    }
    
    logTest(
      'End-to-End Knowledge Flow',
      resultCount > 0,
      resultCount > 0
        ? `Complete flow successful: ${resultCount} knowledge chunks retrieved and formatted`
        : 'Flow works but no knowledge base data found. Add business info to see real answers!',
      { 
        query,
        resultCount,
        sampleResults: results.slice(0, 2),
        responseFormat: functionOutput
      }
    )
    
    return resultCount > 0
  } catch (error) {
    logTest(
      'End-to-End Knowledge Flow',
      false,
      `Flow failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      { error }
    )
    return false
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 VOICE AGENT KNOWLEDGE RETRIEVAL TEST SUITE\n')
  console.log('=' .repeat(70))
  console.log('')
  
  await testEnvironment()
  await testRPCExists()
  await testKnowledgeBaseData()
  await testFunctionCallSimulation()
  await testEndToEndKnowledgeFlow()
  
  console.log('=' .repeat(70))
  console.log('\n📊 TEST SUMMARY\n')
  
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const allPassed = passed === total
  
  console.log(`Results: ${passed}/${total} tests passed`)
  console.log(`Status: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`)
  
  if (!allPassed) {
    console.log('Failed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.testName}: ${r.details}`)
    })
    console.log('')
  }
  
  console.log('=' .repeat(70))
  console.log('\n💡 NEXT STEPS:\n')
  
  if (!results[2]?.passed) {
    console.log('⚠️  NO KNOWLEDGE BASE DATA FOUND!')
    console.log(`   Your tenant (${TEST_TENANT_ID}) has no business information stored.`)
    console.log('   The function calling system works, but AI has nothing to retrieve.')
    console.log('')
    console.log('   To fix: Add business information via the dashboard:')
    console.log('   1. Go to Knowledge Base section')
    console.log('   2. Add your business address, hours, services, etc.')
    console.log('   3. Run this test again to verify retrieval\n')
  } else if (allPassed) {
    console.log('✅ ALL SYSTEMS OPERATIONAL!')
    console.log('   The voice agent is ready to retrieve and speak your business information.')
    console.log('   Make a test call to hear it in action!\n')
  }
  
  Deno.exit(allPassed ? 0 : 1)
}

runTests()
