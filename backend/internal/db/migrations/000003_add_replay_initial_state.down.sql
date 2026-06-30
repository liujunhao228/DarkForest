-- Down migration for 000003
ALTER TABLE replays DROP COLUMN IF EXISTS initial_state;
