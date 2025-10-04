# Render.com Deployment - Quick Start

## 🚀 5-Minute Setup

### 1. Get Your Secrets Ready

From your Replit Secrets, copy these values:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

### 2. Deploy to Render.com

1. **Go to**: https://dashboard.render.com/
2. **Click**: New + → Web Service
3. **Connect**: Your GitHub repository
4. **Configure**:
   - Name: `voice-relay-realtime`
   - Region: Oregon (USA) or Frankfurt (EU)
   - Root Directory: `render`
   - Runtime: **Docker**
   - Instance Type: **Starter** ($7/month) or higher
5. **Environment Variables** (click Environment tab):
   ```
   SUPABASE_URL = [your-value]
   SUPABASE_SERVICE_ROLE_KEY = [your-value]
   OPENAI_API_KEY = [your-value]
   ```
6. **Click**: Create Web Service

### 3. Get Your Render URL

After deployment completes (2-5 min), copy the URL:
```
https://voice-relay-realtime.onrender.com
```

### 4. Update Twilio Router

**In Supabase Dashboard**:
1. Go to **Edge Functions** → **twilio-router**
2. Click **Settings** → **Environment Variables**
3. Add Environment Variable:
   - **Key**: `TWILIO_STREAM_URL`
   - **Value**: `wss://voice-relay-realtime.onrender.com` (use your Render URL)
4. Click **Save**
5. **Redeploy** the function

✅ The router is already configured to use this environment variable - no code changes needed!

### 5. Verify Configuration

**CRITICAL: Verify router is using Render.com**

In Supabase Dashboard → Edge Functions → twilio-router → Logs:
- Look for: `wsUrl` starting with `wss://voice-relay-realtime.onrender.com`
- ❌ If it shows Supabase URL: `TWILIO_STREAM_URL` not set or router not redeployed

### 6. Test

Call your Twilio number - should work for any duration (no 6-minute limit)!

---

## ✅ Success Indicators

- ✅ Health check: `curl https://your-url.onrender.com/health` returns `{"status":"healthy"}`
- ✅ Render logs show: `🚀 Twilio Voice Realtime service running on port 8000`
- ✅ Router logs show: `wsUrl` with `wss://voice-relay-realtime.onrender.com`
- ✅ Test call connects and AI responds
- ✅ Calls work beyond 6 minutes (no cutoff)

---

## 🐛 Common Issues

**Issue**: Service won't start
- **Fix**: Check all 3 environment variables are set in Render Dashboard

**Issue**: Calls still cut at 6 minutes  
- **Fix**: Verify `TWILIO_STREAM_URL` env var is set correctly:
  - ✅ Key must be: `TWILIO_STREAM_URL` (exact match)
  - ✅ Value must start with: `wss://` (WebSocket Secure)
  - ✅ Example: `wss://voice-relay-realtime.onrender.com`
  - ❌ NOT `https://` (wrong protocol)
  - ❌ NOT `RENDER_VOICE_URL` (wrong key name)
- **Fix**: Ensure router was redeployed after adding env var

**Issue**: "Free instance sleeping"
- **Fix**: Upgrade to Starter plan ($7/month) for always-on service

**Issue**: Router still uses Supabase
- **Fix**: Check router logs, verify env var name is `TWILIO_STREAM_URL` exactly

---

## 📋 Complete Guide

See `RENDER_DEPLOYMENT_GUIDE.md` for detailed instructions and troubleshooting.
