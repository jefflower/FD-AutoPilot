package com.jefflower.fdserver.common.util;

public final class PasswordValidator {
    private static final int MIN_LENGTH = 8;
    private PasswordValidator() {}

    public static ValidationResult validate(String password) {
        if (password == null || password.isBlank()) {
            return ValidationResult.fail("密码不能为空");
        }
        if (password.length() < MIN_LENGTH) {
            return ValidationResult.fail("密码长度至少 " + MIN_LENGTH + " 位");
        }
        if (!password.matches(".*[a-zA-Z].*")) {
            return ValidationResult.fail("密码必须包含至少一个字母");
        }
        if (!password.matches(".*\\d.*")) {
            return ValidationResult.fail("密码必须包含至少一个数字");
        }
        return ValidationResult.ok();
    }

    public static class ValidationResult {
        private final boolean valid;
        private final String message;
        private ValidationResult(boolean valid, String message) { this.valid = valid; this.message = message; }
        public static ValidationResult ok() { return new ValidationResult(true, null); }
        public static ValidationResult fail(String message) { return new ValidationResult(false, message); }
        public boolean isValid() { return valid; }
        public String getMessage() { return message; }
    }
}
