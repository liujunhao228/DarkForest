-- PostgreSQL DDL Migration: Add initial_state to replays table
-- Version: 000003
-- Date: 2026-06-08

ALTER TABLE replays ADD COLUMN IF NOT EXISTS initial_state TEXT;

COMMENT ON COLUMN replays.initial_state IS '初始游戏状态（JSON）';
