-- H2 schema 补丁 — 仅在 H2 环境下需要，PostgreSQL 不需要
-- 当前已切换到 PostgreSQL，spring.sql.init.mode=never，此文件不会被执行
-- 保留用于未来可能的 H2 开发/测试环境回退

-- ALTER TABLE IF EXISTS ticket ALTER COLUMN IF EXISTS status VARCHAR(32);
-- ALTER TABLE IF EXISTS ai_agent_definition ALTER COLUMN IF EXISTS provider_type VARCHAR(32);
