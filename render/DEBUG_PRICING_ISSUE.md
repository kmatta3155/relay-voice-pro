# 🔍 Debugging Pricing Search Issue

## Current Status

✅ **Function calling is working!** The AI successfully:
- Gets business hours ✅
- Gets location ✅  
- Gets services offered ✅
- **Cannot get prices** ❌

## What We Know

From your logs:
```
[INFO] Knowledge search results {"resultCount":0,"hasResults":false,"queryIntent":"pricing"}
```

The search:
1. ✅ IS executing (function call works)
2. ✅ Detects it's a pricing query (`queryIntent":"pricing"`)
3. ❌ Returns 0 results

But when tested manually:
```bash
curl -X POST "${SUPABASE_URL}/functions/v1/search" \
  -d '{"tenant_id":"...","query":"prices","k":5,"min_score":0.3}'
```

**Returns the pricing data perfectly!** 🎯

## The Mystery

The pricing data exists in your database:
```
"Women's Haircuts ($45), Men's Haircuts ($30), Hair Coloring ($85+)..."
```

So why does the live call return 0 results?

## What I Just Added

Enhanced logging in `render/twilio-voice-realtime.ts` to show:
- **Exact query** the AI is sending
- **Parsed arguments**
- **Query length**
- **Result count** being returned

## Next Steps

### 1. Deploy Enhanced Logging

```bash
git add render/twilio-voice-realtime.ts
git commit -m "Add detailed logging for pricing search debugging"
git push origin main
```

Or manual deploy on Render.com dashboard.

### 2. Make Test Call

Call **+1 (919) 420-3058** and ask:
- "How much is a haircut?"
- "What are your prices?"
- "How much does coloring cost?"

### 3. Check Render.com Logs

Look for these new logs:
```
[INFO] 🔧 handleFunctionCall called {
  "name": "search_knowledge",
  "argsRaw": "{\"query\":\"...actual query here...\"}"
}

[INFO] 📞 Executing knowledge search {
  "query": "...the exact query being searched...",
  "queryLength": 25,
  "parsedArgs": {...}
}

[INFO] Searching knowledge base {
  "query": "...same query...",
  "tenantId": "f3760fe8-4491-4ab1-83dd-4069b1a2d688"
}

[INFO] Knowledge search results {
  "resultCount": 0,  ← Should be 1 or more!
  "hasResults": false
}
```

## Possible Causes

1. **AI sends different query** - Maybe it asks "cost" instead of "price"?
2. **Score threshold too high** - min_score: 0.3 might be filtering results
3. **Embedding mismatch** - The query embedding doesn't match pricing chunk
4. **Tenant ID mismatch** - Wrong tenant being searched (unlikely since hours/location work)

## Share Your Logs

After making a test call, send me the Render.com logs showing:
- The `📞 Executing knowledge search` line (shows actual query)
- The `Knowledge search results` line (shows result count)

This will tell us exactly what's going wrong! 🕵️
