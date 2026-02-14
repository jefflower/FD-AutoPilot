package com.jefflower.fdserver.ticket.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SqlQueryResult {
    private boolean success;
    private String error;

    // SELECT 查询结果
    private List<ColumnInfo> columns;
    private List<List<Object>> rows;
    private Integer rowCount;

    // DML 结果
    private Integer updateCount;
    private Boolean destructive;

    // 性能数据
    private long executionTimeMs;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ColumnInfo {
        private String name;
        private String type;
    }

    public static SqlQueryResult selectResult(List<ColumnInfo> columns, List<List<Object>> rows, long executionTimeMs) {
        return SqlQueryResult.builder()
                .success(true)
                .columns(columns)
                .rows(rows)
                .rowCount(rows.size())
                .executionTimeMs(executionTimeMs)
                .build();
    }

    public static SqlQueryResult updateResult(int updateCount, long executionTimeMs, boolean destructive) {
        return SqlQueryResult.builder()
                .success(true)
                .updateCount(updateCount)
                .executionTimeMs(executionTimeMs)
                .destructive(destructive)
                .build();
    }

    public static SqlQueryResult error(String errorMessage) {
        return SqlQueryResult.builder()
                .success(false)
                .error(errorMessage)
                .build();
    }
}
