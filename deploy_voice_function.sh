#!/bin/bash

# Alternative deployment script using Supabase API directly
PROJECT_ID="gnqqktmslswgjtvxfvdo"
SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
FUNCTION_NAME="twilio-voice-stream"

echo "Attempting to deploy $FUNCTION_NAME function..."

# Read the function file
FUNCTION_CONTENT=$(cat supabase/functions/twilio-voice-stream/index.ts)

# Create deployment payload
DEPLOYMENT_DATA=$(jq -n \
  --arg name "$FUNCTION_NAME" \
  --arg slug "$FUNCTION_NAME" \
  --arg code "$FUNCTION_CONTENT" \
  --arg verify_jwt false \
  '{
    name: $name,
    slug: $slug,
    code: $code,
    verify_jwt: ($verify_jwt | test("true"))
  }')

# Try to deploy using Supabase API
curl -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/functions" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$DEPLOYMENT_DATA" \
  --verbose

echo "Deployment attempt completed."