-- Rollback migration: Remove map_id column from custom_match_queues
-- Phase 3 — 自定义房间选图 + 上传

DROP INDEX IF EXISTS idx_custom_match_queues_map_id;

ALTER TABLE custom_match_queues
    DROP COLUMN IF EXISTS map_id;
