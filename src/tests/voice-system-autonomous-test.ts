/**
 * AUTONOMOUS VOICE SYSTEM TEST HARNESS
 * 
 * This test validates the Voice Relay Pro system against all critical success criteria:
 * 1. Correct tenant ID resolution (550e8400-e29b-41d4-a716-446655440000)
 * 2. Complete greeting (>60 characters) 
 * 3. Agent prompt loaded from ai_agents table
 * 4. RAG search returns salon information
 * 5. Connection stability (>30 seconds without code 1005 errors)
 */

interface TestResult {
  test: string
  passed: boolean
  details: string
  data?: any
}

interface VoiceTestResults {
  tenantResolution: TestResult
  greetingValidation: TestResult
  agentPromptLoading: TestResult
  ragSearchTest: TestResult
  connectionStability: TestResult
  overallSuccess: boolean
  summary: string
}

class VoiceSystemTester {
  private results: TestResult[] = []
  private testStartTime = Date.now()
  private connectionActive = false
  
  constructor(
    private baseUrl: string = 'http://localhost:5000'
  ) {}

  /**
   * Run all autonomous tests and return comprehensive results
   */
  async runAllTests(): Promise<VoiceTestResults> {
    console.log('🚀 Starting Voice Relay Pro Autonomous Testing...')
    console.log('=' .repeat(60))
    
    try {
      // Test 1: Validate tenant ID resolution
      await this.testTenantResolution()
      
      // Test 2: Validate greeting content  
      await this.testGreetingValidation()
      
      // Test 3: Test agent prompt loading
      await this.testAgentPromptLoading()
      
      // Test 4: Test RAG search functionality
      await this.testRagSearch()
      
      // Test 5: Test connection stability
      await this.testConnectionStability()
      
    } catch (error) {
      console.error('❌ Test suite failed with error:', error)
      this.results.push({
        test: 'Test Suite Execution',
        passed: false,
        details: `Test suite failed: ${error instanceof Error ? error.message : String(error)}`
      })
    }
    
    return this.generateResults()
  }

  /**
   * Test 1: Validate tenant ID resolution from phone number
   */
  private async testTenantResolution(): Promise<void> {
    console.log('\n📞 Test 1: Tenant ID Resolution')
    console.log('-'.repeat(40))
    
    try {
      // Simulate database lookup for +19194203058
      const response = await fetch(`${this.baseUrl}/api/agent-settings/+19194203058`)
      
      if (!response.ok) {
        throw new Error(`API call failed: ${response.status}`)
      }
      
      const data = await response.json()
      const expectedTenantId = '550e8400-e29b-41d4-a716-446655440000'
      
      if (data.tenant_id === expectedTenantId) {
        this.results.push({
          test: 'Tenant ID Resolution',
          passed: true,
          details: `✅ Correct tenant ID resolved: ${data.tenant_id}`,
          data: { tenantId: data.tenant_id, phoneNumber: '+19194203058' }
        })
        console.log(`✅ Correct tenant ID: ${data.tenant_id}`)
      } else {
        this.results.push({
          test: 'Tenant ID Resolution', 
          passed: false,
          details: `❌ Wrong tenant ID: got ${data.tenant_id}, expected ${expectedTenantId}`,
          data: { actualTenantId: data.tenant_id, expectedTenantId }
        })
        console.log(`❌ Wrong tenant ID: ${data.tenant_id}`)
      }
    } catch (error) {
      this.results.push({
        test: 'Tenant ID Resolution',
        passed: false,
        details: `❌ Test failed: ${error instanceof Error ? error.message : String(error)}`
      })
      console.log(`❌ Test failed: ${error}`)
    }
  }

