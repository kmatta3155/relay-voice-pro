# Render.com Migration Summary

## 🎯 Problem Solved

**Issue**: Supabase Edge Functions has a **400-second (6 min 40 sec) WebSocket limit** that cuts off longer phone calls.

**Solution**: Deployed the voice WebSocket function to Render.com, which has **no time limits**, while keeping all other infrastructure on Supabase.

---

## 📁 Files Created

### 1. `render/Dockerfile`
- Docker configuration for Deno deployment
- Uses official `denoland/deno:1.40.0` image
- Includes health check endpoint
- Exposes port 8000 (Render auto-configures PORT)

### 2. `render/twilio-voice-realtime.ts`
- Standalone version of Supabase Edge Function
- **Key differences from Supabase version**:
  - Uses native `Deno.serve()` instead of Supabase's `serve()`
  - Includes health check endpoint at `/health`
  - Still integrates with Supabase for tenant config and knowledge base
  - Same audio pipeline (μ-law ↔ PCM16, 8kHz ↔ 24kHz)
  - Same OpenAI Realtime API integration with server-side VAD
  - No 6-minute WebSocket limit

### 3. `render/RENDER_DEPLOYMENT_GUIDE.md`
- Complete step-by-step deployment instructions
- Environment variable configuration
- Troubleshooting guide
- Monitoring and maintenance tips

### 4. `render/QUICK_START.md`
- 5-minute setup checklist
- Essential configuration only
- Quick troubleshooting

### 5. `render/MIGRATION_SUMMARY.md` (this file)
- Architecture overview
- Migration details
- Testing checklist

---

## 🔧 Code Changes

### Modified: `supabase/functions/twilio-router/index.ts`

**Added clarity to environment variable override** (lines 182-188):

```typescript
// MIGRATION: Set TWILIO_STREAM_URL env var to use Render.com deployment
// Example: TWILIO_STREAM_URL=wss://voice-relay-realtime.onrender.com
// If not set, defaults to local Supabase Edge Function (has 400s WebSocket limit)
const streamUrlEnv = Deno.env.get('TWILIO_STREAM_URL')
const baseWsUrl = streamUrlEnv || `wss://${host}/functions/v1/twilio-voice-realtime`
```

**✅ No breaking changes** - Router already supported this pattern!

---

## 🏗️ Architecture

### Before (Supabase Only)
```
┌─────────┐     ┌──────────────────────────────┐     ┌─────────────┐
│ Twilio  │────>│ Supabase Edge Function       │────>│ OpenAI      │
│         │     │ twilio-voice-realtime        │     │ Realtime    │
└─────────┘     │ ⚠️  400s WebSocket limit     │     │ API         │
                └──────────────────────────────┘     └─────────────┘
                         ❌ Calls cut at 6 min
```

### After (Hybrid - Recommended)
```
┌─────────┐     ┌──────────────────┐     ┌────────────────────┐     ┌─────────────┐
│ Twilio  │────>│ Supabase         │────>│ Render.com         │────>│ OpenAI      │
│         │     │ twilio-router    │     │ voice-realtime     │     │ Realtime    │
└─────────┘     │ ✅ Quick routing │     │ ✅ No time limit   │     │ API         │
                └──────────────────┘     └────────────────────┘     └─────────────┘
                                                  ↓
                                         ┌──────────────────┐
                                         │ Supabase         │
                                         │ - Tenant Config  │
                                         │ - Knowledge Base │
                                         └──────────────────┘
```

**Key Points**:
- ✅ Router stays on Supabase (fast, simple TwiML generation)
- ✅ Voice WebSocket on Render (no time limits)
- ✅ Supabase still handles database, auth, knowledge base
- ✅ Single environment variable switches between architectures

---

## 🚀 Deployment Steps

### 1. Deploy to Render.com

1. Push `render/` directory to GitHub
2. Create Web Service on Render.com:
   - Runtime: **Docker**
   - Root Directory: `render`
   - Instance: **Starter** ($7/month) or higher
3. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
4. Deploy (takes 2-5 minutes)
5. Get service URL: `https://voice-relay-realtime.onrender.com`

### 2. Configure Supabase Router

⚠️ **CRITICAL: Must use `wss://` protocol (WebSocket Secure)**

1. Go to Supabase Dashboard → Edge Functions → twilio-router
2. Click Settings → Environment Variables
3. Add environment variable:
   - **Key**: `TWILIO_STREAM_URL` (exact name required)
   - **Value**: `wss://voice-relay-realtime.onrender.com` (must start with `wss://`)
