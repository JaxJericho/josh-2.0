-- Ticket 1.2: Enable RLS + policies

-- Enable RLS on all canonical tables
alter table public.regions enable row level security;
alter table public.users enable row level security;
alter table public.otp_sessions enable row level security;
alter table public.region_memberships enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.conversation_sessions enable row level security;
alter table public.sms_messages enable row level security;
alter table public.sms_outbound_jobs enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_events enable row level security;
alter table public.linkups enable row level security;
alter table public.linkup_invites enable row level security;
alter table public.linkup_participants enable row level security;
alter table public.linkup_outcomes enable row level security;
alter table public.linkup_events enable row level security;
alter table public.contact_exchange_choices enable row level security;
alter table public.contact_exchanges enable row level security;
alter table public.contact_exchange_events enable row level security;
alter table public.stripe_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.entitlement_ledger enable row level security;
alter table public.entitlement_overrides enable row level security;
alter table public.safety_incidents enable row level security;
alter table public.safety_holds enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
alter table public.user_strikes enable row level security;
alter table public.learning_signals enable row level security;
alter table public.user_derived_state enable row level security;
alter table public.learning_jobs enable row level security;
alter table public.match_runs enable row level security;
alter table public.match_candidates enable row level security;

-- Service role: full access (explicit per action)
drop policy if exists regions_service_select on public.regions;
drop policy if exists regions_service_insert on public.regions;
drop policy if exists regions_service_update on public.regions;
drop policy if exists regions_service_delete on public.regions;
create policy regions_service_select on public.regions for select to service_role using (true);
create policy regions_service_insert on public.regions for insert to service_role with check (true);
create policy regions_service_update on public.regions for update to service_role using (true) with check (true);
create policy regions_service_delete on public.regions for delete to service_role using (true);

drop policy if exists users_service_select on public.users;
drop policy if exists users_service_insert on public.users;
drop policy if exists users_service_update on public.users;
drop policy if exists users_service_delete on public.users;
create policy users_service_select on public.users for select to service_role using (true);
create policy users_service_insert on public.users for insert to service_role with check (true);
create policy users_service_update on public.users for update to service_role using (true) with check (true);
create policy users_service_delete on public.users for delete to service_role using (true);

drop policy if exists otp_sessions_service_select on public.otp_sessions;
drop policy if exists otp_sessions_service_insert on public.otp_sessions;
drop policy if exists otp_sessions_service_update on public.otp_sessions;
drop policy if exists otp_sessions_service_delete on public.otp_sessions;
create policy otp_sessions_service_select on public.otp_sessions for select to service_role using (true);
create policy otp_sessions_service_insert on public.otp_sessions for insert to service_role with check (true);
create policy otp_sessions_service_update on public.otp_sessions for update to service_role using (true) with check (true);
create policy otp_sessions_service_delete on public.otp_sessions for delete to service_role using (true);

drop policy if exists region_memberships_service_select on public.region_memberships;
drop policy if exists region_memberships_service_insert on public.region_memberships;
drop policy if exists region_memberships_service_update on public.region_memberships;
drop policy if exists region_memberships_service_delete on public.region_memberships;
create policy region_memberships_service_select on public.region_memberships for select to service_role using (true);
create policy region_memberships_service_insert on public.region_memberships for insert to service_role with check (true);
create policy region_memberships_service_update on public.region_memberships for update to service_role using (true) with check (true);
create policy region_memberships_service_delete on public.region_memberships for delete to service_role using (true);

drop policy if exists waitlist_entries_service_select on public.waitlist_entries;
drop policy if exists waitlist_entries_service_insert on public.waitlist_entries;
drop policy if exists waitlist_entries_service_update on public.waitlist_entries;
drop policy if exists waitlist_entries_service_delete on public.waitlist_entries;
create policy waitlist_entries_service_select on public.waitlist_entries for select to service_role using (true);
create policy waitlist_entries_service_insert on public.waitlist_entries for insert to service_role with check (true);
create policy waitlist_entries_service_update on public.waitlist_entries for update to service_role using (true) with check (true);
create policy waitlist_entries_service_delete on public.waitlist_entries for delete to service_role using (true);

