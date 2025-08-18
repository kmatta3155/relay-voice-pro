import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

/*
 * twilio-router
 *
 * Twilio routes all inbound voice calls to this function. Based on
 * your business hours and tenant configuration you can decide
 * whether to connect the caller to your AI receptionist (via
 * `twilio-incoming` or a media stream) or divert to voicemail or
 * forward to a fallback number. This skeleton always returns a
 * simple TwiML greeting so that the function deploys successfully.
 */

serve(async (req: Request) => {
  // In the future you can parse query params or form data sent by Twilio
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="Polly.Joanna">Hello! The AI receptionist is not yet configured. Please try again later.</Say>\n  <Hangup/>\n</Response>`;
  return new Response(twiml, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
});