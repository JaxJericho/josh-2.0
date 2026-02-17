alter table public.stripe_events
  add column if not exists processed_at timestamptz,
  add column if not exists processing_error text;

create index if not exists stripe_events_processed_at_idx
  on public.stripe_events(processed_at);
