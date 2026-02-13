-- Ticket 2.3: Twilio status callback history and idempotency guardrail

create table if not exists public.sms_status_callbacks (
  id uuid primary key default gen_random_uuid(),
  sms_message_id uuid references public.sms_messages(id) on delete set null,
  message_sid text not null,
  message_status text not null,
  payload_fingerprint text not null,
  provider_event_at timestamptz,
  error_code text,
  error_message text,
  received_at timestamptz not null default now()
);

create unique index if not exists sms_status_callbacks_dedupe_idx
  on public.sms_status_callbacks(message_sid, message_status, payload_fingerprint);

create index if not exists sms_status_callbacks_sid_received_idx
  on public.sms_status_callbacks(message_sid, received_at desc);

alter table public.sms_status_callbacks enable row level security;

drop policy if exists sms_status_callbacks_service_select on public.sms_status_callbacks;
drop policy if exists sms_status_callbacks_service_insert on public.sms_status_callbacks;
drop policy if exists sms_status_callbacks_service_update on public.sms_status_callbacks;
drop policy if exists sms_status_callbacks_service_delete on public.sms_status_callbacks;

create policy sms_status_callbacks_service_select
  on public.sms_status_callbacks for select to service_role using (true);

create policy sms_status_callbacks_service_insert
  on public.sms_status_callbacks for insert to service_role with check (true);

create policy sms_status_callbacks_service_update
  on public.sms_status_callbacks for update to service_role using (true) with check (true);

create policy sms_status_callbacks_service_delete
  on public.sms_status_callbacks for delete to service_role using (true);
