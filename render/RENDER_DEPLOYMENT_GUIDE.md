# Render.com Deployment Guide - Voice Relay Pro

## 🎯 Why Render.com?

**Problem**: Supabase Edge Functions has a **400-second (6.5 minute) WebSocket limit** that cuts off longer phone calls.

**Solution**: Deploy the voice function to Render.com, which has **no time limits** for WebSocket connections.

---

## 📋 Prerequisites

Before starting, ensure you have:

- ✅ Render.com account (free tier works, but Paid plan recommended for production)
- ✅ GitHub repository with your code
- ✅ The following secrets from your Replit environment:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`

---

## 🚀 Step-by-Step Deployment

### Step 1: Prepare Your Repository

1. **Commit the render/ directory** to your GitHub repository:
   ```bash
   git add render/
   git commit -m "Add Render.com deployment for voice function"
   git push origin main
   ```

2. **Verify files are in GitHub**:
   - `render/Dockerfile`
   - `render/twilio-voice-realtime.ts`
   - `render/RENDER_DEPLOYMENT_GUIDE.md` (this file)

---

### Step 2: Create New Web Service on Render

1. **Go to Render Dashboard**: https://dashboard.render.com/

2. **Click "New +" → "Web Service"**

3. **Connect GitHub Repository**:
   - Click "Connect account" if not already connected
   - Select your Voice Relay Pro repository
   - Click "Connect"

---

### Step 3: Configure Web Service

Fill in the following settings:

#### Basic Settings

| Field | Value |
|-------|-------|
| **Name** | `voice-relay-realtime` (or your preferred name) |
| **Region** | Choose closest to your users (e.g., Oregon USA, Frankfurt EU) |
| **Branch** | `main` |
| **Root Directory** | `render` |
| **Runtime** | `Docker` |

#### Docker Settings

| Field | Value |
|-------|-------|
| **Dockerfile Path** | `render/Dockerfile` |

#### Instance Settings

| Field | Value |
|-------|-------|
| **Instance Type** | **Starter** ($7/month) or **Standard** ($25/month) recommended |
| **Auto-Deploy** | ✅ Enabled (deploys automatically on git push) |

⚠️ **Important**: Free tier may have limitations. For production, use at least **Starter** plan.

---

### Step 4: Set Environment Variables

Click **"Environment"** tab and add these variables:

| Key | Value | Where to Get It |
|-----|-------|-----------------|
| `SUPABASE_URL` | Your Supabase project URL | Replit Secrets or Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Replit Secrets or Supabase Dashboard → Settings → API |
| `OPENAI_API_KEY` | Your OpenAI API key | Replit Secrets or OpenAI Dashboard |
| `PORT` | `8000` | (Optional - Render sets this automatically) |

**How to add variables**:
1. Click **"+ Add Environment Variable"**
2. Enter Key and Value
3. Click **"Save"** (not "Save Changes" yet)
4. Repeat for all variables
5. Click **"Save Changes"** at the bottom when done

---

### Step 5: Deploy

1. **Review all settings** one final time

2. **Click "Create Web Service"** at the bottom

3. **Wait for deployment** (2-5 minutes):
   - You'll see build logs in real-time
   - First deployment takes longer (downloads Deno image)
   - Look for: `🚀 Twilio Voice Realtime service running on port 8000`

4. **Service URL**: Once deployed, Render provides a URL like:
   ```
   https://voice-relay-realtime.onrender.com
   ```
   
   **Save this URL** - you'll need it for Twilio configuration.

---

## 🔧 Update Twilio Configuration

Now configure the router to use Render.com for WebSocket connections.

### ⚠️ CRITICAL: Use Environment Variable (DO NOT Edit Code)

The router is already configured to support external WebSocket URLs via the `TWILIO_STREAM_URL` environment variable. **You only need to set this variable** - no code changes required.

**In Supabase Dashboard**:

1. Go to **Edge Functions** → **twilio-router**
2. Click **Settings** → **Environment Variables**
3. Add Environment Variable:
   - **Key**: `TWILIO_STREAM_URL`
   - **Value**: `wss://voice-relay-realtime.onrender.com` ⚠️ **Must use `wss://` (WebSocket Secure)**
4. Click **Save**
5. **Redeploy** the router function

**✅ Correct Configuration Example**:
```bash
TWILIO_STREAM_URL=wss://voice-relay-realtime.onrender.com
```

