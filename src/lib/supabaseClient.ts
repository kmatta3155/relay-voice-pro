import { supabase as base } from "@/integrations/supabase/client";

export const supabase = base;

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function requireSessionOrRedirect() {
  const s = await getSession();
  if (!s) { window.location.hash = "#signin"; }
  return s;
}
