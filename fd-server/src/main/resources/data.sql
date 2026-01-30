-- 初始化管理员用户 (密码: admin123)
-- 密码已使用 BCrypt 加密
UPDATE sys_user SET role = 'ADMIN', status = 'APPROVED' WHERE username = 'admin';
