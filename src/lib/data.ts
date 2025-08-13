import { supabase } from "./supabaseClient";

async function activeTenantId(): Promise<string|null> {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
  const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
  return data?.active_tenant_id || null;
}

/* ------- Leads ------- */
export async function listLeads() {
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("leads").select("*").eq("tenant_id", t).order("created_at", { ascending: false });
  return data || [];
}
export async function upsertLead(lead:any){
  const t = await activeTenantId(); if (!t) throw new Error("No active tenant");
  const payload = { ...lead, tenant_id: t, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("leads").upsert(payload).select("*").single();
  if (error) throw error; return data;
}
export async function deleteLead(id:string){
  const t = await activeTenantId(); if (!t) return;
  await supabase.from("leads").delete().eq("tenant_id", t).eq("id", id);
}

/* ------- Threads / Messages ------- */
export async function listThreads(){
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("threads").select("*").eq("tenant_id", t).order("updated_at",{ascending:false});
  return data || [];
}
export async function createThreadIfMissing(withHandle:string, channel:string){
  const t = await activeTenantId(); if (!t) throw new Error("No active tenant");
  const { data: found } = await supabase.from("threads").select("*").eq("tenant_id", t).eq("with", withHandle).eq("channel",channel).maybeSingle();
  if (found) return found;
  const { data } = await supabase.from("threads").insert({ tenant_id:t, with:withHandle, channel }).select("*").single();
  return data!;
}
export async function listMessages(thread_id:string){
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("messages").select("*").eq("tenant_id", t).eq("thread_id",thread_id).order("at");
  return data || [];
}
export async function sendMessage(thread:any, text:string){
  const t = await activeTenantId(); if (!t) throw new Error("No active tenant");
  await supabase.from("messages").insert({ tenant_id:t, thread_id:thread.id, from:"agent", text, sent_at:new Date().toISOString() });
  await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id);
}

/* ------- Calls ------- */
export async function listCalls(){
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("calls").select("*").eq("tenant_id", t).order("at",{ascending:false});
  return data || [];
}

/* ------- Appointments ------- */
export async function listAppointments(){
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("appointments").select("*").eq("tenant_id", t).order("start_at");
  return data || [];
}
export async function upsertAppointment(a:any){
  const t = await activeTenantId(); if (!t) throw new Error("No active tenant");
  const payload = { ...a, tenant_id:t };
  const { data, error } = await supabase.from("appointments").upsert(payload).select("*").single();
  if (error) throw error; return data;
}
export async function deleteAppointment(id:string){
  const t = await activeTenantId(); if (!t) return;
  await supabase.from("appointments").delete().eq("tenant_id",t).eq("id",id);
}
