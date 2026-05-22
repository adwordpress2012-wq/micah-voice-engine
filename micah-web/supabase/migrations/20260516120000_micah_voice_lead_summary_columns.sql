-- Production Micah Voice lead/session fields used by micah-web.
-- Keeps one lead row per Twilio CallSid and stores summary metadata for call-status notifications.

alter table public.leads add column if not exists tenant_id uuid;
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists updated_at timestamptz;
alter table public.leads add column if not exists call_sid text;
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists metadata jsonb;

create index if not exists leads_call_sid_idx on public.leads (call_sid);
create index if not exists leads_tenant_id_idx on public.leads (tenant_id);
