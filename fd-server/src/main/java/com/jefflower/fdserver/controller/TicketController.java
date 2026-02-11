package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.*;
import com.jefflower.fdserver.entity.*;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.service.MqQueueService;
import com.jefflower.fdserver.service.TicketService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final TicketService ticketService;
    private final MqQueueService mqQueueService;

    /**
     * 工单列表查询 — 默认返回轻量 DTO（不含 content 等大字段），
     * 传入 detail=true 时返回完整 Ticket 实体（向后兼容）。
     * 支持通过 sort_by 和 sort_dir 控制排序。
     */
    @GetMapping
    public ResponseEntity<?> queryTickets(
            @RequestParam(required = false) TicketStatus status,
            @RequestParam(required = false, name = "external_id") String externalId,
            @RequestParam(required = false) String subject,
            @RequestParam(required = false, name = "is_valid") Boolean isValid,
            @RequestParam(required = false, name = "created_after") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdAfter,
            @RequestParam(required = false, name = "created_before") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdBefore,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false, name = "sort_by", defaultValue = "updatedAt") String sortBy,
            @RequestParam(required = false, name = "sort_dir", defaultValue = "DESC") String sortDir,
            @RequestParam(required = false, defaultValue = "false") boolean detail) {

        Sort sort = Sort.by("ASC".equalsIgnoreCase(sortDir) ? Sort.Order.asc(sortBy) : Sort.Order.desc(sortBy));

        if (detail) {
            // 向后兼容模式：返回完整 Ticket 实体（含 content、关联数据）
            Page<Ticket> tickets = ticketService.queryTickets(
                    status, externalId, subject, isValid, createdAfter, createdBefore, page, size);
            if (!tickets.isEmpty()) {
                Ticket first = tickets.getContent().get(0);
                log.info("Query tickets (detail) page {} size {}: total={}, firstTicket#{} contentLen={}",
                        page, size, tickets.getTotalElements(), first.getId(),
                        first.getContent() != null ? first.getContent().length() : 0);
            }
            return ResponseEntity.ok(ApiResponse.ok(tickets));
        }

        // 默认模式：返回轻量 DTO（不含 content、不加载关联数据）
        Page<TicketListDTO> ticketDTOs = ticketService.queryTicketsAsDTO(
                status, externalId, subject, isValid, createdAfter, createdBefore, page, size, sort);
        log.info("Query tickets (DTO) page {} size {}: total={}",
                page, size, ticketDTOs.getTotalElements());
        return ResponseEntity.ok(ApiResponse.ok(ticketDTOs));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Ticket>> getTicket(@PathVariable Long id) {
        Ticket ticket = ticketService.getTicketById(id);
        log.info("Get ticket #{} response size: subjectLen={}, contentLen={}",
                id,
                ticket.getSubject() != null ? ticket.getSubject().length() : 0,
                ticket.getContent() != null ? ticket.getContent().length() : 0);
        return ResponseEntity.ok(ApiResponse.ok(ticket));
    }

    @PostMapping("/{id}/translation")
    public ResponseEntity<ApiResponse<TicketTranslation>> submitTranslation(
            @PathVariable Long id,
            @Valid @RequestBody TranslationRequest request) {
        TicketTranslation translation = ticketService.submitTranslation(id, request);
        return ResponseEntity.ok(ApiResponse.ok("翻译上报成功", translation));
    }

    @PostMapping("/{id}/reply")
    public ResponseEntity<ApiResponse<TicketReply>> submitReply(
            @PathVariable Long id,
            @RequestBody ReplyRequest request) {
        TicketReply reply = ticketService.submitReply(id, request);
        return ResponseEntity.ok(ApiResponse.ok("回复上报成功", reply));
    }

    @PostMapping("/{id}/audit")
    public ResponseEntity<ApiResponse<TicketAudit>> submitAudit(
            @PathVariable Long id,
            @Valid @RequestBody AuditRequest request,
            Authentication authentication) {
        Long auditorId = (Long) authentication.getDetails();
        TicketAudit audit = ticketService.submitAudit(id, request, auditorId);
        return ResponseEntity.ok(ApiResponse.ok("审核提交成功", audit));
    }

    @PutMapping("/{id}/reply/{replyId}")
    public ResponseEntity<ApiResponse<TicketReply>> updateReply(
            @PathVariable Long id,
            @PathVariable Long replyId,
            @RequestBody ReplyRequest request) {
        TicketReply reply = ticketService.updateReply(id, replyId, request);
        return ResponseEntity.ok(ApiResponse.ok("回复更新成功", reply));
    }

    @PostMapping("/{id}/skip-reply")
    public ResponseEntity<ApiResponse<Void>> skipReply(@PathVariable Long id) {
        ticketService.skipReply(id);
        return ResponseEntity.ok(ApiResponse.ok("回复已跳过，工单标记完成", null));
    }

    @PostMapping("/{id}/ai-translate")
    public ResponseEntity<ApiResponse<Void>> triggerAiTranslation(@PathVariable Long id) {
        ticketService.triggerAiTranslation(id);
        return ResponseEntity.ok(ApiResponse.ok("AI翻译任务已触发", null));
    }

    @PostMapping("/{id}/ai-reply")
    public ResponseEntity<ApiResponse<Void>> triggerAiReply(@PathVariable Long id) {
        ticketService.triggerAiReply(id);
        return ResponseEntity.ok(ApiResponse.ok("AI回复任务已触发", null));
    }

    @PostMapping("/{id}/push-reply")
    public ResponseEntity<ApiResponse<Void>> pushApprovedReply(@PathVariable Long id) {
        ticketService.pushApprovedReply(id);
        return ResponseEntity.ok(ApiResponse.ok("回复已推送到 Freshdesk", null));
    }

    @PostMapping("/batch-push")
    public ResponseEntity<ApiResponse<Integer>> batchPushReplies(
            @RequestBody java.util.List<Long> ticketIds) {
        int count = ticketService.batchPushApprovedReplies(ticketIds);
        return ResponseEntity.ok(ApiResponse.ok("批量推送完成", count));
    }

    @GetMapping("/queue-counts")
    public ResponseEntity<ApiResponse<Map<String, Long>>> getQueueCounts() {
        return ResponseEntity.ok(ApiResponse.ok(mqQueueService.getQueueCounts()));
    }

    @PostMapping("/{id}/valid")
    public ResponseEntity<ApiResponse<Ticket>> updateValidity(
            @PathVariable Long id,
            @RequestBody ValidRequest request) {
        Ticket ticket = ticketService.updateValidity(id, request.getIsValid());
        return ResponseEntity.ok(ApiResponse.ok("有效性更新成功", ticket));
    }
}
