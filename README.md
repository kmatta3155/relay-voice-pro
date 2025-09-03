# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/f9ef1427-00f3-47c2-a38e-4b89237ac93c

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/f9ef1427-00f3-47c2-a38e-4b89237ac93c) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/f9ef1427-00f3-47c2-a38e-4b89237ac93c) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)

## Voice Agent (Twilio + Vapi)

- Twilio webhook (A Call Comes In): `https://<project>.functions.supabase.co/twilio-router`
- Twilio status callback: `https://<project>.functions.supabase.co/twilio-status`
- Router returns TwiML `<Connect><Stream>` to `wss://<project>.functions.supabase.co/twilio-voice-stream`

Environment variables:

- `VAPI_API_KEY`: Vapi API key
- `VAPI_REALTIME_URL`: Vapi realtime WS URL (e.g. `wss://api.vapi.ai/realtime`)
- `ELEVENLABS_VOICE_ID`: Voice id to synthesize via Vapi/ElevenLabs
- `OPENAI_API_KEY`: Used for Whisper + ChatGPT fallback/knowledge replies
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Existing DB access
- `VAPI_WEBHOOK_SECRET`: Optional shared secret for Vapi Server URL callbacks

Optional tuning / compatibility:

- `VAPI_AUDIO_IN_EVENT` (default `user_audio_chunk`)
- `ENABLE_TONE_TEST_ONLY`, `ENABLE_TONE_TEST` (outbound path checks)
- `VAD_SILENCE_RMS`, `VAD_MIN_FRAMES`, `VAD_END_FRAMES`

Notes:

- Outbound WS frames to Twilio use only `media.payload` with μ-law 8kHz 160-byte chunks every ~20ms.
- The voice-stream function echoes Twilio's `Sec-WebSocket-Protocol` (e.g. `audio`).

## Using Vapi To Own Audio

If you want Vapi to handle all audio (ingest, formatting, streaming) and only call your backend for text:

- Point your Twilio number to Vapi (use Vapi's Twilio integration), not to the router.
- In your Vapi Assistant → Messaging → Server Settings, set Server URL to:
  `https://<project>.functions.supabase.co/vapi-hook`
  - Add header `x-vapi-secret: <value>` and set the same value in env `VAPI_WEBHOOK_SECRET`.
- Keep your ElevenLabs voice and Deepgram in the Assistant.
- Our `vapi-hook` function receives Vapi POSTs with the transcript and responds `{ text: "..." }`. Vapi synthesizes and streams audio to the caller.

You can disable the old WS path by setting `USE_VAPI=false` in `twilio-voice-stream/index.ts` or by routing calls directly to Vapi so the WS function is not used.
