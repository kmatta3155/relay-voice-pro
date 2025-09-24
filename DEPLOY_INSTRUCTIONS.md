# Manual Deployment Instructions for Supabase Edge Functions

Since Docker is not running on your Windows machine, you need to deploy the functions manually through the Supabase Dashboard.

## Deploy twilio-voice-stream-minimal Function

1. **Go to the Supabase Dashboard:**
   https://supabase.com/dashboard/project/gnqqktmslswgjtvxfvdo/functions

2. **Click "New Function"** button

3. **Enter Function Details:**
   - Name: `twilio-voice-stream-minimal`
   - Click "Create function"

4. **Copy the Function Code:**
   - Click on the function name to open the editor
   - Delete the default code
   - Copy ALL the code from: `supabase/functions/twilio-voice-stream-minimal/index.ts`
   - Paste it into the editor

5. **Deploy:**
   - Click "Deploy" button
   - Wait for deployment to complete (should show green checkmark)

## Update twilio-router Function (Already Deployed)

1. **In the same Functions page, click on `twilio-router`**

2. **Update Line 106:**
   Change from:
   ```typescript
   const wsUrl = streamUrlEnv || `wss://${host}/functions/v1/twilio-voice-stream`
   ```
   To:
   ```typescript
   const wsUrl = streamUrlEnv || `wss://${host}/functions/v1/twilio-voice-stream-minimal`
   ```

3. **Deploy the Updated Router:**
   - Click "Deploy" button
   - Wait for deployment to complete

## Test the Deployment

After both functions are deployed:

1. **Check Function Status:**
   ```bash
   node check-logs.cjs
   ```
   Should show both functions as "DEPLOYED and RESPONDING"

2. **Make a Test Call:**
   - Call: **919-420-3058**
   - You should hear:
     - 200ms silence
     - 2 seconds of 440Hz tone (clear dial tone)
     - Then silence

## View Logs

In the Supabase Dashboard:
1. Go to Functions page
2. Click on `twilio-voice-stream-minimal`
3. Click "Logs" tab to see real-time logs

If you still hear static after this deployment, the logs will show exactly what's happening.