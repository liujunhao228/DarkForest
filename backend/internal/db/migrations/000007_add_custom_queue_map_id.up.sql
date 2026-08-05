-- Migration: Add map_id column to custom_match_queues
-- Phase 3 — 自定义房间选图 + 上传
-- Allows custom rooms to select a specific map (NULL = official default classic-9)

-- Add map_id column: NULL = 官方默认地图（与快匹配行为一致）
ALTER TABLE custom_match_queues
    ADD COLUMN IF NOT EXISTS map_id UUID REFERENCES maps(id) ON DELETE SET NULL;

-- Index for deletion-blocking check (COUNT waiting rooms by map_id)
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_map_id
    ON custom_match_queues(map_id);

COMMENT ON COLUMN custom_match_queues.map_id IS '自定义房间所选地图 ID（NULL=官方默认地图 classic-9，与快匹配行为一致）';
