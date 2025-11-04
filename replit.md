# Voice Relay Pro - AI Voice Receptionist & Call Management

## Overview

Voice Relay Pro is a comprehensive AI-powered voice receptionist and call management system built for businesses. The application provides 24/7 AI voice reception, intelligent call routing, appointment booking, lead management, and real-time analytics. It's designed as a multi-tenant SaaS platform with robust knowledge management capabilities and integrations with popular booking systems.

The system features a modern React-based dashboard for managing calls, leads, appointments, messages, and business analytics. It includes advanced AI capabilities for conversation intelligence, automated follow-ups, and business knowledge extraction from websites and documents.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### Voice Call Architecture Migration (October 2025)
**Migration from Custom VAD to OpenAI Realtime API for Phone Calls - PRODUCTION READY**

- **Previous Architecture**: Custom client-side VAD → Whisper STT → OpenAI Chat → Azure TTS (complex, quality issues)
- **New Architecture**: OpenAI Realtime API with server-side VAD (simple, production-grade)
- **Key Improvements**:
  - Eliminated false voice detection issues through server-side VAD
  - Reduced latency with single-hop WebSocket architecture
  - Improved audio quality with native μ-law ↔ PCM16 conversion
  - Unified architecture with customer simulation (both use Realtime API)
  - Native RAG integration via function calls
  - Natural conversation flow with automatic turn-taking
  
- **Implementation**: Edge Function `twilio-voice-realtime` bridges Twilio Media Streams to OpenAI Realtime API
  - Proper WebSocket authentication using required subprotocols: `realtime`, `openai-insecure-api-key.{KEY}`, `openai-beta.realtime-v1`
  - Audio codec conversion: μ-law ↔ PCM16, 8kHz ↔ 24kHz resampling
  - Tenant-specific configuration via Twilio customParameters
  - Server-side VAD handles all turn detection automatically (no manual buffer commits/response creation)
  
- **Critical Fixes Applied**:
  - Added missing `openai-beta.realtime-v1` subprotocol for Deno WebSocket authentication
  - Removed manual response creation to prevent "conversation already has active response" errors
  - Server-side VAD now handles all turn-taking automatically
  - Tenant ID extraction from Twilio customParameters (URL params stripped during WebSocket upgrade)
  
- **Status**: ✅ Production-ready, fully tested, natural conversations working perfectly

### Render.com Deployment Migration (October 2025)
**Solving Supabase's 6-Minute WebSocket Limit - PRODUCTION READY**

- **Problem Identified**: Supabase Edge Functions has a **400-second (6m 40s) wall clock limit** for WebSocket connections, causing calls to disconnect
- **Solution**: Hybrid architecture deploying voice function to Render.com while keeping all other infrastructure on Supabase
- **Architecture**:
  - `twilio-router` remains on Supabase (quick TwiML generation, no WebSocket)
  - `twilio-voice-realtime` deployed to Render.com (unlimited WebSocket duration)
  - Router uses `TWILIO_STREAM_URL` environment variable to route to Render
  - Render service still integrates with Supabase for tenant config and knowledge base
  
- **Implementation Details**:
  - Standalone Deno service on Render.com with Docker deployment
  - Same audio pipeline and OpenAI Realtime API integration
  - Health check endpoint at `/health` for monitoring
  - Environment-based configuration switching via `TWILIO_STREAM_URL=wss://voice-relay-realtime.onrender.com`
  - **Critical**: Must use `wss://` protocol (WebSocket Secure), not `https://`
  
- **Deployment Files** (in `render/` directory):
  - `Dockerfile` - Docker configuration for Deno runtime
  - `twilio-voice-realtime.ts` - Standalone voice service
  - `QUICK_START.md` - 5-minute deployment guide
  - `RENDER_DEPLOYMENT_GUIDE.md` - Complete setup instructions
  - `MIGRATION_SUMMARY.md` - Architecture overview and testing
  
- **Cost**: $7/month for Render.com Starter plan (always-on, no WebSocket limits)
- **Benefits**: 
  - ✅ No call duration limits (vs 6-minute Supabase cutoff)
  - ✅ Keep Supabase for database, auth, storage, other functions
  - ✅ Simple environment variable switch between architectures
  - ✅ Production-ready with health checks and monitoring
  - ✅ Easy rollback (remove `TWILIO_STREAM_URL` env var)
  
- **Status**: ✅ Implementation complete, documentation verified, ready for production deployment

### Feature Enhancements (November 2025)
**AI Receptionist Improvements - IN PROGRESS**

Five major improvements to enhance Voice Relay Pro's functionality:

