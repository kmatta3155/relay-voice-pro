import { supabase } from "./supabaseClient";

export type Role = "OWNER"|"MANAGER"|"AGENT"|"VIEWER";

export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) return null;
  return data;
}

export async function setActiveTenant(tenant_id: string) {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return;
  await supabase.from("profiles").update({ active_tenant_id: tenant_id }).eq("id", user.id);
}

export async function myTenants() {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return [];
  const { data, error } = await supabase
  .from("memberships")
  .select("role, tenant:tenants(id, name, slug)")
  .eq("user_id", user.id);
  if (error) return [];
  return (data || []).map((m:any)=> ({ role: m.role as Role, ...m.tenant }));
}

export async function ensureDemoTenant() {
  // Helper: if the user has no tenant, join demo (from seed) or create one
  const tenants = await myTenants();
  if (tenants.length) return tenants;
  const { data: demo } = await supabase.from("tenants").select("id,slug").eq("slug","demo").maybeSingle();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && demo) {
    await supabase.from("memberships").insert({ user_id: user.id, tenant_id: demo.id, role: "OWNER" });
    await setActiveTenant(demo.id);
    return myTenants();
  }
  return [];
}
