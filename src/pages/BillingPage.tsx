import React from "react";
import { startCheckout } from "@/lib/billing";

export default function BillingPage() {
  return (
    <main className="px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Billing</h1>
        <p className="text-muted-foreground mb-6">Manage your plan and payments.</p>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={() => startCheckout("plan_receptionist_crm")}
        >
          Upgrade to Receptionist + CRM
        </button>
      </div>
    </main>
  );
}
