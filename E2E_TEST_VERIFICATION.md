# 🧪 End-to-End Voice Flow Testing Guide

## ✅ Database Configuration Verified

**Your Setup:**
- Twilio Number: **+1 (919) 420-3058**
- Business: **Salon Blu**
- Tenant ID: `550e8400-e29b-41d4-a716-446655440000`
- Greeting: "Hello, thank you for calling Salon Blu..."

---

## 🚨 CRITICAL: Function Deployment Status

### Why You're Not Seeing Logs

**Edge Function logs appear in Supabase Dashboard, NOT in Replit.**

The router is correctly configured to use `twilio-voice-realtime`, but if you're not seeing logs, it means:

1. **Function isn't deployed yet** ❌
2. **OR you're looking in the wrong place** (Replit vs Supabase)

---

## 📋 Step-by-Step Verification

### STEP 1: Check Function Deployment ⚠️ CRITICAL

**Go to Supabase Dashboard:**
1. Open: https://supabase.com/dashboard
2. Select your project
3. Click **"Edge Functions"** in left sidebar
4. Look for: **`twilio-voice-realtime`**

**What You Should See:**
- ✅ Function exists and shows "Deployed" status
- ✅ Shows recent deployment timestamp
- ✅ Environment variables configured

**If Function Doesn't Exist:**
- You MUST deploy it first (see DEPLOYMENT STEPS below)
- The router cannot connect to a non-existent function

---

### STEP 2: Deploy the Function (If Not Deployed)

**Option A: Supabase Dashboard (Easiest)**
1. Edge Functions → **"New function"** or **"Edit"** existing
2. Name: `twilio-voice-realtime`
3. Copy **ALL CODE** from: `supabase/functions/twilio-voice-realtime/index.ts`
4. Click **"Deploy"**
5. Wait for green "Deployed" status

**Option B: Supabase CLI (If Available)**
```bash
supabase functions deploy twilio-voice-realtime
```

---

### STEP 3: Test Phone Call Flow

**Make a test call to: +1 (919) 420-3058**

**Where to Watch Logs:**
1. **Supabase Dashboard** → **Edge Functions** → **twilio-router** → **Logs tab**
2. **Supabase Dashboard** → **Edge Functions** → **twilio-voice-realtime** → **Logs tab**

---

### STEP 4: Verify Logs Show Correct Flow

#### Expected `twilio-router` Logs:

```
✅ [twilio-router] Processing request
   - from: +1XXXXXXXXXX
   - to: +19194203058
   
✅ [twilio-router] Querying agent_settings
   - lookupValue: +19194203058
   
✅ [twilio-router] Agent lookup result
   - agentTenantId: 550e8400-e29b-41d4-a716-446655440000
   
✅ [twilio-router] OVERRIDE from agent_settings
   - tenantId: 550e8400-e29b-41d4-a716-446655440000
   - businessName: Salon Blu
   
✅ [twilio-router] Final stream parameters
   - wsUrl: wss://.../twilio-voice-realtime?tenant_id=550e8400-...
   - tenantId: 550e8400-e29b-41d4-a716-446655440000
   
✅ [twilio-router] Generated TwiML response
```

#### Expected `twilio-voice-realtime` Logs:

```
✅ [INFO] twilio-voice-realtime: WebSocket upgrade request
   - tenant_id: 550e8400-e29b-41d4-a716-446655440000
   
✅ [INFO] twilio-voice-realtime: Agent data loaded
   - tenant_id: 550e8400-e29b-41d4-a716-446655440000
   - greeting: "Hello, thank you for calling Salon Blu..."
   
✅ [INFO] twilio-voice-realtime: Connecting to OpenAI Realtime API
   
✅ [INFO] twilio-voice-realtime: OpenAI WebSocket connected
   
✅ [INFO] twilio-voice-realtime: Twilio stream started
   - streamSid: MZ...
   
✅ [INFO] twilio-voice-realtime: Session configured with server_vad
   
✅ [INFO] twilio-voice-realtime: Sending initial greeting
   
✅ [INFO] twilio-voice-realtime: User speech stopped, triggering response
   
✅ [INFO] twilio-voice-realtime: Streaming audio to Twilio
   
✅ [INFO] twilio-voice-realtime: Connections closed gracefully
```

---

