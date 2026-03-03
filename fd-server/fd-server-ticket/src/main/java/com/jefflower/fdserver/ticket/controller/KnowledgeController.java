package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.dto.BatchValidRequest;
import com.jefflower.fdserver.ticket.dto.KnowledgeNoteRequest;
import com.jefflower.fdserver.ticket.entity.KnowledgeNote;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.service.KnowledgeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.List;

@Tag(name = "知识库", description = "知识库注意事项管理、批量有效性标记、数据导出")
@RestController
@RequestMapping("/api/v1/admin/knowledge")
@RequiredArgsConstructor
public class KnowledgeController {

    private final KnowledgeService knowledgeService;

    // ========== 注意事项 CRUD ==========

    @Operation(summary = "获取所有注意事项", description = "获取知识库中所有注意事项列表，按 sortOrder 排序")
    @GetMapping("/notes")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<List<KnowledgeNote>>> getAllNotes() {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeService.getAllNotes()));
    }

    @Operation(summary = "创建注意事项", description = "在知识库中新增一条注意事项")
    @PostMapping("/notes")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeNote>> createNote(
            @Valid @RequestBody KnowledgeNoteRequest request) {
        KnowledgeNote note = knowledgeService.createNote(request);
        return ResponseEntity.ok(ApiResponse.ok("创建成功", note));
    }

    @Operation(summary = "更新注意事项", description = "更新知识库中指定的注意事项")
    @PutMapping("/notes/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeNote>> updateNote(
            @Parameter(description = "注意事项 ID") @PathVariable Long id,
            @Valid @RequestBody KnowledgeNoteRequest request) {
        KnowledgeNote note = knowledgeService.updateNote(id, request);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", note));
    }

    @Operation(summary = "删除注意事项", description = "从知识库中删除指定的注意事项")
    @DeleteMapping("/notes/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> deleteNote(
            @Parameter(description = "注意事项 ID") @PathVariable Long id) {
        knowledgeService.deleteNote(id);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    // ========== 批量标记有效性 ==========

    @Operation(summary = "批量更新工单有效性", description = "批量标记多个工单的知识库有效性")
    @PostMapping("/batch-valid")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Integer>> batchUpdateValidity(
            @RequestBody BatchValidRequest request) {
        int count = knowledgeService.batchUpdateValidity(
                request.getTicketIds(), request.getIsValid());
        return ResponseEntity.ok(ApiResponse.ok("批量更新成功", count));
    }

    // ========== 导出 ==========

    @Operation(summary = "导出有效工单 CSV", description = "将所有标记为有效的工单导出为 CSV 文件（含标题和原文内容）")
    @GetMapping("/export/tickets")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<byte[]> exportValidTicketsCsv() {
        List<Ticket> tickets = knowledgeService.getValidTickets();
        StringBuilder csv = new StringBuilder();
        csv.append('\uFEFF'); // UTF-8 BOM for Excel
        csv.append("标题,原文内容\n");

        for (Ticket t : tickets) {
            csv.append(escapeCsv(t.getSubject())).append(',');
            csv.append(escapeCsv(t.getContent()));
            csv.append('\n');
        }

        byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=knowledge_tickets.csv")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(bytes);
    }

    @Operation(summary = "导出注意事项 CSV", description = "将所有注意事项导出为 CSV 文件（含标题和内容）")
    @GetMapping("/export/notes")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<byte[]> exportNotesCsv() {
        List<KnowledgeNote> notes = knowledgeService.getAllNotes();
        StringBuilder csv = new StringBuilder();
        csv.append('\uFEFF'); // UTF-8 BOM for Excel
        csv.append("标题,内容\n");

        for (KnowledgeNote n : notes) {
            csv.append(escapeCsv(n.getTitle())).append(',');
            csv.append(escapeCsv(n.getContent()));
            csv.append('\n');
        }

        byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=knowledge_notes.csv")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(bytes);
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
