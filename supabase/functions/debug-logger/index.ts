import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

// In-memory log ring buffer (survives for lifetime of function instance)
const MAX_LOGS = 5000
const logs: any[] = []

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)

  try {
    if (req.method === 'POST') {
      const logEntry = await req.json()
      logEntry.serverTimestamp = new Date().toISOString()

      logs.push(logEntry)
      if (logs.length > MAX_LOGS) logs.shift()

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }

    if (req.method === 'GET') {
      const functionName = url.searchParams.get('function')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), MAX_LOGS)

      const filtered = functionName
        ? logs.filter(l => l.functionName === functionName)
        : [...logs]

      filtered.sort((a, b) =>
        new Date(b.timestamp || b.serverTimestamp).getTime() -
        new Date(a.timestamp || a.serverTimestamp).getTime()
      )

      return new Response(JSON.stringify({
        logs: filtered.slice(0, limit),
        totalCount: filtered.length
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }

    if (req.method === 'DELETE') {
      logs.length = 0
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