drop policy if exists conversation_sessions_service_select on public.conversation_sessions;
drop policy if exists conversation_sessions_service_insert on public.conversation_sessions;
drop policy if exists conversation_sessions_service_update on public.conversation_sessions;
drop policy if exists conversation_sessions_service_delete on public.conversation_sessions;
create policy conversation_sessions_service_select on public.conversation_sessions for select to service_role using (true);
create policy conversation_sessions_service_insert on public.conversation_sessions for insert to service_role with check (true);
create policy conversation_sessions_service_update on public.conversation_sessions for update to service_role using (true) with check (true);
create policy conversation_sessions_service_delete on public.conversation_sessions for delete to service_role using (true);

drop policy if exists sms_messages_service_select on public.sms_messages;
drop policy if exists sms_messages_service_insert on public.sms_messages;
drop policy if exists sms_messages_service_update on public.sms_messages;
drop policy if exists sms_messages_service_delete on public.sms_messages;
create policy sms_messages_service_select on public.sms_messages for select to service_role using (true);
create policy sms_messages_service_insert on public.sms_messages for insert to service_role with check (true);
create policy sms_messages_service_update on public.sms_messages for update to service_role using (true) with check (true);
create policy sms_messages_service_delete on public.sms_messages for delete to service_role using (true);

drop policy if exists sms_outbound_jobs_service_select on public.sms_outbound_jobs;
drop policy if exists sms_outbound_jobs_service_insert on public.sms_outbound_jobs;
drop policy if exists sms_outbound_jobs_service_update on public.sms_outbound_jobs;
drop policy if exists sms_outbound_jobs_service_delete on public.sms_outbound_jobs;
create policy sms_outbound_jobs_service_select on public.sms_outbound_jobs for select to service_role using (true);
create policy sms_outbound_jobs_service_insert on public.sms_outbound_jobs for insert to service_role with check (true);
create policy sms_outbound_jobs_service_update on public.sms_outbound_jobs for update to service_role using (true) with check (true);
create policy sms_outbound_jobs_service_delete on public.sms_outbound_jobs for delete to service_role using (true);

drop policy if exists profiles_service_select on public.profiles;
drop policy if exists profiles_service_insert on public.profiles;
drop policy if exists profiles_service_update on public.profiles;
drop policy if exists profiles_service_delete on public.profiles;
create policy profiles_service_select on public.profiles for select to service_role using (true);
create policy profiles_service_insert on public.profiles for insert to service_role with check (true);
create policy profiles_service_update on public.profiles for update to service_role using (true) with check (true);
create policy profiles_service_delete on public.profiles for delete to service_role using (true);

drop policy if exists profile_events_service_select on public.profile_events;
drop policy if exists profile_events_service_insert on public.profile_events;
drop policy if exists profile_events_service_update on public.profile_events;
drop policy if exists profile_events_service_delete on public.profile_events;
create policy profile_events_service_select on public.profile_events for select to service_role using (true);
create policy profile_events_service_insert on public.profile_events for insert to service_role with check (true);
create policy profile_events_service_update on public.profile_events for update to service_role using (true) with check (true);
create policy profile_events_service_delete on public.profile_events for delete to service_role using (true);

drop policy if exists linkups_service_select on public.linkups;
drop policy if exists linkups_service_insert on public.linkups;
drop policy if exists linkups_service_update on public.linkups;
drop policy if exists linkups_service_delete on public.linkups;
create policy linkups_service_select on public.linkups for select to service_role using (true);
create policy linkups_service_insert on public.linkups for insert to service_role with check (true);
create policy linkups_service_update on public.linkups for update to service_role using (true) with check (true);
create policy linkups_service_delete on public.linkups for delete to service_role using (true);

drop policy if exists linkup_invites_service_select on public.linkup_invites;
drop policy if exists linkup_invites_service_insert on public.linkup_invites;
drop policy if exists linkup_invites_service_update on public.linkup_invites;
drop policy if exists linkup_invites_service_delete on public.linkup_invites;
create policy linkup_invites_service_select on public.linkup_invites for select to service_role using (true);
create policy linkup_invites_service_insert on public.linkup_invites for insert to service_role with check (true);
create policy linkup_invites_service_update on public.linkup_invites for update to service_role using (true) with check (true);
create policy linkup_invites_service_delete on public.linkup_invites for delete to service_role using (true);

