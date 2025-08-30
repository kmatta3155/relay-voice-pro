import { createTenant, searchNumbers, purchaseNumber } from "../lib/admin";
import { supabase } from "../integrations/supabase/client";

async function testTenantProvisioning() {
  const userId = "test-user-" + Math.random().toString(36).slice(2, 10);
  const tenantName = "TestTenant-" + Date.now();

  // 1. Create tenant
  const { tenantId } = await createTenant({ name: tenantName, userId });
  if (!tenantId) throw new Error("Tenant creation failed");
  console.log("Created tenant:", tenantId);

  // 2. Search for available numbers
  const numbers = await searchNumbers({ country: "US" });
  if (!numbers?.numbers?.length) throw new Error("No numbers found");
  const phoneNumber = numbers.numbers[0].phone_number;
  console.log("Found number:", phoneNumber);

  // 3. Purchase number
  const purchase = await purchaseNumber({ phoneNumber, tenantId, projectBase: "https://gnqqktmslswgjtvxfvdo.supabase.co" });
  if (!purchase?.ok) throw new Error("Number purchase failed");
  console.log("Purchased number:", phoneNumber);

  // 4. Verify in DB
  const { data: agentSettings } = await supabase
    .from("agent_settings")
    .select("twilio_number")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!agentSettings?.twilio_number) throw new Error("Number not set in agent_settings");
  console.log("Verified number in DB:", agentSettings.twilio_number);

  console.log("Tenant and number provisioning test PASSED");
}

testTenantProvisioning().catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});