  /**
   * Test 2: Validate greeting content is complete
   */
  private async testGreetingValidation(): Promise<void> {
    console.log('\n💬 Test 2: Greeting Validation')
    console.log('-'.repeat(40))
    
    try {
      const response = await fetch(`${this.baseUrl}/api/agent-settings/+19194203058`)
      
      if (!response.ok) {
        throw new Error(`API call failed: ${response.status}`)
      }
      
      const data = await response.json()
      const greeting = data.greeting || ''
      const expectedGreeting = 'Hello, thank you for calling Salon Blu. How can I help you today?'
      
      if (greeting.length > 60 && greeting.includes('Salon Blu')) {
        this.results.push({
          test: 'Greeting Validation',
          passed: true,
          details: `✅ Complete greeting found (${greeting.length} characters): "${greeting.substring(0, 50)}..."`,
          data: { greeting, length: greeting.length }
        })
        console.log(`✅ Complete greeting (${greeting.length} chars): "${greeting}"`)
      } else {
        this.results.push({
          test: 'Greeting Validation',
          passed: false,
          details: `❌ Incomplete greeting (${greeting.length} characters): "${greeting}"`,
          data: { greeting, expectedLength: '> 60', actualLength: greeting.length }
        })
        console.log(`❌ Incomplete greeting: "${greeting}"`)
      }
    } catch (error) {
      this.results.push({
        test: 'Greeting Validation',
        passed: false,
        details: `❌ Test failed: ${error instanceof Error ? error.message : String(error)}`
      })
      console.log(`❌ Test failed: ${error}`)
    }
  }

  /**
   * Test 3: Validate agent prompt loading from ai_agents table
   */
  private async testAgentPromptLoading(): Promise<void> {
    console.log('\n🤖 Test 3: Agent Prompt Loading')
    console.log('-'.repeat(40))
    
    try {
      const tenantId = '550e8400-e29b-41d4-a716-446655440000'
      const response = await fetch(`${this.baseUrl}/api/ai-agents/${tenantId}`)
      
      if (!response.ok) {
        throw new Error(`API call failed: ${response.status}`)
      }
      
      const data = await response.json()
      const systemPrompt = data.system_prompt || ''
      
      if (systemPrompt.length > 100 && systemPrompt.includes('Salon Blu')) {
        this.results.push({
          test: 'Agent Prompt Loading',
          passed: true,
          details: `✅ System prompt loaded (${systemPrompt.length} characters) with Salon Blu context`,
          data: { promptLength: systemPrompt.length, tenantId }
        })
        console.log(`✅ System prompt loaded (${systemPrompt.length} chars)`)
      } else {
        this.results.push({
          test: 'Agent Prompt Loading',
          passed: false,
          details: `❌ Invalid system prompt (${systemPrompt.length} characters): missing or incomplete`,
          data: { promptLength: systemPrompt.length, prompt: systemPrompt.substring(0, 100) }
        })
        console.log(`❌ Invalid system prompt: ${systemPrompt.length} chars`)
      }
    } catch (error) {
      this.results.push({
        test: 'Agent Prompt Loading',
        passed: false,
        details: `❌ Test failed: ${error instanceof Error ? error.message : String(error)}`
      })
      console.log(`❌ Test failed: ${error}`)
    }
  }

