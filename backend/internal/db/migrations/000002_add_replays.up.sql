-- PostgreSQL DDL Migration: Add Replays Table
-- Version: 000002
-- Date: 2026-06-07

-- ============================
-- 回放系统
-- ============================

-- 回放表
CREATE TABLE IF NOT EXISTS replays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL UNIQUE,
    player_ids TEXT NOT NULL,
    player_names TEXT NOT NULL,
    actions TEXT NOT NULL,
    final_state TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_replays_match_id FOREIGN KEY (match_id) 
        REFERENCES matches(id) ON DELETE CASCADE
);

-- 回放表索引
CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at);

COMMENT ON TABLE replays IS '回放表';
COMMENT ON COLUMN replays.match_id IS '关联的对局 ID';
COMMENT ON COLUMN replays.player_ids IS '玩家 ID 列表（JSON 数组）';
COMMENT ON COLUMN replays.player_names IS '玩家名称列表（JSON 数组）';
COMMENT ON COLUMN replays.actions IS '动作序列（JSON 数组）';
COMMENT ON COLUMN replays.final_state IS '最终游戏状态（JSON）';
