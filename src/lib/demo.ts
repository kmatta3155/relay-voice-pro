
import { supabase } from "@/integrations/supabase/client";

export async function resetDemo(tenantId: string){
  const { data, error } = await supabase.functions.invoke("reset-demo", { body: { tenantId } });
  if (error) throw error;
  return data;
}

export async function seedDemo(tenantId: string){
  const { data, error } = await supabase.functions.invoke("seed-demo", { body: { tenantId } });
  if (error) throw error;
  return data;
}

export async function toggleAiSms(tenantId: string, enabled: boolean){
  const { data, error } = await supabase.functions.invoke("toggle-ai-sms", { body: { tenantId, enabled } });
  if (error) throw error;
  return data;
}
