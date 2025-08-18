import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

/*
 * twilio-sms-send
 *
 * This function sends an outbound SMS via the Twilio REST API. It
 * expects a JSON body containing at least `to` and `message`, and
 * optionally `tenant_id`. You must set environment variables
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in your
 * Supabase Function secrets for this to work. In a more complete
 * implementation you could look up the tenant's default "from"
 * number from the database. For now this skeleton just posts to
 * Twilio and returns the JSON response.
 */

// Helper to encode credentials for Basic auth
function toBasicAuth(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const { to, message } = await req.json();
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER") || "";
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error("Twilio credentials or from number not set");
    }
    const body = new URLSearchParams({ To: to, From: fromNumber, Body: message }).toString();
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: toBasicAuth(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});