package com.jefflower.fdserver.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * 超级密码验证工具。
 * 支持两种配置格式：
 * <ul>
 *   <li>BCrypt 哈希（推荐）：配置值以 $2a$、$2b$ 或 $2y$ 开头，使用 BCryptPasswordEncoder.matches() 验证</li>
 *   <li>明文（向后兼容）：直接 equals 比对，并在日志中输出安全警告</li>
 * </ul>
 */
@Slf4j
public final class SuperPasswordVerifier {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    private SuperPasswordVerifier() {
        // 工具类，禁止实例化
    }

    /**
     * 验证输入的超级密码是否与配置值匹配。
     *
     * @param rawInput       用户输入的明文密码
     * @param configuredValue 配置文件中的密码值（可能是 BCrypt 哈希或明文）
     * @return true 表示验证通过
     */
    public static boolean verify(String rawInput, String configuredValue) {
        if (rawInput == null || configuredValue == null) {
            return false;
        }

        if (isBCryptHash(configuredValue)) {
            return ENCODER.matches(rawInput, configuredValue);
        }

        // 明文模式 —— 向后兼容，但发出安全警告
        log.warn("[安全警告] 超级密码(app.super-password)当前为明文存储，强烈建议替换为 BCrypt 哈希值。" +
                "可使用 SuperPasswordVerifier.encode() 生成哈希后写入配置文件。");
        return configuredValue.equals(rawInput);
    }

    /**
     * 判断给定字符串是否为 BCrypt 哈希格式。
     */
    private static boolean isBCryptHash(String value) {
        return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
    }

    /**
     * 将明文密码编码为 BCrypt 哈希（供管理员生成配置值使用）。
     *
     * @param rawPassword 明文密码
     * @return BCrypt 哈希字符串
     */
    public static String encode(String rawPassword) {
        return ENCODER.encode(rawPassword);
    }
}
