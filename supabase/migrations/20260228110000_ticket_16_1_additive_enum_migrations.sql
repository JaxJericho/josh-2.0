-- Ticket 16.1: additive enum values for JOSH 3.0 coordination paths.

alter type public.profile_state
  add value if not exists 'complete_invited';

alter type public.conversation_mode
  add value if not exists 'interviewing_abbreviated';

alter type public.conversation_mode
  add value if not exists 'awaiting_social_choice';

alter type public.conversation_mode
  add value if not exists 'post_activity_checkin';

alter type public.conversation_mode
  add value if not exists 'pending_plan_confirmation';

alter type public.learning_signal_type
  add value if not exists 'solo_activity_attended';

alter type public.learning_signal_type
  add value if not exists 'solo_activity_skipped';

alter type public.learning_signal_type
  add value if not exists 'solo_do_again_yes';

alter type public.learning_signal_type
  add value if not exists 'solo_do_again_no';

alter type public.learning_signal_type
  add value if not exists 'solo_bridge_accepted';
