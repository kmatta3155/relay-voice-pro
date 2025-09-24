import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

// Store logs in Deno KV (persistent storage)
const kv = await Deno.openKv()
const LOG_PREFIX = "edge_logs"
const MAX_LOGS = 5000

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  
  try {
    // POST - Store a log entry
    if (req.method === 'POST') {
      const logEntry = await req.json()
      
      // Add server timestamp
      logEntry.serverTimestamp = new Date().toISOString()
      
      // Generate unique key with timestamp
      const key = [LOG_PREFIX, Date.now().toString(), crypto.randomUUID()]
      
      // Store in KV
      await kv.set(key, logEntry, { expireIn: 86400000 }) // Expire after 24 hours
      
      // Also write to a file for easy retrieval
      try {
        const logFilePath = `/tmp/edge-logs-${logEntry.functionName}.jsonl`
        await Deno.writeTextFile(
          logFilePath, 
          JSON.stringify(logEntry) + '\n',
          { append: true, create: true }
        )
      } catch (fileError) {
        console.error('Failed to write log file:', fileError)
      }
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }
    
    // GET - Retrieve logs
    if (req.method === 'GET') {
      const functionName = url.searchParams.get('function')
      const limit = parseInt(url.searchParams.get('limit') || '100')
      const logs: any[] = []
      
      // List all log entries
      const entries = kv.list({ prefix: [LOG_PREFIX] })
      
      for await (const entry of entries) {
        const log = entry.value as any
        if (!functionName || log.functionName === functionName) {
          logs.push(log)
        }
        if (logs.length >= limit) break
      }
      
      // Sort by timestamp (newest first)
      logs.sort((a, b) => {
        const timeA = new Date(a.timestamp || a.serverTimestamp).getTime()
        const timeB = new Date(b.timestamp || b.serverTimestamp).getTime()
        return timeB - timeA
      })
      
      return new Response(JSON.stringify({
        logs: logs.slice(0, limit),
        totalCount: logs.length
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }
    
    // DELETE - Clear logs
    if (req.method === 'DELETE') {
      const entries = kv.list({ prefix: [LOG_PREFIX] })
      for await (const entry of entries) {
        await kv.delete(entry.key)
      }
      
      return new Response(JSON.stringify({ success: true, message: "Logs cleared" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }
    
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405
    })
  } catch (error: any) {
    console.error('Debug logger error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    })
  }
})