#!/usr/bin/env python3
import requests
import json
import os

# Simple Python deployment script for Supabase function
def deploy_function():
    project_id = "gnqqktmslswgjtvxfvdo"
    service_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    
    # Read the function file
    with open('supabase/functions/twilio-voice-stream/index.ts', 'r') as f:
        function_code = f.read()
    
    # Simple payload
    payload = {
        "slug": "twilio-voice-stream", 
        "body": function_code,
        "verify_jwt": False
    }
    
    headers = {
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json'
    }
    
    # Try different API endpoints
    endpoints = [
        f"https://api.supabase.com/v1/projects/{project_id}/functions/twilio-voice-stream",
        f"https://api.supabase.io/v1/projects/{project_id}/functions/twilio-voice-stream"
    ]
    
    for endpoint in endpoints:
        print(f"Trying {endpoint}...")
        try:
            response = requests.put(endpoint, json=payload, headers=headers, timeout=30)
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            if response.status_code < 400:
                print("✅ Deployment successful!")
                return True
        except Exception as e:
            print(f"❌ Error: {e}")
    
    return False

if __name__ == "__main__":
    success = deploy_function()
    if not success:
        print("❌ All deployment attempts failed")
        # As fallback, at least let's test the current function
        print("\n🔍 Testing current deployed function...")
        
        # Test health endpoint
        try:
            resp = requests.get("https://gnqqktmslswgjtvxfvdo.supabase.co/functions/v1/twilio-voice-stream?health=1")
            health = resp.json()
            print(f"Current version: {health.get('version', 'unknown')}")
            
            # Check if version includes tenant fallback logic
            features = health.get('features', [])
            has_fallback = any('tenant' in str(f).lower() or 'fallback' in str(f).lower() for f in features)
            print(f"Has tenant fallback logic: {has_fallback}")
            
        except Exception as e:
            print(f"Health check failed: {e}")