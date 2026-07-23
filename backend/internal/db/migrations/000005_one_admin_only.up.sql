-- PostgreSQL DDL Migration: Add partial unique index for admin role
-- Version: 000005
-- Date: 2026-07-19

-- ============================
-- 确保数据库中最多只能有一个管理员
-- ============================

-- 部分唯一索引：只限制 role='admin' 的行，不影响普通玩家
-- 并发 AdminSetup 调用时，第二个 INSERT 会触发此约束冲突
CREATE UNIQUE INDEX IF NOT EXISTS one_admin_only
    ON players(role)
    WHERE role = 'admin';
