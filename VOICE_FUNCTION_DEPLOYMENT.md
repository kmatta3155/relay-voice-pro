# Voice Function Deployment & Testing Guide

## 🚨 Critical: Deploy the New Edge Function

The `twilio-voice-realtime` function exists in your codebase but **must be deployed to Supabase** before it will work.

### Deployment Steps (Supabase Dashboard)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project
   - Click **"Edge Functions"** in the left sidebar

2. **Check Existing Functions**
   - Look for `twilio-voice-realtime` in the list
   - If it doesn't exist or is outdated, you need to deploy it

3. **Deploy/Update the Function**
   
   **Option A: Via Dashboard (Recommended)**
   - Click **"Deploy new function"** or edit existing one
   - Function name: `twilio-voice-realtime`
   - Copy the **entire contents** from: `supabase/functions/twilio-voice-realtime/index.ts`
   - Click **"Deploy"**

   **Option B: Via CLI (if available)**
   ```bash
   supabase functions deploy twilio-voice-realtime
   ```

4. **Verify Environment Variables**
   - In Supabase Dashboard → Settings → Edge Functions
   - Ensure these are set:
     - `OPENAI_API_KEY` ✅
     - `SUPABASE_URL` ✅
     - `SUPABASE_SERVICE_ROLE_KEY` ✅

---

## 🧪 End-to-End Testing Checklist

### Step 1: Verify Router Configuration ✅

The router is already correctly configured:
- Points to: `wss://{host}/functions/v1/twilio-voice-realtime`
- Passes tenant_id in URL: `?tenant_id={tenant_id}`
- Includes all parameters in Stream element

### Step 2: Verify Function Deployment ❌

**In Supabase Dashboard:**

1. Go to **Edge Functions** → **twilio-voice-realtime**
2. Check deployment status (should show green "Deployed")
3. Check recent invocations (should show activity when you call)

### Step 3: Check Database Configuration

**Required Data:**
```sql
-- Verify agent_settings has your Twilio number
SELECT tenant_id, twilio_number, greeting 
FROM agent_settings 
WHERE twilio_number = '+YOUR_TWILIO_NUMBER';

-- Verify tenant exists
SELECT id, name FROM tenants WHERE id = 'YOUR_TENANT_ID';
```

### Step 4: Test Phone Call

1. **Make a test call** to your Twilio number
2. **Check logs in Supabase Dashboard:**
   - Edge Functions → twilio-router → Logs
   - Edge Functions → twilio-voice-realtime → Logs

3. **Expected Log Flow:**

   **twilio-router logs:**
   ```
   [twilio-router] Processing request
   [twilio-router] Agent lookup result
   [twilio-router] Final stream parameters
   [twilio-router] Generated TwiML response
   ```

   **twilio-voice-realtime logs:**
   ```
   [INFO] WebSocket upgrade request
   [INFO] Tenant ID: {id}
   [INFO] Agent data loaded
   [INFO] OpenAI WebSocket connected
   [INFO] Twilio stream started
   [INFO] User speech stopped, triggering response
   [INFO] Sending audio to Twilio
   ```

### Step 5: Verify Voice Flow

**Expected Experience:**
1. ✅ Call connects immediately (no delay)
2. ✅ AI greeting plays within 1-2 seconds
3. ✅ You can speak, AI detects speech end automatically
4. ✅ AI responds naturally without false starts
5. ✅ No static or audio quality issues
6. ✅ Knowledge base questions work (if RAG configured)

---

## 🔧 Troubleshooting

### No Logs in twilio-voice-realtime
- **Cause**: Function not deployed or wrong endpoint
- **Fix**: Deploy function via Supabase Dashboard

### Call Connects but No Audio
- **Check**: OpenAI WebSocket connection logs
- **Check**: API key is valid in Supabase secrets

### AI Doesn't Respond After Speaking
- **Check**: `input_audio_buffer.speech_stopped` handler in logs
- **Check**: `response.create` events are being sent

### Static or Audio Quality Issues
- **Check**: Audio codec conversion logs
- **Check**: μ-law frame sizes (should be 160 bytes)

### Tenant Not Found / 400 Error
- **Check**: Database has agent_settings for your Twilio number
- **Check**: tenant_id is being passed in URL

---

## 📊 Monitoring Checklist

**After Deployment, Monitor:**

1. **Supabase Dashboard → Edge Functions**
   - Invocation count (should increase with each call)
   - Error rate (should be 0%)
   - Response time (should be <2s)

2. **Supabase Dashboard → Logs**
   - Look for any ERROR or WARN messages
   - Verify tenant_id is extracted correctly
   - Confirm OpenAI connection succeeds

3. **Twilio Console → Call Logs**
   - Verify call completes successfully
   - Check call duration
   - Look for any errors

---

## 🎯 Success Criteria

Your deployment is successful when:

- ✅ Function shows "Deployed" in Supabase Dashboard
- ✅ Test call connects and greeting plays
- ✅ Natural conversation flow (no false detections)
- ✅ Clear audio with no static
- ✅ AI responds appropriately after you speak
- ✅ Knowledge base searches work (if configured)
- ✅ Logs show proper tenant context throughout

---

## 📝 Quick Deployment Command

If you have Supabase CLI access:
```bash
# Deploy the function
supabase functions deploy twilio-voice-realtime

# Test the deployment
curl -i https://YOUR_PROJECT_REF.supabase.co/functions/v1/twilio-voice-realtime
```

**Note:** The function expects WebSocket upgrade, so curl will return 426 (Upgrade Required), which is expected.
