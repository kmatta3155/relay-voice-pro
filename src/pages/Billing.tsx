import React, { useEffect, useState } from "react";
import { openCheckout, openCustomerPortal } from "@/lib/billing";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function BillingPage(){
  const [plan, setPlan] = useState<{status:string|null; price_id:string|null; stripe_customer_id:string|null}>({ status:null, price_id:null, stripe_customer_id:null });

  useEffect(()=> {
    (async ()=>{
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id; if(!uid) return;
      const { data: p } = await supabase.from("profiles").select("active_tenant_id").eq("id", uid).single();
      const tid = p?.active_tenant_id; if(!tid) return;
      const { data: t } = await supabase.from("tenants").select("subscription_status, price_id, stripe_customer_id").eq("id", tid).single();
      setPlan({ status: t?.subscription_status || null, price_id: t?.price_id || null, stripe_customer_id: t?.stripe_customer_id || null });
    })();
  },[]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Subscription</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>Status: <b>{plan.status || "none"}</b></div>
          <div>Price: <code>{plan.price_id || "—"}</code></div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_STARTER")}>Upgrade to Starter</Button>
            <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_STANDARD")}>Upgrade to Standard</Button>
            <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_CRM_ADDON")}>Add CRM</Button>
            <Button variant="outline" className="rounded-2xl" onClick={openCustomerPortal}>Manage in Customer Portal</Button>
          </div>
          <p className="text-xs text-slate-500">Replace PRICE_ID_* with your Stripe Price IDs.</p>
        </CardContent>
      </Card>
    </div>
  );
}
