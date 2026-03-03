-- ============================================================
-- FD-AutoPilot PostgreSQL 初始化脚本
-- ============================================================
-- 使用方法:
--   1. 以 postgres 超级用户连接:
--      psql -U postgres -f init.sql
--   2. 脚本会创建数据库、用户和 schema
--   3. fd-server 使用 fd_server schema
--   4. n8n 使用 n8n schema（同一个数据库，不同 schema 隔离）
-- ============================================================

-- 创建用户（如已存在会跳过）
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fdadmin') THEN
        CREATE ROLE fdadmin WITH LOGIN PASSWORD 'fdadmin123';
    END IF;
END
$$;

-- 创建数据库（如已存在会跳过）
SELECT 'CREATE DATABASE fd_autopilot OWNER fdadmin'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fd_autopilot')\gexec

-- 连接到 fd_autopilot 数据库后执行以下命令:
-- psql -U postgres -d fd_autopilot -c "..."
-- 或者在 psql 中: \c fd_autopilot

-- 创建 fd-server 使用的 schema
-- CREATE SCHEMA IF NOT EXISTS fd_server AUTHORIZATION fdadmin;

-- 创建 n8n 使用的 schema
-- CREATE SCHEMA IF NOT EXISTS n8n AUTHORIZATION fdadmin;

-- 授权
-- GRANT ALL PRIVILEGES ON SCHEMA fd_server TO fdadmin;
-- GRANT ALL PRIVILEGES ON SCHEMA n8n TO fdadmin;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA fd_server TO fdadmin;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA n8n TO fdadmin;
