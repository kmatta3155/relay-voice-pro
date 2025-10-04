# Voice Relay Pro - Twilio Voice Realtime Function
# Deployed on Render.com to bypass Supabase's 6-minute WebSocket limit

FROM denoland/deno:1.40.0

# Set working directory
WORKDIR /app

# Copy the voice function
COPY twilio-voice-realtime.ts .

# Expose the port (Render provides PORT env var, default to 8000)
EXPOSE 8000

# Health check endpoint is built into the function
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD deno run --allow-net -e "fetch('http://localhost:8000/health').then(r => r.ok ? Deno.exit(0) : Deno.exit(1))"

# Run the Deno server with required permissions
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "twilio-voice-realtime.ts"]
