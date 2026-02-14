package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.dto.BatchValidRequest;
import com.jefflower.fdserver.ticket.dto.KnowledgeNoteRequest;
import com.jefflower.fdserver.ticket.entity.KnowledgeNote;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.service.KnowledgeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/knowledge")
@RequiredArgsConstructor
public class KnowledgeController {

    private final KnowledgeService knowledgeService;

    // ========== 注意事项 CRUD ==========

    @GetMapping("/notes")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<List<KnowledgeNote>>> getAllNotes() {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeService.getAllNotes()));
    }

    @PostMapping("/notes")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeNote>> createNote(
            @Valid @RequestBody KnowledgeNoteRequest request) {
        KnowledgeNote note = knowledgeService.createNote(request);
        return ResponseEntity.ok(ApiResponse.ok("创建成功", note));
    }

    @PutMapping("/notes/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeNote>> updateNote(
            @PathVariable Long id,
            @Valid @RequestBody KnowledgeNoteRequest request) {
        KnowledgeNote note = knowledgeService.updateNote(id, request);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", note));
    }

    @DeleteMapping("/notes/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> deleteNote(@PathVariable Long id) {
        knowledgeService.deleteNote(id);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    // ========== 批量标记有效性 ==========

    @PostMapping("/batch-valid")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Integer>> batchUpdateValidity(
            @RequestBody BatchValidRequest request) {
        int count = knowledgeService.batchUpdateValidity(
                request.getTicketIds(), request.getIsValid());
        return ResponseEntity.ok(ApiResponse.ok("批量更新成功", count));
    }

    // ========== 导出 ==========

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
