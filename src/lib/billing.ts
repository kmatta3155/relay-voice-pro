import { supabase } from "@/integrations/supabase/client";

async function getTenantId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { data: prof } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
  if (!prof?.active_tenant_id) throw new Error("No active tenant on profile");
  return prof.active_tenant_id as string;
}

export async function openCheckout(priceId: string) {
  const tenantId = await getTenantId();
  const { data, error } = await supabase.functions.invoke("billing", {
    body: { action: "checkout", tenantId, priceId }
  });
  if (error) throw error;
  if (data?.url) window.location.href = data.url;
}

export async function openCustomerPortal() {
  const tenantId = await getTenantId();
  const { data, error } = await supabase.functions.invoke("billing", {
    body: { action: "portal", tenantId }
  });
  if (error) throw error;
  if (data?.url) window.location.href = data.url;
}
