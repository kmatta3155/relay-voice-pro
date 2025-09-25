# Production Deployment Instructions - AI Voice Receptionist

Complete deployment guide for the production-ready AI voice system with ElevenLabs integration, OpenAI STT/Chat, and barge-in capability.

## Prerequisites

Before deploying, ensure you have the following API keys ready in your Supabase Dashboard:

### Required Environment Variables
Go to **Supabase Dashboard → Project Settings → Functions → Secrets** and set:

- `SUPABASE_URL` - Your Supabase project URL (usually already set)
- `SUPABASE_SERVICE_ROLE_KEY` - Your service role key (usually already set)
- `OPENAI_API_KEY` - Your OpenAI API key for Whisper STT and GPT chat
- `ELEVENLABS_API_KEY` - Your ElevenLabs API key for TTS voice generation

## Step 1: Deploy Core Functions

### Deploy twilio-router Function

1. **Go to Supabase Dashboard:**
   https://supabase.com/dashboard/project/gnqqktmslswgjtvxfvdo/functions

2. **If twilio-router doesn't exist, create it:**
   - Click "New Function"
   - Name: `twilio-router`
   - Click "Create function"

3. **Update/Deploy Router Code:**
   - Click on `twilio-router` function
   - Delete existing code and paste ALL code from: `supabase/functions/twilio-router/index.ts`
   - **Verify line 106 routes to production function:**
     ```typescript
     const wsUrl = streamUrlEnv || `wss://${host}/functions/v1/twilio-voice-stream`
     ```
   - Click "Deploy" button

### Deploy twilio-voice-stream Function

1. **Create the AI Voice Stream Function:**
   - Click "New Function" 
   - Name: `twilio-voice-stream`
   - Click "Create function"

2. **Deploy Full AI Pipeline:**
   - Delete default code
   - Copy ALL code from: `supabase/functions/twilio-voice-stream/index.ts`
   - Click "Deploy" button
   - Wait for deployment (this may take 2-3 minutes due to large codebase)

## Step 2: Configure Database (if needed)

Ensure your database has the required tables:
- `agent_settings` - For phone number to tenant mapping
- `tenants` - For business names  
- `ai_agents` - For custom system prompts per tenant

## Step 3: Test the Complete AI System

### Test Call Instructions

**Call: 919-420-3058**

**Expected Experience:**
1. **Initial Connection:** Brief silence (200ms buffer warmup)
2. **AI Greeting:** ElevenLabs voice says business-specific greeting or default welcome message
3. **Natural Conversation:** Speak naturally - the AI will:
   - Convert your speech to text using OpenAI Whisper
   - Generate intelligent responses using GPT-4o-mini with tenant-specific prompts
   - Respond with ElevenLabs voice synthesis
   - Support barge-in (you can interrupt the AI while it's speaking)
4. **Voice Quality:** Crystal clear audio with zero static

### Advanced Features to Test

- **Barge-in:** Start speaking while the AI is talking - it should immediately stop and listen
- **Business Context:** Ask business-specific questions to test tenant-specific AI prompts
- **Conversation Flow:** Have a multi-turn conversation to test memory and context retention

## Step 4: Monitor and Debug

### View Real-time Logs

1. **Router Logs:**
   - Supabase Dashboard → Functions → `twilio-router` → Logs tab
   - Shows call routing and parameter extraction

2. **AI Voice Logs:**  
   - Supabase Dashboard → Functions → `twilio-voice-stream` → Logs tab
   - Shows detailed audio processing, STT, AI responses, and TTS streaming

### Check System Status
```bash
node check-logs.cjs
```
Should show both functions as "DEPLOYED and RESPONDING"

## Troubleshooting

### Common Issues

**No Audio/Static:**
- Check that `ELEVENLABS_API_KEY` is set correctly
- Review twilio-voice-stream logs for ElevenLabs errors
- Ensure forced μ-law codec configuration is working

**AI Not Responding:**
- Verify `OPENAI_API_KEY` is set and valid
- Check for Whisper transcription errors in logs
- Confirm GPT-4o-mini model access

**Call Not Connecting:**
- Verify twilio-router is routing to correct function URL
- Check Twilio webhook configuration points to your router function

### Performance Monitoring

The system is optimized for <300ms response latency:
- Audio buffer warmup: 200ms
- VAD (Voice Activity Detection): 500ms silence threshold  
- Barge-in detection: 250ms sustained speech threshold
- Frame timing: Precise 20ms intervals for smooth audio

## Production Notes

- **Audio Quality:** Uses forced μ-law encoding for optimal compatibility with ElevenLabs
- **Scalability:** Each call creates an isolated AIVoiceSession instance
- **Memory Management:** Automatic cleanup of audio buffers and conversation history
- **Security:** All API keys are managed via Supabase secrets (never hardcoded)

The system is now ready for production use with full AI conversation capabilities!