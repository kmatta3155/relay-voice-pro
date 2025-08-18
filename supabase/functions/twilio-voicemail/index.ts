import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

/*
 * twilio-voicemail
 *
 * This function returns TwiML that asks the caller to leave a
 * voicemail. Twilio will record the message and optionally call
 * another webhook when the recording is complete. You can store
 * the recording URL in your database and send notifications.
 */

serve(async (_req: Request) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Please leave a message after the tone. Press any key when you are finished.</Say>\n  <Record maxLength="60"/>\n  <Hangup/>\n</Response>`;
  return new Response(twiml, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
});