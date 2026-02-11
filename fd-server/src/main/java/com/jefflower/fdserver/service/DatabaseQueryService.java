package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.SqlQueryResult;
import com.jefflower.fdserver.dto.TableInfo;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.Reader;
import java.sql.*;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class DatabaseQueryService {

    private final DataSource dataSource;

    /**
     * 执行已经过 SqlValidator 校验的 SQL 查询。
     * <p>
     * 安全校验已在 Controller 层由 SqlValidator 完成，
     * 此方法仅负责执行和结果组装。异常信息会脱敏后返回。
     *
     * @param sql     已校验的安全 SQL
     * @param maxRows 最大行数
     * @return 查询结果
     */
    public SqlQueryResult executeQuery(String sql, Integer maxRows) {
        if (sql == null || sql.isBlank()) {
            return SqlQueryResult.error("SQL 不能为空");
        }

        String trimmedSql = sql.trim();

        int effectiveMaxRows = (maxRows != null && maxRows > 0)
                ? Math.min(maxRows, 1000)
                : 200;

        long startTime = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            // 设置只读模式，防止意外写入
            conn.setReadOnly(true);

            stmt.setMaxRows(effectiveMaxRows);
            // 设置查询超时（秒），防止慢查询占用连接
            stmt.setQueryTimeout(30);

            boolean hasResultSet = stmt.execute(trimmedSql);
            long duration = System.currentTimeMillis() - startTime;

            if (hasResultSet) {
                try (ResultSet rs = stmt.getResultSet()) {
                    return buildQueryResult(rs, duration);
                }
            } else {
                // 理论上经过 SqlValidator 校验后不应到达此分支（只允许 SELECT）
                // 但作为防御性编程，仍然处理
                int updateCount = stmt.getUpdateCount();
                return SqlQueryResult.updateResult(updateCount, duration, false);
            }
        } catch (SQLException e) {
            long duration = System.currentTimeMillis() - startTime;
            // 错误信息脱敏：记录完整错误到日志，返回给前端的信息简化
            log.warn("SQL 执行失败 [{}ms]: {} | SQL: {}", duration, e.getMessage(), trimmedSql);
            return SqlQueryResult.error(sanitizeErrorMessage(e));
        }
    }

    /**
     * 将 SQL 异常信息脱敏，避免暴露数据库内部细节。
     */
    private String sanitizeErrorMessage(SQLException e) {
        String message = e.getMessage();
        if (message == null) {
            return "查询执行失败";
        }

        // 提取可以安全返回给用户的常见错误类型
        String upperMessage = message.toUpperCase();
        if (upperMessage.contains("SYNTAX") || upperMessage.contains("PARSE")) {
            return "查询执行失败: SQL 语法错误";
        }
        if (upperMessage.contains("NOT FOUND") || upperMessage.contains("NOT EXIST")) {
            return "查询执行失败: 表或列不存在";
        }
        if (upperMessage.contains("TIMEOUT") || upperMessage.contains("TIMED OUT")) {
            return "查询执行失败: 查询超时，请简化查询条件";
        }
        if (upperMessage.contains("PERMISSION") || upperMessage.contains("DENIED")) {
            return "查询执行失败: 权限不足";
        }
        if (upperMessage.contains("DATA TYPE") || upperMessage.contains("CONVERSION") || upperMessage.contains("CAST")) {
            return "查询执行失败: 数据类型不匹配";
        }
        if (upperMessage.contains("AMBIGUOUS")) {
            return "查询执行失败: 列名不明确，请指定表别名";
        }

        // 默认返回通用错误提示
        return "查询执行失败，请检查 SQL 语句是否正确";
    }

    private SqlQueryResult buildQueryResult(ResultSet rs, long duration) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int columnCount = meta.getColumnCount();

        List<SqlQueryResult.ColumnInfo> columns = new ArrayList<>();
        for (int i = 1; i <= columnCount; i++) {
            columns.add(new SqlQueryResult.ColumnInfo(
                    meta.getColumnLabel(i),
                    meta.getColumnTypeName(i)
            ));
        }

        List<List<Object>> rows = new ArrayList<>();
        while (rs.next()) {
            List<Object> row = new ArrayList<>();
            for (int i = 1; i <= columnCount; i++) {
                Object value = rs.getObject(i);
                if (value instanceof Clob clob) {
                    value = readClob(clob);
                } else if (value instanceof Blob blob) {
                    value = "(BLOB " + blob.length() + " bytes)";
                } else if (value instanceof byte[] bytes) {
                    value = "(BINARY " + bytes.length + " bytes)";
                } else if (value != null && !(value instanceof Number)
                        && !(value instanceof String)
                        && !(value instanceof Boolean)) {
                    value = value.toString();
                }
                row.add(value);
            }
            rows.add(row);
        }

        return SqlQueryResult.selectResult(columns, rows, duration);
    }

    private String readClob(Clob clob) {
        try (Reader reader = clob.getCharacterStream();
             BufferedReader br = new BufferedReader(reader)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int len;
            while ((len = br.read(buf)) != -1) {
                sb.append(buf, 0, len);
            }
            return sb.toString();
        } catch (Exception e) {
            log.warn("读取 CLOB 失败: {}", e.getMessage());
            return "(CLOB 读取失败)";
        }
    }

    public List<TableInfo> getTableMetadata() {
        List<TableInfo> tables = new ArrayList<>();

        String sql = """
                SELECT t.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
                       CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN TRUE ELSE FALSE END AS IS_PK
                FROM INFORMATION_SCHEMA.TABLES t
                JOIN INFORMATION_SCHEMA.COLUMNS c
                    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
                LEFT JOIN (
                    SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
                    AND c.TABLE_NAME = pk.TABLE_NAME
                    AND c.COLUMN_NAME = pk.COLUMN_NAME
                WHERE t.TABLE_SCHEMA = 'PUBLIC'
                ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
                """;

        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {

            Map<String, List<TableInfo.ColumnDetail>> tableMap = new LinkedHashMap<>();
            while (rs.next()) {
                String tableName = rs.getString("TABLE_NAME");
                TableInfo.ColumnDetail col = new TableInfo.ColumnDetail(
                        rs.getString("COLUMN_NAME"),
                        rs.getString("DATA_TYPE"),
                        "YES".equals(rs.getString("IS_NULLABLE")),
                        rs.getBoolean("IS_PK")
                );
                tableMap.computeIfAbsent(tableName, k -> new ArrayList<>()).add(col);
            }

            tableMap.forEach((name, cols) -> tables.add(new TableInfo(name, cols)));
        } catch (SQLException e) {
            log.error("获取表结构失败: {}", e.getMessage());
        }

        return tables;
    }
}
