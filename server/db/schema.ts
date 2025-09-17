import { pgTable, uuid, text, timestamp, integer, boolean, time, date, numeric, jsonb, varchar, serial, check, index } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ========== CORE TABLES ==========

// Users (profiles)
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  full_name: text('full_name'),
  image_url: text('image_url'),
  active_tenant_id: uuid('active_tenant_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Tenants
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  created_by: uuid('created_by'),
  stripe_customer_id: text('stripe_customer_id'),
  subscription_status: text('subscription_status'),
  price_id: text('price_id'),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Memberships
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid('user_id').notNull(),
  tenant_id: uuid('tenant_id').notNull(),
  role: text('role').notNull().default('AGENT'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Tenant Users (alternative membership table)
export const tenant_users = pgTable('tenant_users', {
  tenant_id: uuid('tenant_id').notNull(),
  user_id: uuid('user_id').notNull(),
  role: text('role').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
}, (table) => ({
  pk: [table.tenant_id, table.user_id]
}));

// ========== BUSINESS DATA TABLES ==========

// Services
export const services = pgTable('services', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  duration_minutes: integer('duration_minutes').notNull().default(30),
  price: numeric('price'),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Business Hours
export const business_hours = pgTable('business_hours', {
  tenant_id: uuid('tenant_id').notNull(),
  dow: integer('dow').notNull(), // 0=Sunday, 1=Monday, etc.
  open_time: time('open_time').notNull(),
  close_time: time('close_time').notNull(),
  is_closed: boolean('is_closed').default(false),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => ({
  pk: [table.tenant_id, table.dow]
}));

// Holidays
export const holidays = pgTable('holidays', {
  tenant_id: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  name: text('name'),
}, (table) => ({
  pk: [table.tenant_id, table.day]
}));

// Tenant Branding
export const tenant_branding = pgTable('tenant_branding', {
  tenant_id: uuid('tenant_id').primaryKey(),
  logo_url: text('logo_url'),
  brand_color: text('brand_color').default('#6d28d9'),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// ========== COMMUNICATION TABLES ==========

// Leads
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  source: text('source'),
  status: text('status'),
  value: integer('value'),
  notes: text('notes'),
  score: integer('score'),
  score_tier: text('score_tier'),
  intent: text('intent'),
  owner_id: uuid('owner_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Threads
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  with: text('with').notNull(),
  channel: text('channel').notNull(), // sms, web, instagram, facebook
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Messages
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  thread_id: uuid('thread_id').notNull(),
  from: text('from').notNull(), // lead | agent | system
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow()
});

// Calls
export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  from: text('from').notNull(),
  to: text('to'),
  outcome: text('outcome'),
  duration: integer('duration'),
  summary: text('summary'),
  csat_score: integer('csat_score'),
  at: timestamp('at', { withTimezone: true }).defaultNow()
});

// ========== AI & KNOWLEDGE TABLES ==========

// Knowledge Sources
export const knowledge_sources = pgTable('knowledge_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  source_url: text('source_url'),
  source_type: text('source_type').notNull().default('web'), // web|gmb|manual|file
  title: text('title'),
  meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamptz('created_at').notNull().defaultNow()
});

// Knowledge Chunks (with vector embeddings)
export const knowledge_chunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  source_id: uuid('source_id'),
  content: text('content').notNull(),
  token_count: integer('token_count').notNull().default(0),
  embedding: sql`vector(3072)`, // OpenAI text-embedding-3-large
  meta: jsonb('meta').default(sql`'{}'::jsonb`),
  created_at: timestamptz('created_at').notNull().defaultNow()
});

// Business Quick Answers
export const business_quick_answers = pgTable('business_quick_answers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  question_type: text('question_type').notNull(),
  question_pattern: text('question_pattern').notNull(),
  answer: text('answer').notNull(),
  confidence: numeric('confidence').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// Unresolved Questions
export const unresolved_questions = pgTable('unresolved_questions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  asked_by: uuid('asked_by'),
  question: text('question').notNull(),
  call_id: text('call_id'),
  status: text('status').notNull().default('open'), // open|auto_answered|resolved|ignored
  notes: text('notes'),
  created_at: timestamptz('created_at').notNull().defaultNow()
});