### STEP 5: Verify Voice Quality

**During the Call, Check:**

1. **✅ Immediate Connection**
   - Call connects within 1-2 seconds
   - No long pauses before greeting

2. **✅ Clear Greeting**
   - Greeting plays: "Hello, thank you for calling Salon Blu..."
   - Audio is clear with no static
   - Voice sounds natural (OpenAI voice)

3. **✅ Natural Conversation**
   - Speak a question
   - AI detects when you stop speaking (server-side VAD)
   - AI responds appropriately
   - No false starts or interruptions

4. **✅ Knowledge Base Integration** (if configured)
   - Ask: "What are your hours?"
   - AI should search knowledge base
   - Should provide accurate answer from your data

5. **✅ No Audio Issues**
   - No static or crackling
   - No echo or feedback
   - Clear both directions
   - No latency/delay

---

## 🐛 Troubleshooting Guide

### Issue: No Logs in `twilio-voice-realtime`

**Diagnosis:**
- Function not deployed
- OR wrong endpoint configured

**Solution:**
1. Verify function exists in Supabase Dashboard
2. Deploy if missing (see STEP 2)
3. Check router logs for the WebSocket URL being used

---

### Issue: Call Connects but Drops Immediately

**Diagnosis:**
- WebSocket upgrade failed
- Tenant ID missing
- OpenAI API key invalid

**Solution:**
1. Check `twilio-voice-realtime` logs for errors
2. Verify environment variables in Supabase:
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

---

### Issue: No Audio or One-Way Audio

**Diagnosis:**
- Audio codec conversion failing
- OpenAI WebSocket not connected

**Solution:**
1. Look for "OpenAI WebSocket connected" in logs
2. Check for audio conversion errors
3. Verify OpenAI API key has Realtime API access

---

### Issue: AI Doesn't Respond After Speaking

**Diagnosis:**
- `speech_stopped` handler not working
- `response.create` not being sent

**Solution:**
1. Look for "User speech stopped" in logs
2. Should see "input_audio_buffer.commit" event
3. Should see "response.create" event
4. Check OpenAI connection is active

---

### Issue: Static or Poor Audio Quality

**Diagnosis:**
- Audio frame size mismatch
- Codec conversion errors

**Solution:**
1. Check logs for "μ-law" conversion mentions
2. Verify frame sizes: 160 bytes μ-law
3. Check for buffer overflow warnings

---

## 📊 Success Metrics

**Your deployment is successful when:**

| Metric | Expected | How to Verify |
|--------|----------|---------------|
| Function Deployed | ✅ Green status | Supabase Dashboard → Edge Functions |
| Router Logs | ✅ Shows tenant lookup | Supabase → twilio-router → Logs |
| Voice Function Logs | ✅ Shows WebSocket flow | Supabase → twilio-voice-realtime → Logs |
| Call Connects | ✅ <2 seconds | Test call experience |
| Greeting Plays | ✅ Clear audio | Test call experience |
| Conversation Flow | ✅ Natural turn-taking | Test call experience |
| Audio Quality | ✅ No static | Test call experience |
| Knowledge Search | ✅ Accurate answers | Ask business questions |

---

## 🎯 Quick Verification Checklist

**Before calling, verify:**
- [ ] `twilio-voice-realtime` function shows "Deployed" in Supabase
- [ ] Environment variables are set (OPENAI_API_KEY, etc.)
- [ ] Database has agent_settings for +19194203058

**During the call, verify:**
- [ ] Greeting plays within 2 seconds
- [ ] Audio is clear with no static
- [ ] You can have natural back-and-forth conversation
- [ ] AI detects when you stop speaking
- [ ] No false interruptions

**After the call, verify:**
- [ ] Both router and voice function logs show activity
- [ ] No ERROR messages in logs
- [ ] Call duration matches expected time
- [ ] Twilio call log shows "completed"

---

## 🚀 Next Steps

1. **Deploy the function** (if not already done)
2. **Make a test call** to +1 (919) 420-3058
3. **Watch Supabase logs** during the call
4. **Verify the checklist** above

**Where to Find Logs:**
- **NOT in Replit** ❌
- **YES in Supabase Dashboard** ✅ → Edge Functions → Logs tab

Once you see logs flowing and the call works properly, the migration is complete!
