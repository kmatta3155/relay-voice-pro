import { supabase } from "@/integrations/supabase/client";

export async function logClient(event: string, data?: any, tenant_id?: string) {
  try {
    await (supabase as any).from("logs").insert({
      event,
      data: data ? JSON.stringify(data).slice(0, 8000) : null,
      tenant_id
    } as any);
  } catch { /* ignore client logging errors */ }
}
