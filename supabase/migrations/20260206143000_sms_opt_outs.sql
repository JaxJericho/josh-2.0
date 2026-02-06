-- SMS opt-out tracking (for numbers without user mapping)

create table if not exists public.sms_opt_outs (
  phone_e164 text primary key,
  opted_out_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sms_opt_outs enable row level security;

drop policy if exists sms_opt_outs_service_select on public.sms_opt_outs;
drop policy if exists sms_opt_outs_service_insert on public.sms_opt_outs;
drop policy if exists sms_opt_outs_service_update on public.sms_opt_outs;
drop policy if exists sms_opt_outs_service_delete on public.sms_opt_outs;

create policy sms_opt_outs_service_select on public.sms_opt_outs
  for select to service_role using (true);

create policy sms_opt_outs_service_insert on public.sms_opt_outs
  for insert to service_role with check (true);

create policy sms_opt_outs_service_update on public.sms_opt_outs
  for update to service_role using (true) with check (true);

create policy sms_opt_outs_service_delete on public.sms_opt_outs
  for delete to service_role using (true);

-- updated_at trigger

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sms_opt_outs_set_updated_at') then
    create trigger sms_opt_outs_set_updated_at
    before update on public.sms_opt_outs
    for each row execute function public.set_updated_at();
  end if;
end $$;
