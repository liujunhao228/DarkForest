-- PostgreSQL DDL Migration Down: Remove custom_rules from custom_match_queues
-- Version: 000004
-- Date: 2026-07-19

ALTER TABLE custom_match_queues DROP COLUMN IF EXISTS custom_rules;
ALTER TABLE custom_match_queues DROP COLUMN IF EXISTS base_game_mode;