drop policy if exists linkup_participants_service_select on public.linkup_participants;
drop policy if exists linkup_participants_service_insert on public.linkup_participants;
drop policy if exists linkup_participants_service_update on public.linkup_participants;
drop policy if exists linkup_participants_service_delete on public.linkup_participants;
create policy linkup_participants_service_select on public.linkup_participants for select to service_role using (true);
create policy linkup_participants_service_insert on public.linkup_participants for insert to service_role with check (true);
create policy linkup_participants_service_update on public.linkup_participants for update to service_role using (true) with check (true);
create policy linkup_participants_service_delete on public.linkup_participants for delete to service_role using (true);

drop policy if exists linkup_outcomes_service_select on public.linkup_outcomes;
drop policy if exists linkup_outcomes_service_insert on public.linkup_outcomes;
drop policy if exists linkup_outcomes_service_update on public.linkup_outcomes;
drop policy if exists linkup_outcomes_service_delete on public.linkup_outcomes;
create policy linkup_outcomes_service_select on public.linkup_outcomes for select to service_role using (true);
create policy linkup_outcomes_service_insert on public.linkup_outcomes for insert to service_role with check (true);
create policy linkup_outcomes_service_update on public.linkup_outcomes for update to service_role using (true) with check (true);
create policy linkup_outcomes_service_delete on public.linkup_outcomes for delete to service_role using (true);

drop policy if exists linkup_events_service_select on public.linkup_events;
drop policy if exists linkup_events_service_insert on public.linkup_events;
drop policy if exists linkup_events_service_update on public.linkup_events;
drop policy if exists linkup_events_service_delete on public.linkup_events;
create policy linkup_events_service_select on public.linkup_events for select to service_role using (true);
create policy linkup_events_service_insert on public.linkup_events for insert to service_role with check (true);
create policy linkup_events_service_update on public.linkup_events for update to service_role using (true) with check (true);
create policy linkup_events_service_delete on public.linkup_events for delete to service_role using (true);

drop policy if exists contact_exchange_choices_service_select on public.contact_exchange_choices;
drop policy if exists contact_exchange_choices_service_insert on public.contact_exchange_choices;
drop policy if exists contact_exchange_choices_service_update on public.contact_exchange_choices;
drop policy if exists contact_exchange_choices_service_delete on public.contact_exchange_choices;
create policy contact_exchange_choices_service_select on public.contact_exchange_choices for select to service_role using (true);
create policy contact_exchange_choices_service_insert on public.contact_exchange_choices for insert to service_role with check (true);
create policy contact_exchange_choices_service_update on public.contact_exchange_choices for update to service_role using (true) with check (true);
create policy contact_exchange_choices_service_delete on public.contact_exchange_choices for delete to service_role using (true);

drop policy if exists contact_exchanges_service_select on public.contact_exchanges;
drop policy if exists contact_exchanges_service_insert on public.contact_exchanges;
drop policy if exists contact_exchanges_service_update on public.contact_exchanges;
drop policy if exists contact_exchanges_service_delete on public.contact_exchanges;
create policy contact_exchanges_service_select on public.contact_exchanges for select to service_role using (true);
create policy contact_exchanges_service_insert on public.contact_exchanges for insert to service_role with check (true);
create policy contact_exchanges_service_update on public.contact_exchanges for update to service_role using (true) with check (true);
create policy contact_exchanges_service_delete on public.contact_exchanges for delete to service_role using (true);

drop policy if exists contact_exchange_events_service_select on public.contact_exchange_events;
drop policy if exists contact_exchange_events_service_insert on public.contact_exchange_events;
drop policy if exists contact_exchange_events_service_update on public.contact_exchange_events;
drop policy if exists contact_exchange_events_service_delete on public.contact_exchange_events;
create policy contact_exchange_events_service_select on public.contact_exchange_events for select to service_role using (true);
create policy contact_exchange_events_service_insert on public.contact_exchange_events for insert to service_role with check (true);
create policy contact_exchange_events_service_update on public.contact_exchange_events for update to service_role using (true) with check (true);
create policy contact_exchange_events_service_delete on public.contact_exchange_events for delete to service_role using (true);

