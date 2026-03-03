-- Drop legacy fingerprint column from profiles
-- Pre-condition: all application code uses coordination_dimensions
-- Pre-condition: SELECT COUNT(*) FROM profiles WHERE coordination_dimensions IS NULL = 0

ALTER TABLE public.profiles DROP COLUMN IF EXISTS fingerprint;
