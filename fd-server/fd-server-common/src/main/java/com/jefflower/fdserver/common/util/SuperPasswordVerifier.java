package com.jefflower.fdserver.common.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

@Slf4j
public final class SuperPasswordVerifier {
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();
    private SuperPasswordVerifier() {}

    public static boolean verify(String rawInput, String configuredValue) {
        if (rawInput == null || configuredValue == null) { return false; }
        if (isBCryptHash(configuredValue)) { return ENCODER.matches(rawInput, configuredValue); }
        log.warn("[安全警告] 超级密码(app.super-password)当前为明文存储，强烈建议替换为 BCrypt 哈希值。可使用 SuperPasswordVerifier.encode() 生成哈希后写入配置文件。");
        return configuredValue.equals(rawInput);
    }

    private static boolean isBCryptHash(String value) {
        return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
    }

    public static String encode(String rawPassword) { return ENCODER.encode(rawPassword); }
}