// AI Agents
export const ai_agents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  system_prompt: text('system_prompt'),
  voice_provider: text('voice_provider'),
  voice_id: text('voice_id'),
  status: text('status').default('training'), // training|ready|error
  tools: jsonb('tools').default(sql`'{}'::jsonb`),
  overrides: jsonb('overrides').default(sql`'{}'::jsonb`),
  version: integer('version').default(1),
  model: text('model').default('gpt-4o-mini'),
  mode: text('mode').notNull().default('simulation'), // simulation|live
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Agent Training Jobs
export const agent_training_jobs = pgTable('agent_training_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  agent_id: uuid('agent_id').notNull(),
  status: text('status').default('pending'), // pending|running|completed|failed
  progress: integer('progress').default(0),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true })
});

// Agent Runtimes  
export const agent_runtimes = pgTable('agent_runtimes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  agent_id: uuid('agent_id').notNull(),
  provider: text('provider').notNull(),
  settings: jsonb('settings').default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// Agent Settings
export const agent_settings = pgTable('agent_settings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  twilio_number: text('twilio_number'),
  forward_number: text('forward_number'),
  after_hours_voicemail: boolean('after_hours_voicemail').default(true),
  greeting: text('greeting'),
  website_url: text('website_url'),
  ai_sms_autoreplies: boolean('ai_sms_autoreplies').default(false),
  agent_ws_url: text('agent_ws_url'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// ========== MISC TABLES ==========

// Appointments
export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  title: text('title').notNull(),
  customer: text('customer').notNull(),
  start_at: timestamp('start_at', { withTimezone: true }).notNull(),
  end_at: timestamp('end_at', { withTimezone: true }).notNull(),
  staff: text('staff'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// Automations
export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  when: text('when'),
  action: text('action'),
  status: text('status'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Subscriptions
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  provider: text('provider').notNull().default('stripe'),
  customer_id: text('customer_id').notNull(),
  status: text('status').notNull(),
  price_id: text('price_id'),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

// Invites
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('pending'),
  token: uuid('token').default(sql`gen_random_uuid()`),
  expires_at: timestamp('expires_at', { withTimezone: true }).default(sql`now() + interval '14 days'`),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// Numbers (Twilio phone numbers)
export const numbers = pgTable('numbers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id').notNull(),
  phone_number: text('phone_number').notNull(),
  twilio_sid: text('twilio_sid').notNull(),
  status: text('status').default('active'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// Logs
export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenant_id: uuid('tenant_id'),
  level: text('level').notNull(), // info|warn|error|debug
  message: text('message').notNull(),
  meta: jsonb('meta').default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// ========== RELATIONS ==========

export const profilesRelations = relations(profiles, ({ many, one }) => ({
  memberships: many(memberships),
  activeTenant: one(tenants, {
    fields: [profiles.active_tenant_id],
    references: [tenants.id]
  })
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  leads: many(leads),
  services: many(services),
  threads: many(threads),
  calls: many(calls),
  appointments: many(appointments),
  automations: many(automations),
  subscriptions: many(subscriptions)
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(profiles, {
    fields: [memberships.user_id],
    references: [profiles.id]
  }),
  tenant: one(tenants, {
    fields: [memberships.tenant_id],
    references: [tenants.id]
  })
}));

export const servicesRelations = relations(services, ({ one }) => ({
  tenant: one(tenants, {
    fields: [services.tenant_id],
    references: [tenants.id]
  })
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [leads.tenant_id],
    references: [tenants.id]
  }),
  owner: one(profiles, {
    fields: [leads.owner_id],
    references: [profiles.id]
  })
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [threads.tenant_id],
    references: [tenants.id]
  }),
  messages: many(messages)
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  tenant: one(tenants, {
    fields: [messages.tenant_id],
    references: [tenants.id]
  }),
  thread: one(threads, {
    fields: [messages.thread_id],
    references: [threads.id]
  })
}));

export const callsRelations = relations(calls, ({ one }) => ({
  tenant: one(tenants, {
    fields: [calls.tenant_id],
    references: [tenants.id]
  })
}));

export const knowledgeSourcesRelations = relations(knowledge_sources, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [knowledge_sources.tenant_id],
    references: [tenants.id]
  }),
  chunks: many(knowledge_chunks)
}));

export const knowledgeChunksRelations = relations(knowledge_chunks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [knowledge_chunks.tenant_id],
    references: [tenants.id]
  }),
  source: one(knowledge_sources, {
    fields: [knowledge_chunks.source_id],
    references: [knowledge_sources.id]
  })
}));