**❌ Common Mistakes to Avoid**:
- ❌ Using `https://` instead of `wss://` (breaks WebSocket connection)
- ❌ Using `http://` or `ws://` (not secure)
- ❌ Editing router code directly (defeats env-based switching)
- ❌ Using wrong env var name like `RENDER_VOICE_URL` (won't work)

---

## ✅ Testing the Deployment

### 1. Verify Render Service Health

Test the health endpoint:
```bash
curl https://voice-relay-realtime.onrender.com/health
```

✅ **Expected response**:
```json
{"status":"healthy","service":"twilio-voice-realtime"}
```

❌ **If it fails**: Check Render logs, verify environment variables are set

### 2. Verify Supabase Router Configuration

**Critical verification** - Ensure router will use Render.com:

```bash
# In Supabase Dashboard → Edge Functions → twilio-router → Settings
# Verify TWILIO_STREAM_URL is set to: wss://voice-relay-realtime.onrender.com
```

⚠️ **Must use `wss://` protocol** (not `https://`)

### 3. Check Render Logs

In Render Dashboard:
1. Click your service name
2. Click **"Logs"** tab
3. Look for:
   - `🚀 Twilio Voice Realtime service running on port 8000`
   - `Environment check` showing all 3 variables present
   - `hasSupabaseUrl: true`
   - `hasSupabaseKey: true`
   - `hasOpenAIKey: true`

### 4. Make a Test Call

1. Call your Twilio number
2. The AI should answer (no 6-minute limit!)
3. Check Render logs for:
   - `WebSocket upgrade request`
   - `Twilio stream started`
   - `OpenAI WebSocket connected successfully`
   - `Session health check` (appears every 30 seconds)
   - Conversation events

### 5. Verify Router Used Render URL

Check router logs in Supabase Dashboard:
1. Edge Functions → twilio-router → Logs
2. Look for: `Final stream parameters` with `wsUrl` starting with `wss://voice-relay-realtime.onrender.com`

✅ **If you see Render URL**: Configuration correct!
❌ **If you see Supabase URL**: `TWILIO_STREAM_URL` env var not set or router not redeployed

---

## 📊 Monitoring & Maintenance

### View Logs

**Real-time logs**:
- Render Dashboard → Your Service → **Logs** tab

**Download logs**:
```bash
# Install Render CLI
npm install -g @render/cli

# Login
render login

# View logs
render logs --service voice-relay-realtime --tail
```

### Monitor Performance

In Render Dashboard → **Metrics** tab:
- CPU usage
- Memory usage
- Request count
- Response times

### Check WebSocket Connections

Look for these log patterns:
- ✅ `Twilio stream started` - Call connected
- ✅ `OpenAI WebSocket connected successfully` - AI ready
- ⚠️ `Approaching OpenAI 30-minute session limit` - Long call (expected)
- ✅ `Session health check` - Keepalive monitoring (every 30s)

---

## 🔄 Updating the Service

### Automatic Updates (Recommended)

With Auto-Deploy enabled:
1. Make changes to `render/twilio-voice-realtime.ts`
2. Commit and push to GitHub
3. Render automatically rebuilds and redeploys

### Manual Deploy

1. Go to Render Dashboard → Your Service
2. Click **"Manual Deploy"** → **"Deploy latest commit"**

---

## 🐛 Troubleshooting

### Issue: "Environment variable missing"

**Solution**: 
1. Check all 3 required variables are set in Render Dashboard
2. Values must match exactly (no extra spaces)
3. Click "Save Changes" after adding variables

### Issue: "WebSocket connection failed"

**Solution**:
1. Verify health check works: `curl https://your-url.onrender.com/health`
2. Check Render logs for errors
3. Ensure Twilio is sending to correct URL

### Issue: "Free instance spins down"

**Problem**: Free tier instances sleep after 15 minutes of inactivity.

**Solution**: Upgrade to Starter ($7/month) or higher for always-on instances.

### Issue: "Calls still cut off at 6 minutes"

**Solution**: 
1. Verify Twilio is using Render URL (not Supabase)
2. Check `twilio-router` function points to Render
3. Test with direct Render URL in Twilio webhook

---

## 💰 Pricing

### Render.com Costs

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0/month | 750 hrs/month, sleeps after 15min inactivity |
| **Starter** | $7/month | Always-on, 0.5GB RAM, no sleep |
| **Standard** | $25/month | Always-on, 2GB RAM, better performance |

**Recommendation**: Use **Starter** for production (reliable, affordable, no sleep).

### What You Save

- ❌ Supabase: 6-minute limit (unusable for long calls)
- ✅ Render: No time limit + $7/month = **Perfect for production**

---

## 🎯 Architecture Summary

### Before (Supabase Only)
```
Twilio → Supabase Edge Function → OpenAI Realtime API
         ⚠️ 400s WebSocket limit
```

### After (Hybrid)
```
Twilio → Supabase twilio-router → Render.com → OpenAI Realtime API
         ✅ Quick routing           ✅ No time limit
```

**Benefits**:
- ✅ No 6-minute call limit
- ✅ Keep Supabase for database, auth, other functions
- ✅ Minimal code changes
- ✅ Production-ready architecture
- ✅ Easy monitoring and logs

---

## 📚 Additional Resources

- **Render Docs**: https://render.com/docs
- **Render Docker Guide**: https://render.com/docs/docker
- **Deno WebSocket Examples**: https://docs.deno.com/examples/http_server_websocket/
- **OpenAI Realtime API**: https://platform.openai.com/docs/guides/realtime

---

## ✅ Deployment Checklist

Use this checklist to verify your deployment:

- [ ] Code pushed to GitHub (render/ directory)
- [ ] Render.com account created
- [ ] Web Service created with Docker runtime
- [ ] All 3 environment variables set correctly
- [ ] Service deployed successfully (check logs)
- [ ] Health check returns `{"status":"healthy"}`
- [ ] Twilio configuration updated to use Render URL
- [ ] Test call completes successfully
- [ ] No 6-minute cutoff observed
- [ ] Logs show proper WebSocket connections

---

## 🆘 Need Help?

If you encounter issues:

1. **Check Render logs** for error messages
2. **Verify environment variables** are set correctly
3. **Test health endpoint** to confirm service is running
4. **Review Twilio configuration** to ensure correct webhook URL
5. **Check this guide** for troubleshooting section

---

**Deployment Status**: ✅ Ready to deploy
**Estimated Time**: 10-15 minutes
**Difficulty**: Easy (follow steps exactly)
