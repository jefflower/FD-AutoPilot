package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.dto.SqlQueryRequest;
import com.jefflower.fdserver.dto.SqlQueryResult;
import com.jefflower.fdserver.dto.TableInfo;
import com.jefflower.fdserver.service.DatabaseQueryService;
import com.jefflower.fdserver.util.SqlValidator;
import com.jefflower.fdserver.util.SqlValidator.ValidationResult;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/database")
@RequiredArgsConstructor
@Slf4j
public class DatabaseController {

    private final DatabaseQueryService databaseQueryService;

    @PostMapping("/query")
    public ResponseEntity<ApiResponse<SqlQueryResult>> executeQuery(
            @Valid @RequestBody SqlQueryRequest request) {

        String rawSql = request.getSql();

        // SQL 安全校验
        ValidationResult validation = SqlValidator.validate(rawSql);
        if (!validation.valid()) {
            log.warn("SQL 校验未通过: {} | SQL: {}", validation.message(), rawSql);
            if (validation.httpStatus() == 403) {
                return ResponseEntity.status(403)
                        .body(ApiResponse.error("FORBIDDEN", validation.message()));
            }
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("BAD_REQUEST", validation.message()));
        }

        // 自动注入 LIMIT
        int maxRows = (request.getMaxRows() != null && request.getMaxRows() > 0)
                ? request.getMaxRows()
                : SqlValidator.DEFAULT_MAX_ROWS;
        String safeSql = SqlValidator.ensureLimit(rawSql, maxRows);

        SqlQueryResult result = databaseQueryService.executeQuery(safeSql, maxRows);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/tables")
    public ResponseEntity<ApiResponse<List<TableInfo>>> getTables() {
        List<TableInfo> tables = databaseQueryService.getTableMetadata();
        return ResponseEntity.ok(ApiResponse.ok(tables));
    }
}
