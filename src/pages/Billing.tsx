// src/pages/Billing.tsx
// Billing page for customers. Allows them to subscribe to a plan via Stripe
// and manage their subscription in the billing portal. Assumes your Supabase
// project exposes functions billing-checkout and billing-portal that
// initiate a Stripe checkout session and provide a portal link.

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function BillingPage() {
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchStatus = async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("subscription_status")
        .single();
      if (!error && data) setSubscriptionStatus(data.subscription_status);
    };
    fetchStatus();
  }, []);

  const createCheckout = async (planKey: string) => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("billing-checkout", {
      body: { plan_key: planKey },
    });
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Unable to start checkout: " + error.message);
      return;
    }
    const { url } = data as { url: string };
    if (url) window.location.href = url;
  };

  const openPortal = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("billing-portal", {});
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Unable to open billing portal: " + error.message);
      return;
    }
    const { url } = data as { url: string };
    if (url) window.location.href = url;
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p>Your current subscription status: {subscriptionStatus || "unknown"}</p>
      <div className="space-x-2 mt-4">
        <Button disabled={loading} onClick={() => createCheckout("starter")}>Subscribe to Starter</Button>
        <Button disabled={loading} onClick={() => createCheckout("pro")}>Subscribe to Pro</Button>
        {subscriptionStatus === "active" && (
          <Button disabled={loading} onClick={openPortal}>Manage Subscription</Button>
        )}
      </div>
    </div>
  );
}