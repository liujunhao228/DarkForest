-- Rollback initial schema
-- PostgreSQL DDL Migration: Initial Schema Rollback
-- Version: 000001
-- Date: 2026-06-06

-- ============================
-- 删除触发器
-- ============================

DROP TRIGGER IF EXISTS update_posts_updated_at ON posts;
DROP TRIGGER IF EXISTS update_matches_updated_at ON matches;
DROP TRIGGER IF EXISTS update_custom_match_queues_updated_at ON custom_match_queues;
DROP TRIGGER IF EXISTS update_players_updated_at ON players;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- 删除触发器函数
DROP FUNCTION IF EXISTS update_updated_at_column();

-- ============================
-- 删除表（按依赖关系逆序）
-- ============================

-- 预留模型
DROP TABLE IF EXISTS posts CASCADE;

-- 对局系统
DROP TABLE IF EXISTS match_players CASCADE;
DROP TABLE IF EXISTS matches CASCADE;

-- 匹配系统
DROP TABLE IF EXISTS custom_match_queue_players CASCADE;
DROP TABLE IF EXISTS custom_match_queues CASCADE;
DROP TABLE IF EXISTS matchmaking_queues CASCADE;

-- 邀请码系统
DROP TABLE IF EXISTS invitation_codes CASCADE;

-- 用户与玩家系统
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================
-- 删除扩展（可选）
-- ============================

-- 注意：通常不建议删除 uuid-ossp 扩展，因为其他表可能还在使用
-- 如果确实需要删除，可以使用以下命令：
-- DROP EXTENSION IF EXISTS "uuid-ossp";