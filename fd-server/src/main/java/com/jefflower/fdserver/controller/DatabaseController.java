package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.dto.SqlQueryRequest;
import com.jefflower.fdserver.dto.SqlQueryResult;
import com.jefflower.fdserver.dto.TableInfo;
import com.jefflower.fdserver.service.DatabaseQueryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/database")
@RequiredArgsConstructor
public class DatabaseController {

    private final DatabaseQueryService databaseQueryService;

    @PostMapping("/query")
    public ResponseEntity<ApiResponse<SqlQueryResult>> executeQuery(
            @Valid @RequestBody SqlQueryRequest request) {
        SqlQueryResult result = databaseQueryService.executeQuery(
                request.getSql(),
                request.getMaxRows()
        );
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/tables")
    public ResponseEntity<ApiResponse<List<TableInfo>>> getTables() {
        List<TableInfo> tables = databaseQueryService.getTableMetadata();
        return ResponseEntity.ok(ApiResponse.ok(tables));
    }
}
