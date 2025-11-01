/**
 * Add Sample Business Knowledge to Database
 * 
 * This script adds basic business information to your knowledge base
 * so the AI voice agent can retrieve and speak accurate answers.
 * 
 * Usage: npx tsx server/add-sample-knowledge.ts
 */

import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TENANT_ID = 'f3760fe8-4491-4ab1-83dd-4069b1a2d688'

// REAL business information - Updated with actual pricing from your services menu!
const businessInfo = [
  {
    title: "Services and Pricing - Complete Price List",
    content: `Our pricing and costs for hair services: Ladies Haircut costs $53 for 30 minutes. Gentlemen Haircut is $37 for 30 minutes. Blowout (shampoo and blowout styling) costs $50 for 30 minutes. Brazilian Blowout (texture treatment for hair) is $351 for 30 minutes. Root Color treatment costs $53 for 30 minutes. Single Process Color (single process hair color) is $85 for 30 minutes. Partial Highlights (partial highlight for hair) cost $68 for 30 minutes. Balayage Full Head (full head balayage treatment) costs $151 for 30 minutes. If you're wondering how much any service costs or what our rates and fees are, these are our exact prices. All services are 30 minutes.`
  }
]

async function generateEmbedding(text: string): Promise<number[]> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
  
  if (!OPENAI_API_KEY) {
    console.log('⚠️  OpenAI API key not found - will store without embeddings')
    return []
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    })
    
    if (!response.ok) {
      console.log(`⚠️  Embedding generation failed: ${response.status}`)
      return []
    }
    
    const data = await response.json()
    return data.data[0].embedding
  } catch (error) {
    console.log(`⚠️  Embedding error: ${error}`)
    return []
  }
}

async function createKnowledgeSource(title: string): Promise<string | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_sources`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        source_type: 'manual',
        title,
        meta: { created_by: 'setup_script', type: 'business_info' }
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.log(`❌ Failed to create source: ${response.status} - ${error}`)
      return null
    }
    
    const data = await response.json()
    return data[0]?.id || null
  } catch (error: any) {
    console.log(`❌ Source creation error: ${error?.message}`)
    return null
  }
}

async function addKnowledgeChunk(sourceId: string, content: string, title: string) {
  try {
    console.log(`\n📝 Adding: ${title}`)
    console.log(`   Content: ${content.substring(0, 100)}...`)
    
    // Generate embedding
    console.log('   🔄 Generating embedding...')
    const embedding = await generateEmbedding(content)
    
    // Calculate token count (rough estimate: ~4 chars per token)
    const tokenCount = Math.ceil(content.length / 4)
    
    // Insert chunk
    const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        source_id: sourceId,
        content,
        token_count: tokenCount,
        embedding: embedding.length > 0 ? embedding : null,  // FIXED: Send as array, not JSON string
        meta: { title, type: 'business_info' }
      })
    })
    
    if (response.ok) {
      console.log(`   ✅ Added successfully (${tokenCount} tokens, ${embedding.length > 0 ? 'with' : 'NO'} embedding)`)
      return true
    } else {
      const error = await response.text()
      console.log(`   ❌ Failed: ${response.status} - ${error}`)
      return false
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error?.message}`)
    return false
  }
}

async function main() {
  console.log('🚀 ADDING SAMPLE BUSINESS KNOWLEDGE\n')
  console.log('='.repeat(70))
  console.log('')
  
  // Verify environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('❌ Missing environment variables!')
    console.log('   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  
  console.log(`📍 Tenant ID: ${TENANT_ID}`)
  console.log(`📦 Adding ${businessInfo.length} knowledge chunks`)
  console.log('')
  
  // Create knowledge source
  console.log('📋 Creating knowledge source...')
  const sourceId = await createKnowledgeSource('Salon Blu Business Information')
  
  if (!sourceId) {
    console.log('❌ Failed to create knowledge source!')
    process.exit(1)
  }
  
  console.log(`✅ Source created: ${sourceId}`)
  
  // Add all knowledge chunks
  let successCount = 0
  for (const info of businessInfo) {
    const success = await addKnowledgeChunk(sourceId, info.content, info.title)
    if (success) successCount++
  }
  
  console.log('')
  console.log('='.repeat(70))
  console.log('\n📊 RESULTS\n')
  console.log(`✅ Successfully added: ${successCount}/${businessInfo.length} chunks`)
  console.log('')
  
  if (successCount === businessInfo.length) {
    console.log('🎉 SUCCESS! Your knowledge base is now populated.')
    console.log('')
    console.log('Next steps:')
    console.log('1. Deploy the fix to Render.com (see render/DEPLOY_KNOWLEDGE_FIX.md)')
    console.log('2. Run: npx tsx server/test-knowledge-retrieval.ts')
    console.log('3. Make a test phone call to verify AI retrieves information')
    console.log('')
  } else {
    console.log('⚠️  Some chunks failed to add. Check errors above.')
    console.log('')
  }
  
  console.log('💡 TIP: Customize the business information in server/add-sample-knowledge.ts')
  console.log('   with your actual business details before running this script!')
  console.log('')
}

main().catch(console.error)
