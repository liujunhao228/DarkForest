-- PostgreSQL DDL Migration: Add custom_rules to custom_match_queues
-- Version: 000004
-- Date: 2026-07-19

-- ============================
-- 自定义房间规则配置
-- ============================

-- 基础游戏模式（房主选的模板）：classic / civilization_relics
-- NOT NULL DEFAULT 'classic' 兼容存量行（存量自定义房间均为 classic）
ALTER TABLE custom_match_queues
    ADD COLUMN IF NOT EXISTS base_game_mode VARCHAR(50) NOT NULL DEFAULT 'classic';

-- 自定义规则全量覆盖（房主在基础模式之上逐项调整后的最终规则集）
-- JSONB 存储 game.ModeRules 的完整 JSON 表示（含 enum 的 int 数值）
-- NULL = 房主未配置自定义规则，按 base_game_mode 预设生效
ALTER TABLE custom_match_queues
    ADD COLUMN IF NOT EXISTS custom_rules JSONB;

COMMENT ON COLUMN custom_match_queues.base_game_mode IS '基础游戏模式：classic / civilization_relics（房主选定的模板）';
COMMENT ON COLUMN custom_match_queues.custom_rules IS '自定义规则全量覆盖（game.ModeRules 的 JSON 表示）；NULL=按 base_game_mode 预设';