1. **✅ Knowledge Base Auto-Extraction** (COMPLETE)
   - Enhanced `supabase/functions/crawl-ingest/index.ts` to extract structured business data
   - AI now extracts: timezone, cancellation policy, booking policy, deposit policy from websites
   - Implemented exponential backoff retry logic for OpenAI rate limiting (429 errors)
   - Auto-populates `tenant_settings` table with `auto_extracted` flag
   
2. **⚠️ Appointment Management** (PARTIAL - Needs Business Hours Validation)
   - Added `reschedule_appointment` and `cancel_appointment` AI functions
   - Reschedule: Finds existing appointment, checks conflicts, updates to new time
   - Cancel: Sets appointment status to 'cancelled', enforces basic policy checks
   - **TODO**: Add full business hours time range validation for reschedule
   - **TODO**: Implement structured cancellation policy enforcement (hours-based, not text search)

3. **✅ Business Hours Configuration** (COMPLETE)
   - Built comprehensive Settings page (`src/pages/SettingsPage.tsx`)
   - Features: Business hours editor (7 days), timezone selector, policy text areas
   - Shows auto-extraction indicator when data comes from website crawl
   - Saves to `business_hours` and `tenant_settings` tables
   
4. **❌ SMS Notifications** (NOT STARTED)
   - Planned: Send confirmations after booking, rescheduling, canceling
   - Planned: Use tenant's Twilio number as sender
   - Planned: Include appointment details and add-to-calendar links
   
5. **❌ Lead Scoring & Pipeline** (NOT STARTED)
   - Planned: Add `pipeline_stage` column to leads (schema updated)
   - Planned: Auto-score based on call outcome (appointment_booked=100pts, inquiry=30pts, etc.)
   - Planned: Visual pipeline in Leads dashboard with drag-and-drop

- **Database Schema Updates**:
  - Added `tenant_settings` table with timezone and policy fields
  - Added `pipeline_stage` column to `leads` table
  - Added `status` and `customer_phone` columns to `appointments` table
  
- **Status**: 2/5 complete, 1 partial, 2 pending

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for fast development
- **UI Library**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design system and HSL color tokens
- **State Management**: React hooks with @tanstack/react-query for server state
- **Routing**: React Router with hash-based navigation for SPA structure
- **Animation**: Framer Motion for smooth transitions and interactions

### Backend Architecture
- **Database**: Supabase (PostgreSQL) with Row Level Security (RLS)
- **Authentication**: Supabase Auth with multiple providers (email, OAuth, SMS)
- **Real-time**: Supabase Realtime for live updates
- **Edge Functions**: Serverless functions for complex operations (billing, notifications, admin)
- **File Storage**: Supabase Storage for document and media handling

### Data Storage Solutions
- **Primary Database**: PostgreSQL via Supabase with comprehensive schema
- **Core Tables**: profiles, tenants, memberships, leads, appointments, calls, messages, threads
- **Knowledge System**: Specialized tables for RAG (Retrieval-Augmented Generation) including knowledge_sources, knowledge_chunks
- **Multi-tenancy**: Tenant-based data isolation with RLS policies
- **Caching**: Browser storage for session state and query caching via TanStack Query

### Authentication and Authorization
- **Multi-factor Authentication**: TOTP support via Supabase
- **Role-based Access**: Owner, Manager, Agent, Viewer roles with different permissions
- **Session Management**: Persistent sessions with automatic token refresh
- **Tenant Switching**: Users can belong to multiple tenants with active tenant selection
- **Admin System**: Site-wide admin capabilities for platform management

### External Dependencies

#### Third-party Services
- **Supabase**: Backend-as-a-Service providing database, auth, storage, and edge functions
- **Stripe**: Payment processing and subscription billing management
- **Twilio**: Voice calls, SMS messaging, and phone number provisioning
- **OpenAI Realtime API**: Primary voice AI engine for phone calls with server-side VAD, speech recognition, and natural language processing
- **Resend**: Transactional email delivery service
- **Sentry**: Error monitoring and performance tracking

#### APIs and Integrations
- **Booking Systems**: Integrations with Fresha, Square, Vagaro, Acuity, Calendly, Google Calendar, Outlook
- **Firecrawl**: Website crawling and content extraction for knowledge base building
- **PDF.js**: Client-side PDF parsing for document knowledge extraction
- **WebRTC**: Real-time audio communication for voice testing and demos

#### Development Tools
- **Vite**: Fast build tool and development server
- **ESLint**: Code linting with TypeScript support
- **Tailwind CSS**: Utility-first CSS framework
- **Drizzle ORM**: Type-safe database queries (server-side)
- **Lovable Tagger**: Development-time component identification

The architecture supports horizontal scaling through Supabase's infrastructure while maintaining data isolation and security through comprehensive RLS policies. The system is designed for high availability with real-time features and can handle multiple concurrent voice calls and conversations.