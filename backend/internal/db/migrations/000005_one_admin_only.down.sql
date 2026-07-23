-- PostgreSQL DDL Migration: Remove partial unique index for admin role
-- Version: 000005
-- Date: 2026-07-19

-- 回滚：删除部分唯一索引 one_admin_only
DROP INDEX IF EXISTS one_admin_only;
