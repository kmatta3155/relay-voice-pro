# 🚀 Complete Deployment & Verification Checklist

## What I Fixed

Added **enhanced logging** and **multiple fallback mechanisms** to capture tenant_id from:
1. ✅ URL query parameter (`?tenant_id=xxx`)
2. ✅ Twilio customParameters (`tenantId`, `tenant_id`, `TENANT_ID`)
3. ✅ Detailed diagnostics to show exactly what's received

---

## Step-by-Step Deployment

### 1. Push Code to GitHub

```bash
git add render/twilio-voice-realtime.ts
git commit -m "Add comprehensive logging and tenant_id fallback mechanisms"
git push origin main
```

### 2. Deploy to Render

1. Go to: **https://dashboard.render.com/**
2. Click your service: **relay-voice-pro**
3. Click: **"Manual Deploy"** → **"Deploy latest commit"**
4. **Wait for "Live" status** (2-3 minutes)

### 3. Test & Verify

**Make a test call** to your Twilio number: **+1 (919) 420-3058**

### 4. Check Render Logs

Go to: **Render Dashboard** → **relay-voice-pro** → **Logs**

**Look for these specific log lines:**

#### ✅ **GOOD - What You Should See:**

```
[INFO] WebSocket upgrade request {"fullUrl":"wss://...","tenantIdFromUrl":"f3760fe8-4491-4ab1-83dd-4069b1a2d688"}
[INFO] Twilio start event received {"customParametersReceived":{...},"tenantIdBeforeCheck":"f3760fe8-..."}
[INFO] Tenant ID updated from customParameters {"source":"customParameters","tenantId":"f3760fe8-..."}
[INFO] Twilio stream started - Final state {"tenantId":"f3760fe8-4491-4ab1-83dd-4069b1a2d688","hasTenantId":true}
[INFO] OpenAI session configured {"voice":"alloy"}
```

#### ❌ **BAD - Problems:**

```
[ERROR] CRITICAL: No tenant ID available from any source!
[ERROR] Error fetching agent config
```

---

## Expected Behavior

### ✅ **Working Call**:
1. You call the number
2. AI answers: "Hello, thank you for calling Salon Blu. How can I help you today?"
3. You can have a conversation
4. No 6-minute cutoff!

### ❌ **Still Broken**:
1. Silence on the call
2. Render logs show `"hasTenantId":false`

---

## If Still Getting Silence

### Option A: Check Logs First

Send me the **complete Render logs** from the call showing:
- `WebSocket upgrade request` line
- `Twilio start event received` line  
- `Twilio stream started - Final state` line

This will tell us EXACTLY where tenant_id is being lost.

### Option B: Nuclear Option - Move Router to Render Too

If the handoff between Supabase and Render is fundamentally broken, we can move the entire router to Render as well, eliminating the integration point.

---

## Success Criteria

- ✅ Render logs show `"hasTenantId":true`
- ✅ Render logs show successful agent config fetch
- ✅ AI answers the phone and talks
- ✅ Call works beyond 6 minutes
- ✅ No WebSocket errors in Twilio

---

## Quick Reference

**Your Twilio Number**: +1 (919) 420-3058  
**Tenant ID**: f3760fe8-4491-4ab1-83dd-4069b1a2d688  
**Business Name**: Salon Blu  
**Render Service**: https://relay-voice-pro.onrender.com

---

**Next: Deploy and test, then share the Render logs so we can verify!**
