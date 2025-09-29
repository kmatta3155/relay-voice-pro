import { Router } from 'express'
import { z } from 'zod'
import type { IStorage } from './storage.js'

export function createRoutes(storage: IStorage) {
  const router = Router()

  // Health check endpoint for testing
  router.get('/health', async (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Get agent settings by phone number (for testing tenant resolution)
  router.get('/agent-settings/:phoneNumber', async (req, res) => {
    try {
      const { phoneNumber } = req.params
      
      // Query agent_settings table
      const agentSettings = await storage.getAgentSettingsByPhone(phoneNumber)
      
      if (!agentSettings) {
        return res.status(404).json({ error: 'Agent settings not found for phone number' })
      }
      
      res.json(agentSettings)
    } catch (error) {
      console.error('Error fetching agent settings:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get AI agent by tenant ID (for testing agent prompt loading)
  router.get('/ai-agents/:tenantId', async (req, res) => {
    try {
      const { tenantId } = req.params
      
      const agent = await storage.getAIAgentByTenantId(tenantId)
      
      if (!agent) {
        return res.status(404).json({ error: 'AI agent not found for tenant ID' })
      }
      
      res.json(agent)
    } catch (error) {
      console.error('Error fetching AI agent:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Test RAG search functionality
  router.post('/search', async (req, res) => {
    try {
      const searchSchema = z.object({
        query: z.string().min(1),
        tenantId: z.string().min(1)
      })
      
      const { query, tenantId } = searchSchema.parse(req.body)
      
      const results = await storage.searchKnowledge(query, tenantId)
      
      res.json({ results })
    } catch (error) {
      console.error('Error in RAG search:', error)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  return router
}