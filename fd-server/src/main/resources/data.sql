-- 移除 ticket.status 列的旧 CHECK 约束（H2 ddl-auto=update 不会自动更新枚举约束）
-- 改为纯 VARCHAR(32)，枚举校验由 JPA 应用层保证
ALTER TABLE IF EXISTS ticket ALTER COLUMN IF EXISTS status VARCHAR(32);
