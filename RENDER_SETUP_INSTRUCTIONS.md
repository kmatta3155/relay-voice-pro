# 🚀 Render.com Setup - Exact Instructions

## What This Solves

Your voice calls are cutting off at **6 minutes** because Supabase Edge Functions has a **400-second WebSocket limit**. By deploying to Render.com, your calls can run **unlimited duration** (hours if needed).

---

## 📋 What You Need

Before starting, get these values from your Replit Secrets:

1. `SUPABASE_URL`
2. `SUPABASE_SERVICE_ROLE_KEY`  
3. `OPENAI_API_KEY`

---

## ⚡ Quick Setup (10 Minutes)

### Step 1: Push Code to GitHub

```bash
# Make sure render/ directory is in your repo
git add render/
git commit -m "Add Render.com deployment"
git push origin main
```

### Step 2: Create Render.com Service

1. Go to: **https://dashboard.render.com/**
2. Click: **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `voice-relay-realtime` |
| **Region** | Oregon (USA) or your preferred region |
| **Root Directory** | `render` |
| **Runtime** | **Docker** |
| **Instance Type** | **Starter ($7/month)** or higher |

5. Click **"Create Web Service"** (don't deploy yet)

### Step 3: Set Environment Variables in Render

Click **"Environment"** tab and add:

```bash
SUPABASE_URL = [paste your value]
SUPABASE_SERVICE_ROLE_KEY = [paste your value]
OPENAI_API_KEY = [paste your value]
```

**How to add**:
- Click "+ Add Environment Variable"
- Enter Key and Value  
- Repeat for all 3
- Click **"Save Changes"**

### Step 4: Deploy

1. Render will automatically build and deploy (2-5 minutes)
2. Wait for: "Your service is live" message
3. **Copy your service URL**: `https://voice-relay-realtime.onrender.com`

### Step 5: Configure Supabase Router

⚠️ **CRITICAL: This is the most important step**

1. Go to **Supabase Dashboard**
2. Navigate to: **Edge Functions** → **twilio-router**
3. Click: **Settings** → **Environment Variables**
4. Add environment variable:

```bash
Key:   TWILIO_STREAM_URL
Value: wss://voice-relay-realtime.onrender.com
```

⚠️ **Must use `wss://` (WebSocket Secure) - NOT `https://`**

5. Click **"Save"**
6. Click **"Redeploy"** (this is required!)

### Step 6: Verify

**Test health endpoint**:
```bash
curl https://voice-relay-realtime.onrender.com/health
```

**Expected**: `{"status":"healthy","service":"twilio-voice-realtime"}`

**Check router logs** (Supabase Dashboard → Edge Functions → twilio-router → Logs):
- Look for: `wsUrl` starting with `wss://voice-relay-realtime.onrender.com`
- ❌ If you see Supabase URL: Router wasn't redeployed after adding env var

### Step 7: Test Call

1. Call your Twilio number
2. AI should answer
3. **Talk for more than 6 minutes** - no cutoff!

---

## ✅ Success Checklist

- [ ] Render service shows "Live" status
- [ ] Health endpoint returns `{"status":"healthy"}`
- [ ] All 3 environment variables set in Render
- [ ] `TWILIO_STREAM_URL` set in Supabase router (with `wss://`)
- [ ] Router redeployed after adding env var
- [ ] Router logs show Render URL in `wsUrl`
- [ ] Test call works beyond 6 minutes

---

## 🐛 Troubleshooting

### Calls Still Cut at 6 Minutes

**Most common issue**: Router not using Render URL

**Check**:
1. Supabase Dashboard → Edge Functions → twilio-router → Settings
2. Verify `TWILIO_STREAM_URL` exists
3. Value must be exactly: `wss://voice-relay-realtime.onrender.com`
4. **Must start with `wss://`** (not `https://`)
5. Router must be redeployed after adding env var

**Wrong env var names that won't work**:
- ❌ `RENDER_VOICE_URL`
- ❌ `VOICE_FUNCTION_URL`  
- ❌ `RENDER_URL`
- ✅ `TWILIO_STREAM_URL` (correct)

### Service Won't Start

**Check Render logs** (Dashboard → Your Service → Logs):
- Look for environment variable errors
- Verify all 3 variables are set correctly

### "Free Instance Sleeping"

**Problem**: Free tier sleeps after 15 minutes of inactivity

**Solution**: Upgrade to Starter plan ($7/month) for always-on service

---

## 📊 What's Deployed Where

### Supabase (Keep Everything Here)
- ✅ Database (PostgreSQL)
- ✅ Authentication
- ✅ twilio-router (TwiML generation)
- ✅ All other Edge Functions
- ✅ Storage
- ✅ Knowledge base

### Render.com (Only This)
- ✅ twilio-voice-realtime (WebSocket function)

**Why**: Render has no WebSocket time limits, Supabase has 6-minute limit

---

## 💰 Cost

- **Render Starter**: $7/month
- **What you get**: Unlimited call duration (vs 6-minute Supabase limit)

---

## 🔄 Rollback (If Needed)

To go back to Supabase (with 6-minute limit):

1. Supabase Dashboard → Edge Functions → twilio-router → Settings
2. **Delete** `TWILIO_STREAM_URL` environment variable
3. Redeploy router
4. Calls will use Supabase (6-minute limit returns)

---

## 📚 More Documentation

- **Quick Start**: `render/QUICK_START.md`
- **Full Guide**: `render/RENDER_DEPLOYMENT_GUIDE.md`
- **Architecture**: `render/MIGRATION_SUMMARY.md`

---

## 🎯 Next Steps

1. Follow steps 1-7 above
2. Test with a long call (>6 minutes)
3. Monitor Render logs for first few calls
4. You're done! 🎉

**Questions?** Check the troubleshooting section or review the detailed guides in `render/` directory.
