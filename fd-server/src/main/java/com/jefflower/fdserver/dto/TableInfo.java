package com.jefflower.fdserver.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class TableInfo {
    private String tableName;
    private List<ColumnDetail> columns;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ColumnDetail {
        private String name;
        private String type;
        private boolean nullable;
        private boolean primaryKey;
    }
}
