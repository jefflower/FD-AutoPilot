package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.SqlQueryResult;
import com.jefflower.fdserver.dto.TableInfo;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.*;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class DatabaseQueryService {

    private final DataSource dataSource;

    private static final Set<String> BLOCKED_KEYWORDS = Set.of(
            "SHUTDOWN", "SCRIPT TO", "RUNSCRIPT"
    );

    private static final Set<String> DESTRUCTIVE_PREFIXES = Set.of(
            "DROP", "DELETE", "TRUNCATE", "ALTER", "UPDATE", "INSERT"
    );

    public SqlQueryResult executeQuery(String sql, Integer maxRows) {
        if (sql == null || sql.isBlank()) {
            return SqlQueryResult.error("SQL 不能为空");
        }

        String trimmedSql = sql.trim();
        String upperSql = trimmedSql.toUpperCase();

        // 检查绝对禁止的命令
        for (String blocked : BLOCKED_KEYWORDS) {
            if (upperSql.contains(blocked)) {
                return SqlQueryResult.error("禁止执行的 SQL 命令: " + blocked);
            }
        }

        // 标记是否为破坏性操作
        boolean isDestructive = DESTRUCTIVE_PREFIXES.stream()
                .anyMatch(upperSql::startsWith);

        int effectiveMaxRows = (maxRows != null && maxRows > 0)
                ? Math.min(maxRows, 1000)
                : 200;

        long startTime = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            stmt.setMaxRows(effectiveMaxRows);
            boolean hasResultSet = stmt.execute(trimmedSql);
            long duration = System.currentTimeMillis() - startTime;

            if (hasResultSet) {
                try (ResultSet rs = stmt.getResultSet()) {
                    return buildQueryResult(rs, duration);
                }
            } else {
                int updateCount = stmt.getUpdateCount();
                return SqlQueryResult.updateResult(updateCount, duration, isDestructive);
            }
        } catch (SQLException e) {
            log.warn("SQL 执行失败: {}", e.getMessage());
            return SqlQueryResult.error(e.getMessage());
        }
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
                // 将非基础类型转为字符串以确保 JSON 序列化
                if (value != null && !(value instanceof Number)
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
