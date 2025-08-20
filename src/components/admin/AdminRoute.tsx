import React from "react";
import { useIsAdmin } from "@/lib/useIsAdmin";

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useIsAdmin();

  if (loading) {
    return <div className="p-6 text-sm text-zinc-500">Checking admin access…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-xl border p-6 bg-amber-50 text-amber-800">
          403 — Admins only. If you believe this is an error, ask an owner to grant you access.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}