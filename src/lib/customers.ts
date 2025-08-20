import { supabase } from "./supabaseClient";
export type Role = "OWNER"|"MANAGER"|"AGENT"|"VIEWER";

export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) return null;
  return data;
}
export async function setActiveCustomer(customer_id: string) {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return;
  await supabase.from("profiles").update({ active_customer_id: customer_id }).eq("id", user.id);
}
export async function myCustomers() {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return [];
  const { data, error } = await supabase
    .from("memberships")
    .select("role, customer:customers(id, name, slug)")
    .eq("user_id", user.id);
  if (error) return [];
  return data.map((m:any)=> ({ role: m.role as Role, ...m.customer }));
}
export async function ensureDemoCustomer() {
  const customers = await myCustomers();
  if (customers.length) return customers;
  const { data: demo } = await supabase.from("customers").select("id,slug").eq("slug","demo").single();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && demo) {
    await supabase.from("memberships").insert({ user_id: user.id, customer_id: demo.id, role: "OWNER" });
    await setActiveCustomer(demo.id);
    return myCustomers();
  }
  return [];
}
export async function isSiteAdmin() {
  const p = await loadProfile();
  return !!(p as any)?.is_site_admin;
}
