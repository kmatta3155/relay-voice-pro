import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Twilio SMS webhook -> expects body with call_id and rating (1-5)
serve(async (req)=>{
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);
  const contentType = req.headers.get("content-type") || "";
  let callId: string | null = null;
  let rating: number | null = null;
  if (contentType.includes("application/json")){
    const body = await req.json();
    callId = body.call_id; rating = Number(body.rating);
  } else {
    const form = await req.formData();
    callId = String(form.get("call_id")||""); rating = Number(form.get("rating")||"");
  }
  if (callId && rating){
    await sb.from("calls").update({ csat: rating }).eq("id", callId);
  }
  return new Response("OK", { headers: { "content-type": "text/plain" }});
});
