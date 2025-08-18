import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

/*
 * twilio-sms-incoming
 *
 * Twilio will invoke this function whenever your phone number
 * receives an incoming SMS. The payload will be form-encoded
 * parameters such as Body, From and To. In a full implementation
 * you might look up the tenant by the "To" phone number, store the
 * inbound message in your `sms_messages` table, and forward the
 * content to your AI router. For now this skeleton simply returns
 * a friendly acknowledgment in TwiML format.
 */

serve(async (req: Request) => {
  // Twilio sends x-www-form-urlencoded bodies for SMS webhooks
  const formData = await req.formData().catch(() => undefined);
  const body = formData?.get("Body")?.toString() ?? "";
  const from = formData?.get("From")?.toString() ?? "";
  const to = formData?.get("To")?.toString() ?? "";

  // Log the inbound SMS (in a real implementation you would insert into your DB)
  console.log("Received SMS from", from, "to", to, "body", body);

  // Respond with simple TwiML to acknowledge receipt. Twilio requires XML responses
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>Thank you for your message. Our AI receptionist will respond shortly.</Message>\n</Response>`;
  return new Response(twiml, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
});