-- Ticket 4.1: add availability_expressed signal type for freeform inbound handling.

alter type public.learning_signal_type
  add value if not exists 'availability_expressed';
