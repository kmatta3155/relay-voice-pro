import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns { isAdmin, loading } for the current user's active tenant.
 * Admin includes roles: owner, admin.
 */
export function useIsAdmin() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { setIsAdmin(false); setLoading(false); return; }

      const { data: p } = await supabase
        .from("profiles")
        .select("active_tenant_id")
        .eq("id", uid)
        .single();

      const tid = p?.active_tenant_id as string | undefined;
      if (!tid) { setIsAdmin(false); setLoading(false); return; }

      const { data: tu } = await supabase
        .from("tenant_users")
        .select("role")
        .eq("tenant_id", tid)
        .eq("user_id", uid)
        .maybeSingle();

      setIsAdmin(tu?.role === "owner" || tu?.role === "admin");
      setLoading(false);
    })();
  }, []);

  return { isAdmin, loading };
}