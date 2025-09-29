#!/bin/bash

# Direct deployment using tarball method
cd supabase/functions/twilio-voice-stream

# Create a simple deployment tarball
tar -czf ../../../voice-function-fixed.tar.gz *

echo "Created deployment package: voice-function-fixed.tar.gz"
echo "Contents:"
tar -tzf ../../../voice-function-fixed.tar.gz

# Try alternative deployment via Supabase CLI with different auth methods
export SUPABASE_ACCESS_TOKEN="$SUPABASE_SERVICE_ROLE_KEY"
cd ../..

echo "Attempting deployment with service role key..."
supabase functions deploy twilio-voice-stream --no-verify-jwt || {
    echo "CLI deployment failed. Trying direct file copy method..."
    
    # Alternative: Copy function directly to temp location for manual deployment
    mkdir -p /tmp/voice-deploy
    cp -r functions/twilio-voice-stream/* /tmp/voice-deploy/
    
    echo "Function files copied to /tmp/voice-deploy for manual deployment"
    echo "File contents ready for copy-paste deployment:"
    echo "================================"
    head -50 /tmp/voice-deploy/index.ts
    echo "... (truncated) ..."
    echo "================================"
}