import { supabase } from "@/integrations/supabase/client";

export async function startCheckout(planId: string) {
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { planId },
  });
  if (error) throw error;
  if (data?.url) {
    // Open in a new tab per guidance
    window.open(data.url, "_blank");
  }
}
