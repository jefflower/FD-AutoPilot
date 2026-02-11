package com.jefflower.fdserver.util;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SQL 安全校验工具类。
 * <p>
 * 对用户提交的 SQL 进行多层校验：白名单关键字、危险关键字拦截、敏感表保护、LIMIT 自动注入。
 * 所有校验方法均为无副作用的纯函数。
 */
public final class SqlValidator {

    private SqlValidator() {
        // 工具类，禁止实例化
    }

    // ==================== 校验结果 ====================

    public record ValidationResult(boolean valid, int httpStatus, String message) {
        public static ValidationResult ok() {
            return new ValidationResult(true, 200, null);
        }

        public static ValidationResult badRequest(String message) {
            return new ValidationResult(false, 400, message);
        }

        public static ValidationResult forbidden(String message) {
            return new ValidationResult(false, 403, message);
        }
    }

    // ==================== 常量定义 ====================

    /** 允许的 SQL 起始关键字（白名单） */
    private static final Set<String> ALLOWED_PREFIXES = Set.of(
            "SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH"
    );

    /** 危险关键字 —— 出现在 SQL 中任意位置均拦截 */
    private static final Set<String> DANGEROUS_KEYWORDS = Set.of(
            // DDL
            "DROP", "ALTER", "TRUNCATE", "CREATE",
            // DML 写入
            "INSERT", "UPDATE", "DELETE", "MERGE",
            // 执行
            "EXEC", "EXECUTE", "CALL",
            // 系统
            "SHUTDOWN", "SCRIPT", "RUNSCRIPT"
    );

    /** 敏感表名（大写），禁止出现在查询中 */
    private static final Set<String> PROTECTED_TABLES = Set.of(
            "SYS_USER"
    );

    /** 匹配 SQL 单行注释 (-- ...) */
    private static final Pattern SINGLE_LINE_COMMENT = Pattern.compile("--[^\\r\\n]*");

