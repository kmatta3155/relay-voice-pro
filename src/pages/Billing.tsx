import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openCheckout, openCustomerPortal } from "@/lib/billing";
import SubGuard from "@/components/auth/SubGuard";

export default function BillingPage(){
  return (
    <SubGuard>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Subscription</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_STARTER")}>Starter</Button>
              <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_STANDARD")}>Standard</Button>
              <Button className="rounded-2xl" onClick={()=> openCheckout("PRICE_ID_CRM_ADDON")}>Add CRM</Button>
              <Button variant="outline" className="rounded-2xl" onClick={openCustomerPortal}>Customer Portal</Button>
            </div>
            <p className="text-xs text-slate-500">Replace PRICE_ID_* with your Stripe Price IDs.</p>
          </CardContent>
        </Card>
      </div>
    </SubGuard>
  );
}
