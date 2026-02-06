-- Seed verification checks for deterministic fixtures

begin;

do $$
declare
  region_count int;
  user_count int;
  profile_count int;
  entitlement_count int;
  waitlist_count int;
  linkup_count int;
  completed_linkup_participants int;
  contact_exchange_count int;
  contact_choice_no_count int;
  active_hold_count int;
  block_count int;
begin
  select count(*) into region_count from public.regions where id in (
    '00000000-0000-0000-0000-000000000101'::uuid,
    '00000000-0000-0000-0000-000000000102'::uuid
  );
  if region_count <> 2 then
    raise exception 'seed verify failed: expected 2 regions, got %', region_count;
  end if;

  select count(*) into user_count from public.users where id between
    '00000000-0000-0000-0000-000000000201'::uuid and '00000000-0000-0000-0000-000000000212'::uuid;
  if user_count <> 12 then
    raise exception 'seed verify failed: expected 12 users, got %', user_count;
  end if;

  select count(*) into profile_count from public.profiles where user_id in (
    select id from public.users where id between
      '00000000-0000-0000-0000-000000000201'::uuid and '00000000-0000-0000-0000-000000000212'::uuid
  );
  if profile_count <> 12 then
    raise exception 'seed verify failed: expected 12 profiles, got %', profile_count;
  end if;

  select count(*) into entitlement_count from public.entitlements where user_id in (
    select id from public.users where id between
      '00000000-0000-0000-0000-000000000201'::uuid and '00000000-0000-0000-0000-000000000212'::uuid
  );
  if entitlement_count <> 12 then
    raise exception 'seed verify failed: expected 12 entitlements, got %', entitlement_count;
  end if;

  select count(*) into waitlist_count from public.waitlist_entries
    where region_id = '00000000-0000-0000-0000-000000000102'::uuid;
  if waitlist_count <> 4 then
    raise exception 'seed verify failed: expected 4 waitlist entries, got %', waitlist_count;
  end if;

  select count(*) into linkup_count from public.linkups where id in (
    '00000000-0000-0000-0000-000000000701'::uuid,
    '00000000-0000-0000-0000-000000000702'::uuid
  );
  if linkup_count <> 2 then
    raise exception 'seed verify failed: expected 2 linkups, got %', linkup_count;
  end if;

  select count(*) into completed_linkup_participants from public.linkup_participants
    where linkup_id = '00000000-0000-0000-0000-000000000701'::uuid;
  if completed_linkup_participants <> 4 then
    raise exception 'seed verify failed: expected 4 participants for completed linkup, got %', completed_linkup_participants;
  end if;

  select count(*) into contact_exchange_count from public.contact_exchanges
    where linkup_id = '00000000-0000-0000-0000-000000000701'::uuid;
  if contact_exchange_count <> 1 then
    raise exception 'seed verify failed: expected 1 contact exchange, got %', contact_exchange_count;
  end if;

  select count(*) into contact_choice_no_count from public.contact_exchange_choices
    where linkup_id = '00000000-0000-0000-0000-000000000701'::uuid
      and choice = false;
  if contact_choice_no_count < 1 then
    raise exception 'seed verify failed: expected at least 1 contact choice = false, got %', contact_choice_no_count;
  end if;

  select count(*) into active_hold_count from public.safety_holds
    where status = 'active';
  if active_hold_count < 1 then
    raise exception 'seed verify failed: expected at least 1 active safety hold, got %', active_hold_count;
  end if;

  select count(*) into block_count from public.user_blocks;
  if block_count < 1 then
    raise exception 'seed verify failed: expected at least 1 user block, got %', block_count;
  end if;
end $$;

commit;
