import { db } from './db.js'
import { agent_settings, ai_agents, knowledge_chunks } from './db/schema.js'
import { eq } from 'drizzle-orm'

export interface IStorage {
  getAgentSettingsByPhone(phoneNumber: string): Promise<any>
  getAIAgentByTenantId(tenantId: string): Promise<any>
  searchKnowledge(query: string, tenantId: string): Promise<any[]>
}

export class DatabaseStorage implements IStorage {
  
  async getAgentSettingsByPhone(phoneNumber: string) {
    try {
      const result = await db
        .select()
        .from(agent_settings)
        .where(eq(agent_settings.twilio_number, phoneNumber))
        .limit(1)
      
      return result[0] || null
    } catch (error) {
      console.error('Error fetching agent settings by phone:', error)
      throw error
    }
  }

  async getAIAgentByTenantId(tenantId: string) {
    try {
      const result = await db
        .select()
        .from(ai_agents)
        .where(eq(ai_agents.tenant_id, tenantId))
        .limit(1)
      
      return result[0] || null
    } catch (error) {
      console.error('Error fetching AI agent by tenant ID:', error)
      throw error
    }
  }

  async searchKnowledge(query: string, tenantId: string): Promise<any[]> {
    try {
      // Simple search in knowledge chunks for testing
      // In production this would use vector similarity search
      const results = await db
        .select()
        .from(knowledge_chunks)
        .where(eq(knowledge_chunks.tenant_id, tenantId))
        .limit(10)
      
      // Filter results that contain query terms (simple text matching)
      const queryWords = query.toLowerCase().split(' ')
      const filteredResults = results.filter(chunk => {
        const content = chunk.content.toLowerCase()
        return queryWords.some(word => content.includes(word))
      })
      
      return filteredResults
    } catch (error) {
      console.error('Error searching knowledge:', error)
      throw error
    }
  }
}