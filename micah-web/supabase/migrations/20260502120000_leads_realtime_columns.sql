-- Optional columns for OpenAI Realtime + Twilio Media Streams pipeline (micah-realtime-bridge)
alter table public.leads add column if not exists call_sid text;
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists metadata jsonb;

create index if not exists leads_call_sid_idx on public.leads (call_sid);
