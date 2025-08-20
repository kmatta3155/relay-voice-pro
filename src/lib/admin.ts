import { supabase } from "@/integrations/supabase/client";

export async function createTenant(payload: {
  name: string; 
  userId: string; 
  website_url?: string; 
  greeting?: string; 
  brand_color?: string; 
  logo_url?: string;
}) {
  const { data, error } = await supabase.functions.invoke("tenant-create", { body: payload });
  if (error) throw error;
  return data as { ok: boolean; tenantId: string };
}

export async function adminControl(cmd: any) {
  const { data, error } = await supabase.functions.invoke("admin-control", { body: cmd });
  if (error) throw error;
  return data;
}

/**
 * Promotes a user to admin or sets their role
 */
export async function promoteUserToAdmin(email: string, role: string = 'admin', tenantId?: string) {
  const { data, error } = await supabase.functions.invoke("admin-control", { 
    body: { 
      action: "promote_user", 
      email, 
      role, 
      tenant_id: tenantId 
    } 
  });
  if (error) throw error;
  return data;
}

/**
 * Removes admin privileges from a user
 */
export async function demoteUser(email: string, tenantId?: string) {
  const { data, error } = await supabase.functions.invoke("admin-control", { 
    body: { 
      action: "demote_user", 
      email, 
      tenant_id: tenantId 
    } 
  });
  if (error) throw error;
  return data;
}

export async function searchNumbers(params: { country?: string; areaCode?: string }) {
  const { data, error } = await supabase.functions.invoke("number-provision", { 
    body: { action: "search", ...params } 
  });
  if (error) throw error;
  return data;
}

export async function purchaseNumber(args: { phoneNumber: string; tenantId: string; projectBase: string }) {
  const { data, error } = await supabase.functions.invoke("number-provision", { 
    body: { action: "purchase", ...args }
  });
  if (error) throw error;
  return data;
}