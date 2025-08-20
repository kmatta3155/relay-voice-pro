import React from "react";
import { useIsAdmin } from "@/lib/useIsAdmin";

export default function AdminLink({ className = "" }: { className?: string }) {
  const { isAdmin, loading } = useIsAdmin();

  if (loading || !isAdmin) return null;

  return (
    <a
      href="/admin/onboarding"
      className={className || "text-sm text-zinc-700 hover:text-violet-700"}
    >
      Admin
    </a>
  );
}