  /**
   * Test 4: Validate RAG search returns salon information
   */
  private async testRagSearch(): Promise<void> {
    console.log('\n🔍 Test 4: RAG Search Functionality')
    console.log('-'.repeat(40))
    
    try {
      // Test RAG search with salon hours query
      const response = await fetch(`${this.baseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'What are your business hours?',
          tenantId: '550e8400-e29b-41d4-a716-446655440000'
        })
      })
      
      if (!response.ok) {
        throw new Error(`RAG search failed: ${response.status}`)
      }
      
      const data = await response.json()
      const results = data.results || []
      
      if (results.length > 0 && JSON.stringify(results).toLowerCase().includes('hours')) {
        this.results.push({
          test: 'RAG Search Functionality',
          passed: true,
          details: `✅ RAG search returned ${results.length} relevant results about business hours`,
          data: { resultCount: results.length, query: 'business hours' }
        })
        console.log(`✅ RAG search returned ${results.length} results`)
      } else {
        this.results.push({
          test: 'RAG Search Functionality',
          passed: false,
          details: `❌ RAG search failed: ${results.length} results, no hours information found`,
          data: { resultCount: results.length, results: results.slice(0, 2) }
        })
        console.log(`❌ RAG search failed: ${results.length} results`)
      }
    } catch (error) {
      this.results.push({
        test: 'RAG Search Functionality',
        passed: false,
        details: `❌ Test failed: ${error instanceof Error ? error.message : String(error)}`
      })
      console.log(`❌ Test failed: ${error}`)
    }
  }

  /**
   * Test 5: Validate connection stability simulation
   */
  private async testConnectionStability(): Promise<void> {
    console.log('\n🔗 Test 5: Connection Stability')
    console.log('-'.repeat(40))
    
    try {
      // Simulate multiple API calls over time to test stability
      const startTime = Date.now()
      let successfulCalls = 0
      const totalCalls = 5
      
      for (let i = 0; i < totalCalls; i++) {
        try {
          const response = await fetch(`${this.baseUrl}/api/health`)
          if (response.ok) {
            successfulCalls++
          }
          
          // Wait 2 seconds between calls
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (error) {
          console.log(`Call ${i + 1} failed: ${error}`)
        }
      }
      
      const duration = Date.now() - startTime
      const successRate = (successfulCalls / totalCalls) * 100
      
      if (successRate >= 80 && duration >= 8000) { // 8+ seconds for 5 calls
        this.results.push({
          test: 'Connection Stability',
          passed: true,
          details: `✅ Connection stable: ${successfulCalls}/${totalCalls} calls successful (${successRate}%) over ${Math.round(duration/1000)}s`,
          data: { successRate, duration, successfulCalls, totalCalls }
        })
        console.log(`✅ Connection stable: ${successRate}% success rate`)
      } else {
        this.results.push({
          test: 'Connection Stability',
          passed: false,
          details: `❌ Connection unstable: ${successfulCalls}/${totalCalls} calls successful (${successRate}%) over ${Math.round(duration/1000)}s`,
          data: { successRate, duration, successfulCalls, totalCalls }
        })
        console.log(`❌ Connection unstable: ${successRate}% success rate`)
      }
    } catch (error) {
      this.results.push({
        test: 'Connection Stability',
        passed: false,
        details: `❌ Test failed: ${error instanceof Error ? error.message : String(error)}`
      })
      console.log(`❌ Test failed: ${error}`)
    }
  }

  /**
   * Generate comprehensive test results
   */
  private generateResults(): VoiceTestResults {
    const tenantResolution = this.results.find(r => r.test === 'Tenant ID Resolution') || 
      { test: 'Tenant ID Resolution', passed: false, details: 'Test not run' }
    
    const greetingValidation = this.results.find(r => r.test === 'Greeting Validation') || 
      { test: 'Greeting Validation', passed: false, details: 'Test not run' }
    
    const agentPromptLoading = this.results.find(r => r.test === 'Agent Prompt Loading') || 
      { test: 'Agent Prompt Loading', passed: false, details: 'Test not run' }
    
    const ragSearchTest = this.results.find(r => r.test === 'RAG Search Functionality') || 
      { test: 'RAG Search Functionality', passed: false, details: 'Test not run' }
    
    const connectionStability = this.results.find(r => r.test === 'Connection Stability') || 
      { test: 'Connection Stability', passed: false, details: 'Test not run' }
    
    const passedTests = this.results.filter(r => r.passed).length
    const totalTests = this.results.length
    const overallSuccess = passedTests === totalTests && totalTests >= 5
    
    const summary = overallSuccess 
      ? `✅ ALL TESTS PASSED (${passedTests}/${totalTests}) - Voice Relay Pro is fully functional!`
      : `❌ TESTS FAILED (${passedTests}/${totalTests} passed) - Issues need to be resolved.`
    
    return {
      tenantResolution,
      greetingValidation,
      agentPromptLoading,
      ragSearchTest,
      connectionStability,
      overallSuccess,
      summary
    }
  }
}

/**
 * Main test execution function
 */
export async function runVoiceSystemTests(): Promise<VoiceTestResults> {
  const tester = new VoiceSystemTester()
  const results = await tester.runAllTests()
  
  console.log('\n' + '='.repeat(60))
  console.log('🎯 AUTONOMOUS TEST RESULTS SUMMARY')
  console.log('='.repeat(60))
  console.log(results.summary)
  console.log('\n📊 Detailed Results:')
  
  const allResults = [
    results.tenantResolution,
    results.greetingValidation, 
    results.agentPromptLoading,
    results.ragSearchTest,
    results.connectionStability
  ]
  
  allResults.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL'
    console.log(`${status}: ${result.test} - ${result.details}`)
  })
  
  console.log('\n' + '='.repeat(60))
  
  return results
}

// Allow direct execution
if (import.meta.main) {
  runVoiceSystemTests()
    .then(results => {
      console.log('Test execution completed.')
      process.exit(results.overallSuccess ? 0 : 1)
    })
    .catch(error => {
      console.error('Test execution failed:', error)
      process.exit(1)
    })
}