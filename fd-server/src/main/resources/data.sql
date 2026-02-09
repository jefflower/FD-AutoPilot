-- 初始化管理员用户 (密码: admin123)
-- 密码已使用 BCrypt 加密
UPDATE sys_user SET role = 'ADMIN', status = 'APPROVED' WHERE username = 'admin';

-- 移除 ticket.status 列的旧 CHECK 约束（H2 ddl-auto=update 不会自动更新枚举约束）
-- 改为纯 VARCHAR(32)，枚举校验由 JPA 应用层保证
ALTER TABLE IF EXISTS ticket ALTER COLUMN IF EXISTS status VARCHAR(32);
