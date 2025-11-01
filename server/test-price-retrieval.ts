#!/usr/bin/env node

/**
 * Test Price Retrieval Specifically
 * 
 * This tests different ways users might ask about pricing to see
 * which queries return results and which don't.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_TENANT_ID = 'f3760fe8-4491-4ab1-83dd-4069b1a2d688'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables!')
  console.error('   SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'MISSING')
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
  process.exit(1)
}

console.log('🧪 TESTING PRICE RETRIEVAL')
console.log('=' .repeat(70))
console.log()

const priceQueries = [
  'prices',
  'price',
  'pricing',
  'cost',
  'costs',
  'how much',
  'how much does a haircut cost',
  'what are your prices',
  'haircut price',
  'women haircut price',
  'men haircut cost',
  'coloring price',
  'how much is a haircut'
]

async function testPriceQuery(query: string) {
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
        query: query,
        k: 5,
        min_score: 0.3
      })
    })

    if (!response.ok) {
      return {
        query,
        error: `HTTP ${response.status}`,
        resultCount: 0,
        results: []
      }
    }

    const data = await response.json()
    const results = data.results || []
    
    return {
      query,
      resultCount: results.length,
      searchType: data.search_type,
      queryIntent: data.query_intent,
      results: results.map((r: any) => ({
        content: r.content?.substring(0, 100) + '...',
        score: r.score,
        relevanceType: r.relevance_type
      }))
    }
  } catch (error) {
    return {
      query,
      error: error instanceof Error ? error.message : 'Unknown error',
      resultCount: 0,
      results: []
    }
  }
}

async function runTests() {
  console.log(`Testing ${priceQueries.length} different price-related queries...\n`)
  
  const results = []
  
  for (const query of priceQueries) {
    process.stdout.write(`🔍 "${query}"... `)
    const result = await testPriceQuery(query)
    
    if (result.error) {
      console.log(`❌ ERROR: ${result.error}`)
    } else if (result.resultCount === 0) {
      console.log(`⚠️  0 results (intent: ${result.queryIntent})`)
    } else {
      console.log(`✅ ${result.resultCount} results (score: ${result.results[0]?.score})`)
    }
    
    results.push(result)
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log()
  console.log('=' .repeat(70))
  console.log('📊 DETAILED RESULTS')
  console.log('=' .repeat(70))
  console.log()
  
  // Show successful queries
  const successful = results.filter(r => r.resultCount > 0)
  const failed = results.filter(r => r.resultCount === 0)
  
  if (successful.length > 0) {
    console.log(`✅ SUCCESSFUL QUERIES (${successful.length}/${results.length}):\n`)
    successful.forEach(r => {
      console.log(`   Query: "${r.query}"`)
      console.log(`   Results: ${r.resultCount}`)
      console.log(`   Intent: ${r.queryIntent}`)
      console.log(`   Search Type: ${r.searchType}`)
      if (r.results.length > 0) {
        console.log(`   Top Result: ${r.results[0].content}`)
        console.log(`   Score: ${r.results[0].score}`)
        console.log(`   Relevance: ${r.results[0].relevanceType}`)
      }
      console.log()
    })
  }
  
  if (failed.length > 0) {
    console.log(`❌ FAILED QUERIES (${failed.length}/${results.length}):\n`)
    failed.forEach(r => {
      console.log(`   Query: "${r.query}"`)
      console.log(`   Error: ${r.error || 'No results found'}`)
      console.log(`   Intent: ${r.queryIntent || 'unknown'}`)
      console.log()
    })
  }
  
  // Summary
  console.log('=' .repeat(70))
  console.log('📈 SUMMARY')
  console.log('=' .repeat(70))
  console.log()
  console.log(`Total queries tested: ${results.length}`)
  console.log(`Successful: ${successful.length} (${Math.round(successful.length / results.length * 100)}%)`)
  console.log(`Failed: ${failed.length} (${Math.round(failed.length / results.length * 100)}%)`)
  console.log()
  
  if (successful.length === 0) {
    console.log('⚠️  WARNING: NO PRICE QUERIES RETURNED RESULTS!')
    console.log('   This means the pricing data is either:')
    console.log('   1. Not in the database')
    console.log('   2. Has incorrect embeddings')
    console.log('   3. Score threshold is too high')
    console.log()
    console.log('   Run: npx tsx server/add-sample-knowledge.ts')
    console.log('   To re-populate the knowledge base with pricing data.')
  } else {
    console.log('✅ Price retrieval is working!')
    console.log()
    console.log('💡 RECOMMENDATION:')
    console.log('   Successful query patterns:')
    successful.slice(0, 3).forEach(r => {
      console.log(`   - "${r.query}"`)
    })
    console.log()
    console.log('   If live calls still fail, the AI might be using different')
    console.log('   phrasing. Check Render.com logs for the exact query being sent.')
  }
}

runTests().catch(console.error)
