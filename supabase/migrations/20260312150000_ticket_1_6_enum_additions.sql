-- Ticket 1.6: add pivot model enum values.

alter type public.conversation_mode
  add value if not exists 'awaiting_invitation_response';

alter type public.learning_signal_type
  add value if not exists 'invitation_accepted';

alter type public.learning_signal_type
  add value if not exists 'invitation_passed';

alter type public.learning_signal_type
  add value if not exists 'invitation_expired';
