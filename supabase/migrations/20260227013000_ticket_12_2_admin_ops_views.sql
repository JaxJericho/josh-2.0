-- Ticket 12.2: Admin ops moderation status updates
-- Enable service-role status updates while preserving delete protection.

drop trigger if exists moderation_incidents_append_only on public.moderation_incidents;
drop function if exists public.prevent_moderation_incidents_mutation();

create or replace function public.prevent_moderation_incidents_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moderation_incidents does not allow delete';
end;
$$;

drop trigger if exists moderation_incidents_prevent_delete on public.moderation_incidents;
create trigger moderation_incidents_prevent_delete
before delete on public.moderation_incidents
for each row execute function public.prevent_moderation_incidents_delete();

drop policy if exists moderation_incidents_service_update on public.moderation_incidents;
create policy moderation_incidents_service_update on public.moderation_incidents
  for update to service_role
  using (true)
  with check (true);