drop policy if exists stripe_events_service_select on public.stripe_events;
drop policy if exists stripe_events_service_insert on public.stripe_events;
drop policy if exists stripe_events_service_update on public.stripe_events;
drop policy if exists stripe_events_service_delete on public.stripe_events;
create policy stripe_events_service_select on public.stripe_events for select to service_role using (true);
create policy stripe_events_service_insert on public.stripe_events for insert to service_role with check (true);
create policy stripe_events_service_update on public.stripe_events for update to service_role using (true) with check (true);
create policy stripe_events_service_delete on public.stripe_events for delete to service_role using (true);

drop policy if exists entitlements_service_select on public.entitlements;
drop policy if exists entitlements_service_insert on public.entitlements;
drop policy if exists entitlements_service_update on public.entitlements;
drop policy if exists entitlements_service_delete on public.entitlements;
create policy entitlements_service_select on public.entitlements for select to service_role using (true);
create policy entitlements_service_insert on public.entitlements for insert to service_role with check (true);
create policy entitlements_service_update on public.entitlements for update to service_role using (true) with check (true);
create policy entitlements_service_delete on public.entitlements for delete to service_role using (true);

drop policy if exists entitlement_ledger_service_select on public.entitlement_ledger;
drop policy if exists entitlement_ledger_service_insert on public.entitlement_ledger;
drop policy if exists entitlement_ledger_service_update on public.entitlement_ledger;
drop policy if exists entitlement_ledger_service_delete on public.entitlement_ledger;
create policy entitlement_ledger_service_select on public.entitlement_ledger for select to service_role using (true);
create policy entitlement_ledger_service_insert on public.entitlement_ledger for insert to service_role with check (true);
create policy entitlement_ledger_service_update on public.entitlement_ledger for update to service_role using (true) with check (true);
create policy entitlement_ledger_service_delete on public.entitlement_ledger for delete to service_role using (true);

drop policy if exists entitlement_overrides_service_select on public.entitlement_overrides;
drop policy if exists entitlement_overrides_service_insert on public.entitlement_overrides;
drop policy if exists entitlement_overrides_service_update on public.entitlement_overrides;
drop policy if exists entitlement_overrides_service_delete on public.entitlement_overrides;
create policy entitlement_overrides_service_select on public.entitlement_overrides for select to service_role using (true);
create policy entitlement_overrides_service_insert on public.entitlement_overrides for insert to service_role with check (true);
create policy entitlement_overrides_service_update on public.entitlement_overrides for update to service_role using (true) with check (true);
create policy entitlement_overrides_service_delete on public.entitlement_overrides for delete to service_role using (true);

drop policy if exists safety_incidents_service_select on public.safety_incidents;
drop policy if exists safety_incidents_service_insert on public.safety_incidents;
drop policy if exists safety_incidents_service_update on public.safety_incidents;
drop policy if exists safety_incidents_service_delete on public.safety_incidents;
create policy safety_incidents_service_select on public.safety_incidents for select to service_role using (true);
create policy safety_incidents_service_insert on public.safety_incidents for insert to service_role with check (true);
create policy safety_incidents_service_update on public.safety_incidents for update to service_role using (true) with check (true);
create policy safety_incidents_service_delete on public.safety_incidents for delete to service_role using (true);

drop policy if exists safety_holds_service_select on public.safety_holds;
drop policy if exists safety_holds_service_insert on public.safety_holds;
drop policy if exists safety_holds_service_update on public.safety_holds;
drop policy if exists safety_holds_service_delete on public.safety_holds;
create policy safety_holds_service_select on public.safety_holds for select to service_role using (true);
create policy safety_holds_service_insert on public.safety_holds for insert to service_role with check (true);
create policy safety_holds_service_update on public.safety_holds for update to service_role using (true) with check (true);
create policy safety_holds_service_delete on public.safety_holds for delete to service_role using (true);

drop policy if exists user_blocks_service_select on public.user_blocks;
drop policy if exists user_blocks_service_insert on public.user_blocks;
drop policy if exists user_blocks_service_update on public.user_blocks;
drop policy if exists user_blocks_service_delete on public.user_blocks;
create policy user_blocks_service_select on public.user_blocks for select to service_role using (true);
create policy user_blocks_service_insert on public.user_blocks for insert to service_role with check (true);
create policy user_blocks_service_update on public.user_blocks for update to service_role using (true) with check (true);
create policy user_blocks_service_delete on public.user_blocks for delete to service_role using (true);

