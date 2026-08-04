-- PostgreSQL DDL Migration: Add Maps Table
-- Version: 000006
-- Date: 2026-08-04

-- ============================
-- 自定义地图持久化（P2）
-- ============================

CREATE TABLE IF NOT EXISTS maps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES players(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    layout_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maps_is_official ON maps(is_official);
CREATE INDEX IF NOT EXISTS idx_maps_created_by ON maps(created_by);

COMMENT ON TABLE maps IS '地图表（官方与用户自创）';
COMMENT ON COLUMN maps.slug IS 'URL 友好标识，官方地图固定 slug（如 classic-9），用户地图可为 NULL';
COMMENT ON COLUMN maps.is_official IS '是否为官方地图（仅 admin 可写）';
COMMENT ON COLUMN maps.created_by IS '地图创建者（官方地图为 admin 用户，用户地图为创建者）';
COMMENT ON COLUMN maps.version IS '乐观更新用版本号（不做版本化回放，仅本地并发控制）';
COMMENT ON COLUMN maps.layout_json IS '完整布局+视觉快照（{nodes:[{id,x,y,name,size,tint}], edges:[{from,to}]}）';
