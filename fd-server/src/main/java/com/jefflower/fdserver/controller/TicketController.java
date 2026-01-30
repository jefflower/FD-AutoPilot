package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.*;
import com.jefflower.fdserver.entity.*;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.service.TicketService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;

@Slf4j
@RestController
@RequestMapping("/api/v1/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final TicketService ticketService;

    @GetMapping
    public ResponseEntity<ApiResponse<Page<Ticket>>> queryTickets(
            @RequestParam(required = false) TicketStatus status,
            @RequestParam(required = false, name = "external_id") String externalId,
            @RequestParam(required = false) String subject,
            @RequestParam(required = false, name = "is_valid") Boolean isValid,
            @RequestParam(required = false, name = "created_after") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdAfter,
            @RequestParam(required = false, name = "created_before") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdBefore,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        Page<Ticket> tickets = ticketService.queryTickets(
                status, externalId, subject, isValid, createdAfter, createdBefore, page, size);
        if (!tickets.isEmpty()) {
            Ticket first = tickets.getContent().get(0);
            log.info("Query tickets page {} size {}: total={}, firstTicket#{} contentLen={}",
                    page, size, tickets.getTotalElements(), first.getId(),
                    first.getContent() != null ? first.getContent().length() : 0);
        }
        return ResponseEntity.ok(ApiResponse.ok(tickets));
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
        log.info("Received translation for ticket #{}: targetLang={}, titleLen={}, contentLen={}",
                id, request.getTargetLang(),
                request.getTranslatedTitle() != null ? request.getTranslatedTitle().length() : 0,
                request.getTranslatedContent() != null ? request.getTranslatedContent().length() : 0);
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

    @PostMapping("/{id}/valid")
    public ResponseEntity<ApiResponse<Ticket>> updateValidity(
            @PathVariable Long id,
            @RequestBody ValidRequest request) {
        Ticket ticket = ticketService.updateValidity(id, request.getIsValid());
        return ResponseEntity.ok(ApiResponse.ok("有效性更新成功", ticket));
    }
}
