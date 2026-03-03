-- Drop legacy fingerprint column from profiles
-- Pre-condition: all application code uses coordination_dimensions
-- Pre-condition: SELECT COUNT(*) FROM profiles WHERE coordination_dimensions IS NULL = 0
-- Completes the two-step column rename begun in Phase 16

ALTER TABLE profiles DROP COLUMN fingerprint;
