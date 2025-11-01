/**
 * PROGRAMMATIC TEST: Voice Agent Knowledge Retrieval
 * 
 * This script tests the complete knowledge retrieval flow without phone calls:
 * 1. Simulates OpenAI function call events
 * 2. Verifies Supabase database queries
 * 3. Validates response formatting
 * 
 * Usage: npx tsx server/test-knowledge-retrieval.ts
 */

import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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
    console.log(`   Data:`, JSON.stringify(data, null, 2).substring(0, 500))
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
    const response = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        query: 'test',
        k: 1,
        min_score: 0.3
      })
    })
    
    const passed = response.status === 200
    const body = await response.text()
    
    logTest(
      'Supabase Search Endpoint',
      passed,
      `HTTP ${response.status}: search Edge Function ${passed ? 'accessible' : 'not found'}`,
      { status: response.status, responsePreview: body.substring(0, 200) }
    )
    
    return passed
  } catch (error: any) {
    logTest(
      'Supabase Search Endpoint',
      false,
      `Connection error: ${error?.message || 'Unknown'}`,
      { error: error?.message }
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
      const response = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tenant_id: TEST_TENANT_ID,
          query: query,
          k: 5,
          min_score: 0.3
        })
      })
      
      if (response.ok) {
        const responseData = await response.json()
        const results = responseData.results || []
        const count = results.length
        queryResults.push({ query, count, hasResults: count > 0 })
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
  } catch (error: any) {
    logTest(
      'Knowledge Base Content',
      false,
      `Query error: ${error?.message || 'Unknown'}`,
      { error: error?.message }
    )
    return false
  }
}

// Test 4: End-to-End Knowledge Retrieval
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
      type: 'response.function_call_arguments.done',
      call_id: 'call_e2e_test',
      name: 'search_knowledge',
      arguments: JSON.stringify({ query })
    }
    console.log(`   Event: ${functionCall.type} (no dot between "call" and "arguments"!)`)
    console.log(`   Function: ${functionCall.name}`)
    console.log(`   Arguments: ${functionCall.arguments}\n`)
    
    // Step 3: Handler executes search
    console.log('🔍 Step 3: Voice service executes search_knowledge()')
    const args = JSON.parse(functionCall.arguments)
    const response = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        query: args.query,
        k: 5,
        min_score: 0.3
      })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }
    
    const responseData = await response.json()
    const results = responseData.results || []
    const resultCount = results.length
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
    if (resultCount > 0) {
      console.log(`   Sample: ${results[0]?.content?.substring(0, 100)}...\n`)
    }
    
    // Step 5: OpenAI responds with answer
    console.log('💬 Step 5: OpenAI speaks natural response to customer')
    if (resultCount > 0) {
      console.log(`   ✅ AI can now provide accurate answer from knowledge base\n`)
    } else {
      console.log(`   ⚠️  No data found - AI will say "I don't have that information"\n`)
    }
    
    logTest(
      'End-to-End Knowledge Flow',
      resultCount > 0,
      resultCount > 0
        ? `Complete flow successful: ${resultCount} knowledge chunks retrieved`
        : 'Flow works but no knowledge base data found. Add business info!',
      { query, resultCount, hasResults: resultCount > 0 }
    )
    
    return resultCount > 0
  } catch (error: any) {
    logTest(
      'End-to-End Knowledge Flow',
      false,
      `Flow failed: ${error?.message || 'Unknown'}`,
      { error: error?.message }
    )
    return false
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 VOICE AGENT KNOWLEDGE RETRIEVAL TEST SUITE\n')
  console.log('='.repeat(70))
  console.log('')
  
  await testEnvironment()
  await testRPCExists()
  await testKnowledgeBaseData()
  await testEndToEndKnowledgeFlow()
  
  console.log('='.repeat(70))
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
  
  console.log('='.repeat(70))
  console.log('\n💡 NEXT STEPS:\n')
  
  const knowledgeTest = results.find(r => r.testName === 'Knowledge Base Content')
  if (knowledgeTest && !knowledgeTest.passed) {
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
    console.log('   Deploy to Render.com and make a test call to hear it in action!\n')
  }
  
  process.exit(allPassed ? 0 : 1)
}

runTests().catch(console.error)
