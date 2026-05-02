-- Micah multi-tenant: agencies keyed by Twilio DID + minimal leads for /api/process
-- Apply in Supabase SQL Editor or via CLI.

create extension if not exists "pgcrypto";

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_name text not null,
  twilio_number text not null,
  email text not null,
  domain text
);

create unique index if not exists clients_twilio_number_uidx on public.clients (twilio_number);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  raw_text text,
  created_at timestamptz not null default now()
);

-- If `leads` already existed from legacy Micah with other columns, add missing fields:
alter table public.leads add column if not exists client_id uuid references public.clients (id) on delete set null;
alter table public.leads add column if not exists raw_text text;
alter table public.leads add column if not exists created_at timestamptz default now();