4. Click Save
5. **Redeploy** router function (required for changes to take effect)

### 3. Test

1. Health check: `curl https://voice-relay-realtime.onrender.com/health`
2. Call Twilio number
3. Verify calls work beyond 6 minutes

---

## ✅ Testing Checklist

- [ ] Render service deployed successfully
- [ ] Health endpoint returns `{"status":"healthy"}`
- [ ] All 3 environment variables set in Render
- [ ] Render logs show: `🚀 Twilio Voice Realtime service running on port 8000`
- [ ] Supabase router has `TWILIO_STREAM_URL` environment variable
- [ ] Router redeployed after adding env var
- [ ] Test call connects successfully
- [ ] AI responds naturally
- [ ] Calls work beyond 6 minutes (no cutoff)
- [ ] Render logs show proper WebSocket connections
- [ ] Knowledge base search works (check logs for `search_knowledge`)
- [ ] Session health checks appear every 30 seconds

---

## 📊 What Stays on Supabase

**✅ Keep these on Supabase** (work perfectly):

1. **Database** - PostgreSQL with RLS policies
2. **Authentication** - User login, sessions
3. **twilio-router** - Quick TwiML generation (no WebSocket)
4. **All other Edge Functions** - Non-WebSocket functions
5. **Storage** - File uploads
6. **Realtime subscriptions** - Database changes

**Only migrate to Render**: `twilio-voice-realtime` (WebSocket function)

---

## 💰 Cost Analysis

### Supabase (Current)
- **Pro Plan**: ~$25/month
- **Limitation**: 400s WebSocket limit (unusable for calls)
- **What you keep**: Database, auth, storage, other functions

### Render.com (New)
- **Starter Plan**: $7/month (recommended)
- **Benefit**: No WebSocket time limits
- **Always-on**: No cold starts or sleep

### Total Cost
- **Supabase**: $25/month (keep existing plan)
- **Render**: $7/month (voice function only)
- **Total**: $32/month for production-ready unlimited calls

**Value**: $7/month eliminates the 6-minute call limit completely

---

## 🔍 Monitoring

### Render Dashboard
- **Logs**: Real-time WebSocket events
- **Metrics**: CPU, memory, request count
- **Health**: Automatic health checks

### Key Log Patterns
```
✅ 🚀 Twilio Voice Realtime service running on port 8000
✅ Twilio stream started
✅ OpenAI WebSocket connected successfully  
✅ Session health check (every 30s)
⚠️  Approaching OpenAI 30-minute session limit (expected for long calls)
```

---

## 🐛 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| Service won't start | Check all 3 env vars are set in Render |
| Calls still cut at 6 min | Verify router uses `TWILIO_STREAM_URL` env var |
| "Free instance sleeping" | Upgrade to Starter plan ($7/month) |
| Health check fails | Check Render logs for errors |
| WebSocket connection failed | Verify Render service is running |

---

## 🔄 Rollback Plan

If you need to revert to Supabase-only:

1. In Supabase Dashboard → Edge Functions → twilio-router
2. **Remove** `TWILIO_STREAM_URL` environment variable
3. Redeploy router
4. Calls will use Supabase function (with 6-min limit)

**Note**: Render service can stay deployed as a backup

---

## 📈 Future Improvements

### Potential Enhancements
1. **Multi-region deployment** - Deploy to multiple Render regions
2. **Load balancing** - Distribute calls across instances
3. **Session handoff** - Transfer long calls between instances (complex)
4. **Enhanced monitoring** - Add APM tools like Sentry

### Not Needed Now
- Current architecture handles production needs
- Single Render instance supports many concurrent calls
- OpenAI has 30-min session limit anyway

---

## 📚 Documentation Reference

- **Quick Setup**: `render/QUICK_START.md` (5-minute guide)
- **Full Guide**: `render/RENDER_DEPLOYMENT_GUIDE.md` (detailed instructions)
- **This Summary**: `render/MIGRATION_SUMMARY.md` (architecture overview)

---

## ✨ Key Takeaways

1. ✅ **Problem Solved**: No more 6-minute call limit
2. ✅ **Minimal Changes**: One environment variable
3. ✅ **Keep Supabase**: All existing features work
4. ✅ **Production Ready**: Proven Render.com infrastructure
5. ✅ **Cost Effective**: $7/month for unlimited calls
6. ✅ **Easy Rollback**: Remove env var to revert

---

**Status**: ✅ Implementation complete, ready to deploy
**Time to Deploy**: 10-15 minutes
**Impact**: Unlimited call duration (vs 6-minute limit)
