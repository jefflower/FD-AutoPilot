package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.dto.SqlQueryRequest;
import com.jefflower.fdserver.ticket.dto.SqlQueryResult;
import com.jefflower.fdserver.ticket.dto.TableInfo;
import com.jefflower.fdserver.ticket.service.DatabaseQueryService;
import com.jefflower.fdserver.common.util.SqlValidator;
import com.jefflower.fdserver.common.util.SqlValidator.ValidationResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "数据库", description = "数据库查询工具（仅限只读 SQL 查询）")
@RestController
@RequestMapping("/api/v1/admin/database")
@RequiredArgsConstructor
@Slf4j
public class DatabaseController {

    private final DatabaseQueryService databaseQueryService;

    @Operation(summary = "执行 SQL 查询", description = "执行只读 SQL 查询（仅允许 SELECT），自动注入 LIMIT 防止大结果集")
    @PostMapping("/query")
    @RequiresPermission("database:query")
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

    @Operation(summary = "获取数据库表信息", description = "获取所有数据库表的元数据信息（表名、列定义等）")
    @GetMapping("/tables")
    @RequiresPermission("database:query")
    public ResponseEntity<ApiResponse<List<TableInfo>>> getTables() {
        List<TableInfo> tables = databaseQueryService.getTableMetadata();
        return ResponseEntity.ok(ApiResponse.ok(tables));
    }
}
