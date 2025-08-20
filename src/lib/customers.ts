import { supabase } from "./supabaseClient";
export type Role = "OWNER"|"MANAGER"|"AGENT"|"VIEWER";

export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) return null;
  return data;
}
export async function setActiveTenant(tenant_id: string) {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return;
  await supabase.from("profiles").update({ active_tenant_id: tenant_id }).eq("id", user.id);
}
// Backwards-compat alias
export const setActiveCustomer = setActiveTenant;
export async function myCustomers() {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return [];
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenant:tenants(id, name, slug)")
    .eq("user_id", user.id);
  if (error) return [];
  return (data as any[]).map((m:any)=> ({ role: m.role as Role, ...m.tenant }));
}
export const myTenants = myCustomers;
export async function ensureDemoTenant() {
  const tenants = await myCustomers();
  if (tenants.length) return tenants;
  const { data: demo } = await supabase.from("tenants").select("id,slug").eq("slug","demo").maybeSingle();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && demo) {
    await supabase.from("memberships").insert({ user_id: user.id, tenant_id: (demo as any).id, role: "OWNER" as Role });
    await setActiveTenant((demo as any).id);
    return myCustomers();
  }
  return [];
}
// Backwards-compat alias
export const ensureDemoCustomer = ensureDemoTenant;
export async function isSiteAdmin() {
  const p = await loadProfile();
  return !!(p as any)?.is_site_admin;
}
