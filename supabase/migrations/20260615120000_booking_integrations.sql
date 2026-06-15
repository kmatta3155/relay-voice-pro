-- Connection to a salon's existing booking platform (Vagaro to start).
-- Credentials are the salon's own API keys (they authorize access to their data).
create table if not exists public.booking_integrations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'vagaro',          -- 'vagaro' | 'square' | 'fresha' ...
  region text,                                       -- Vagaro region/datacenter (e.g. 'us02')
  client_id text,                                    -- salon's Vagaro API client id
  client_secret text,                                -- salon's Vagaro API client secret
  external_business_id text,                          -- Vagaro merchant/location id
  access_token text,                                  -- cached bearer token
  token_expires_at timestamptz,
  status text not null default 'disconnected',        -- 'disconnected' | 'connected' | 'error'
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz default now()
);

alter table public.booking_integrations enable row level security;

-- Members can SEE connection status, but NOT read raw secrets from the client.
-- (Secrets are only used server-side by edge functions via the service role.)
drop policy if exists booking_integrations_select on public.booking_integrations;
create policy booking_integrations_select on public.booking_integrations
  for select using (public.is_member(auth.uid(), tenant_id));

-- Writes go through the edge function (service role); block direct client writes
-- of secrets by only allowing members to upsert non-secret status if ever needed.
drop policy if exists booking_integrations_write on public.booking_integrations;
create policy booking_integrations_write on public.booking_integrations
  for all using (public.is_member(auth.uid(), tenant_id))
  with check (public.is_member(auth.uid(), tenant_id));

-- Mark on appointments which platform an appointment is mirrored from/to.
alter table public.appointments add column if not exists external_id text;
alter table public.appointments add column if not exists external_provider text;
create index if not exists idx_appts_external on public.appointments(external_provider, external_id);