    /** 匹配 SQL 多行注释 */
    private static final Pattern MULTI_LINE_COMMENT = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);

    /** 匹配 SQL 字符串字面量（单引号包裹） */
    private static final Pattern STRING_LITERAL = Pattern.compile("'(?:[^']|'')*'");

    /** 危险的组合模式 —— 分号后跟写操作 */
    private static final List<Pattern> DANGEROUS_PATTERNS = List.of(
            // 分号后跟危险关键字（中间可能有空白）
            Pattern.compile(";\\s*(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|EXEC|EXECUTE|SHUTDOWN|SCRIPT)",
                    Pattern.CASE_INSENSITIVE),
            // UNION 注入：UNION [ALL] SELECT
            Pattern.compile("UNION\\s+(ALL\\s+)?SELECT", Pattern.CASE_INSENSITIVE)
    );

    /** 默认最大行数限制 */
    public static final int DEFAULT_MAX_ROWS = 1000;

    // ==================== 公开 API ====================

    /**
     * 对 SQL 执行完整校验流程。
     *
     * @param rawSql 用户提交的原始 SQL
     * @return 校验结果
     */
    public static ValidationResult validate(String rawSql) {
        if (rawSql == null || rawSql.isBlank()) {
            return ValidationResult.badRequest("SQL 不能为空");
        }

        // Step 1: 预处理 —— 去除注释、trim
        String cleanedSql = removeComments(rawSql).trim();
        if (cleanedSql.isEmpty()) {
            return ValidationResult.badRequest("SQL 去除注释后为空");
        }

        // Step 2: 用于关键字检查的版本 —— 去掉字符串字面量，避免误判
        String sqlForKeywordCheck = removeStringLiterals(cleanedSql).toUpperCase();

        // Step 3: 白名单校验 —— 只允许特定开头
        ValidationResult prefixCheck = checkAllowedPrefix(sqlForKeywordCheck);
        if (!prefixCheck.valid()) {
            return prefixCheck;
        }

        // Step 4: 危险关键字拦截
        ValidationResult keywordCheck = checkDangerousKeywords(sqlForKeywordCheck);
        if (!keywordCheck.valid()) {
            return keywordCheck;
        }

        // Step 5: 危险模式拦截
        ValidationResult patternCheck = checkDangerousPatterns(sqlForKeywordCheck);
        if (!patternCheck.valid()) {
            return patternCheck;
        }

        // Step 6: 敏感表保护
        ValidationResult tableCheck = checkProtectedTables(sqlForKeywordCheck);
        if (!tableCheck.valid()) {
            return tableCheck;
        }

        // Step 7: 多语句检测 —— 禁止分号分隔的多条 SQL
        ValidationResult multiStmtCheck = checkMultipleStatements(sqlForKeywordCheck);
        if (!multiStmtCheck.valid()) {
            return multiStmtCheck;
        }

        return ValidationResult.ok();
    }

    /**
     * 为没有 LIMIT 子句的 SELECT 查询自动追加 LIMIT。
     * <p>
     * 注意：这里在清理后的 SQL 上操作，不会影响用户显式指定的 LIMIT。
     *
     * @param rawSql 用户提交的原始 SQL（已通过校验）
     * @param maxRows 最大行数
     * @return 可能追加了 LIMIT 的 SQL
     */
    public static String ensureLimit(String rawSql, int maxRows) {
        String cleanedSql = removeComments(rawSql).trim();
        String upperSql = cleanedSql.toUpperCase();

        // 只对 SELECT / WITH 查询追加 LIMIT
        if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
            return cleanedSql;
        }

        // 移除末尾分号
        if (cleanedSql.endsWith(";")) {
            cleanedSql = cleanedSql.substring(0, cleanedSql.length() - 1).trim();
            upperSql = cleanedSql.toUpperCase();
        }

        // 如果已经有 LIMIT 子句，不重复添加
        // 简单匹配：检查最后 200 个字符中是否有 LIMIT（避免子查询中的 LIMIT 干扰）
        String tail = upperSql.length() > 200 ? upperSql.substring(upperSql.length() - 200) : upperSql;
        if (tail.contains("LIMIT") || tail.contains("FETCH FIRST") || tail.contains("FETCH NEXT")) {
            return cleanedSql;
        }

        int effectiveMax = Math.min(maxRows, DEFAULT_MAX_ROWS);
        return cleanedSql + " LIMIT " + effectiveMax;
    }

    // ==================== 内部校验方法 ====================

    /**
     * 去除 SQL 注释（单行 + 多行）。
     */
    static String removeComments(String sql) {
        String result = MULTI_LINE_COMMENT.matcher(sql).replaceAll(" ");
        result = SINGLE_LINE_COMMENT.matcher(result).replaceAll(" ");
        return result;
    }

    /**
     * 去除 SQL 字符串字面量，避免字面量内容触发关键字误判。
     * 例如 SELECT * FROM t WHERE name = 'DROP TABLE' 中的 DROP TABLE 不应被拦截。
     */
    static String removeStringLiterals(String sql) {
        return STRING_LITERAL.matcher(sql).replaceAll("''");
    }

    /**
     * 检查 SQL 是否以允许的关键字开头。
     */
    private static ValidationResult checkAllowedPrefix(String upperSql) {
        for (String prefix : ALLOWED_PREFIXES) {
            if (upperSql.startsWith(prefix)) {
                return ValidationResult.ok();
            }
        }
        return ValidationResult.badRequest("仅允许 SELECT / SHOW / DESCRIBE / EXPLAIN / WITH 查询");
    }

    /**
     * 检查 SQL 是否包含危险关键字。
     * <p>
     * 使用单词边界匹配，避免 "UPDATED_AT" 这类列名被误判为 "UPDATE"。
     */
    private static ValidationResult checkDangerousKeywords(String upperSql) {
        for (String keyword : DANGEROUS_KEYWORDS) {
            // 使用单词边界正则：\bKEYWORD\b
            Pattern wordBoundary = Pattern.compile("\\b" + keyword + "\\b");
            if (wordBoundary.matcher(upperSql).find()) {
                return ValidationResult.badRequest("SQL 包含禁止的关键字: " + keyword);
            }
        }
        return ValidationResult.ok();
    }

    /**
     * 检查 SQL 是否匹配危险模式（如 ; DROP，UNION SELECT）。
     */
    private static ValidationResult checkDangerousPatterns(String upperSql) {
        for (Pattern pattern : DANGEROUS_PATTERNS) {
            if (pattern.matcher(upperSql).find()) {
                return ValidationResult.badRequest("SQL 包含危险模式，已被拦截");
            }
        }
        return ValidationResult.ok();
    }

    /**
     * 检查 SQL 是否引用了受保护的表。
     * <p>
     * 使用单词边界匹配，确保 "SYS_USER_LOG" 不会被误判。
     */
    private static ValidationResult checkProtectedTables(String upperSql) {
        for (String table : PROTECTED_TABLES) {
            Pattern wordBoundary = Pattern.compile("\\b" + table + "\\b");
            if (wordBoundary.matcher(upperSql).find()) {
                return ValidationResult.forbidden("禁止查询敏感表: " + table);
            }
        }
        return ValidationResult.ok();
    }

    /**
     * 检查是否存在多条 SQL 语句（分号分隔）。
     * <p>
     * 忽略末尾的分号，只检查中间的分号。
     */
    private static ValidationResult checkMultipleStatements(String upperSql) {
        // 去掉末尾分号
        String trimmed = upperSql.endsWith(";")
                ? upperSql.substring(0, upperSql.length() - 1).trim()
                : upperSql;
        if (trimmed.contains(";")) {
            return ValidationResult.badRequest("禁止执行多条 SQL 语句");
        }
        return ValidationResult.ok();
    }
}
