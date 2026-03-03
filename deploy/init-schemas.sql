-- ============================================================
-- FD-AutoPilot Schema 初始化
-- ============================================================
-- 在 fd_autopilot 数据库中执行:
--   psql -U postgres -d fd_autopilot -f init-schemas.sql
-- ============================================================

-- fd-server 使用的 schema
CREATE SCHEMA IF NOT EXISTS fd_server AUTHORIZATION fdadmin;

-- n8n 使用的 schema
CREATE SCHEMA IF NOT EXISTS n8n AUTHORIZATION fdadmin;

-- 授权
GRANT ALL PRIVILEGES ON SCHEMA fd_server TO fdadmin;
GRANT ALL PRIVILEGES ON SCHEMA n8n TO fdadmin;

-- 设置默认权限（未来新建的表自动授权）
ALTER DEFAULT PRIVILEGES FOR ROLE fdadmin IN SCHEMA fd_server
    GRANT ALL PRIVILEGES ON TABLES TO fdadmin;
ALTER DEFAULT PRIVILEGES FOR ROLE fdadmin IN SCHEMA n8n
    GRANT ALL PRIVILEGES ON TABLES TO fdadmin;