drop policy if exists user_reports_service_select on public.user_reports;
drop policy if exists user_reports_service_insert on public.user_reports;
drop policy if exists user_reports_service_update on public.user_reports;
drop policy if exists user_reports_service_delete on public.user_reports;
create policy user_reports_service_select on public.user_reports for select to service_role using (true);
create policy user_reports_service_insert on public.user_reports for insert to service_role with check (true);
create policy user_reports_service_update on public.user_reports for update to service_role using (true) with check (true);
create policy user_reports_service_delete on public.user_reports for delete to service_role using (true);

drop policy if exists user_strikes_service_select on public.user_strikes;
drop policy if exists user_strikes_service_insert on public.user_strikes;
drop policy if exists user_strikes_service_update on public.user_strikes;
drop policy if exists user_strikes_service_delete on public.user_strikes;
create policy user_strikes_service_select on public.user_strikes for select to service_role using (true);
create policy user_strikes_service_insert on public.user_strikes for insert to service_role with check (true);
create policy user_strikes_service_update on public.user_strikes for update to service_role using (true) with check (true);
create policy user_strikes_service_delete on public.user_strikes for delete to service_role using (true);

drop policy if exists learning_signals_service_select on public.learning_signals;
drop policy if exists learning_signals_service_insert on public.learning_signals;
drop policy if exists learning_signals_service_update on public.learning_signals;
drop policy if exists learning_signals_service_delete on public.learning_signals;
create policy learning_signals_service_select on public.learning_signals for select to service_role using (true);
create policy learning_signals_service_insert on public.learning_signals for insert to service_role with check (true);
create policy learning_signals_service_update on public.learning_signals for update to service_role using (true) with check (true);
create policy learning_signals_service_delete on public.learning_signals for delete to service_role using (true);

drop policy if exists user_derived_state_service_select on public.user_derived_state;
drop policy if exists user_derived_state_service_insert on public.user_derived_state;
drop policy if exists user_derived_state_service_update on public.user_derived_state;
drop policy if exists user_derived_state_service_delete on public.user_derived_state;
create policy user_derived_state_service_select on public.user_derived_state for select to service_role using (true);
create policy user_derived_state_service_insert on public.user_derived_state for insert to service_role with check (true);
create policy user_derived_state_service_update on public.user_derived_state for update to service_role using (true) with check (true);
create policy user_derived_state_service_delete on public.user_derived_state for delete to service_role using (true);

drop policy if exists learning_jobs_service_select on public.learning_jobs;
drop policy if exists learning_jobs_service_insert on public.learning_jobs;
drop policy if exists learning_jobs_service_update on public.learning_jobs;
drop policy if exists learning_jobs_service_delete on public.learning_jobs;
create policy learning_jobs_service_select on public.learning_jobs for select to service_role using (true);
create policy learning_jobs_service_insert on public.learning_jobs for insert to service_role with check (true);
create policy learning_jobs_service_update on public.learning_jobs for update to service_role using (true) with check (true);
create policy learning_jobs_service_delete on public.learning_jobs for delete to service_role using (true);

drop policy if exists match_runs_service_select on public.match_runs;
drop policy if exists match_runs_service_insert on public.match_runs;
drop policy if exists match_runs_service_update on public.match_runs;
drop policy if exists match_runs_service_delete on public.match_runs;
create policy match_runs_service_select on public.match_runs for select to service_role using (true);
create policy match_runs_service_insert on public.match_runs for insert to service_role with check (true);
create policy match_runs_service_update on public.match_runs for update to service_role using (true) with check (true);
create policy match_runs_service_delete on public.match_runs for delete to service_role using (true);

drop policy if exists match_candidates_service_select on public.match_candidates;
drop policy if exists match_candidates_service_insert on public.match_candidates;
drop policy if exists match_candidates_service_update on public.match_candidates;
drop policy if exists match_candidates_service_delete on public.match_candidates;
create policy match_candidates_service_select on public.match_candidates for select to service_role using (true);
create policy match_candidates_service_insert on public.match_candidates for insert to service_role with check (true);
create policy match_candidates_service_update on public.match_candidates for update to service_role using (true) with check (true);
create policy match_candidates_service_delete on public.match_candidates for delete to service_role using (true);

