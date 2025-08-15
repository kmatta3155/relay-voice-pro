// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: learning
// POST { tenant_id, question, call_id?, asked_by? } → unresolved_questions
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function createClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return {
    async insert(table: string, row: any) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(row)
      });
      if (!r.ok) throw new Error(`${table} insert ${r.status} ${await r.text()}`);
      return await r.json();
    }
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, question, call_id = null, asked_by = null } = await req.json();
    if (!tenant_id || !question) throw new Error("tenant_id and question required");

    console.log(`Logging unanswered question for tenant ${tenant_id}: "${question}"`);

    const sb = createClient();
    const [row] = await sb.insert("unresolved_questions", { 
      tenant_id, 
      question, 
      call_id, 
      asked_by, 
      status: "open" 
    });

    console.log(`Created unresolved question: ${row.id}`);

    return new Response(JSON.stringify({ ok: true, id: row.id }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } catch (e) {
    console.error('Learning error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { 
      status: 400, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});