-- Authenticated user policies (user-owned access patterns)
drop policy if exists users_select_own on public.users;
create policy users_select_own
  on public.users for select to authenticated
  using (id = auth.uid());

drop policy if exists region_memberships_select_own on public.region_memberships;
create policy region_memberships_select_own
  on public.region_memberships for select to authenticated
  using (user_id = auth.uid());

drop policy if exists waitlist_entries_select_own on public.waitlist_entries;
create policy waitlist_entries_select_own
  on public.waitlist_entries for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy profiles_insert_own
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists linkups_select_member on public.linkups;
create policy linkups_select_member
  on public.linkups for select to authenticated
  using (
    linkups.initiator_user_id = auth.uid()
    or exists (
      select 1 from public.linkup_participants p
      where p.linkup_id = linkups.id and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.linkup_invites i
      where i.linkup_id = linkups.id and i.invited_user_id = auth.uid()
    )
  );

drop policy if exists linkup_invites_select_member on public.linkup_invites;
create policy linkup_invites_select_member
  on public.linkup_invites for select to authenticated
  using (
    linkup_invites.invited_user_id = auth.uid()
  );

drop policy if exists linkup_participants_select_member on public.linkup_participants;
create policy linkup_participants_select_member
  on public.linkup_participants for select to authenticated
  using (
    linkup_participants.user_id = auth.uid()
  );

drop policy if exists linkup_outcomes_select_own on public.linkup_outcomes;
drop policy if exists linkup_outcomes_insert_own on public.linkup_outcomes;
drop policy if exists linkup_outcomes_update_own on public.linkup_outcomes;
create policy linkup_outcomes_select_own
  on public.linkup_outcomes for select to authenticated
  using (user_id = auth.uid());
create policy linkup_outcomes_insert_own
  on public.linkup_outcomes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.linkup_participants p
      where p.linkup_id = linkup_outcomes.linkup_id and p.user_id = auth.uid()
    )
  );
create policy linkup_outcomes_update_own
  on public.linkup_outcomes for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.linkup_participants p
      where p.linkup_id = linkup_outcomes.linkup_id and p.user_id = auth.uid()
    )
  );

drop policy if exists contact_exchange_choices_select_own on public.contact_exchange_choices;
drop policy if exists contact_exchange_choices_insert_own on public.contact_exchange_choices;
drop policy if exists contact_exchange_choices_update_own on public.contact_exchange_choices;
create policy contact_exchange_choices_select_own
  on public.contact_exchange_choices for select to authenticated
  using (chooser_user_id = auth.uid());
create policy contact_exchange_choices_insert_own
  on public.contact_exchange_choices for insert to authenticated
  with check (
    chooser_user_id = auth.uid()
    and exists (
      select 1 from public.linkup_participants p
      where p.linkup_id = contact_exchange_choices.linkup_id and p.user_id = auth.uid()
    )
  );
create policy contact_exchange_choices_update_own
  on public.contact_exchange_choices for update to authenticated
  using (chooser_user_id = auth.uid())
  with check (
    chooser_user_id = auth.uid()
    and exists (
      select 1 from public.linkup_participants p
      where p.linkup_id = contact_exchange_choices.linkup_id and p.user_id = auth.uid()
    )
  );

drop policy if exists contact_exchanges_select_member on public.contact_exchanges;
create policy contact_exchanges_select_member
  on public.contact_exchanges for select to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own
  on public.entitlements for select to authenticated
  using (user_id = auth.uid());

drop policy if exists entitlement_ledger_select_own on public.entitlement_ledger;
create policy entitlement_ledger_select_own
  on public.entitlement_ledger for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_blocks_select_own on public.user_blocks;
drop policy if exists user_blocks_insert_own on public.user_blocks;
drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_select_own
  on public.user_blocks for select to authenticated
  using (blocker_user_id = auth.uid());
create policy user_blocks_insert_own
  on public.user_blocks for insert to authenticated
  with check (blocker_user_id = auth.uid() and blocked_user_id <> auth.uid());
create policy user_blocks_delete_own
  on public.user_blocks for delete to authenticated
  using (blocker_user_id = auth.uid());

drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own
  on public.user_reports for insert to authenticated
  with check (reporter_user_id = auth.uid());
