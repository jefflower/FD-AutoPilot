package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.dto.AuditRequest;
import com.jefflower.fdserver.ticket.dto.MobileAuditDetailResponse;
import com.jefflower.fdserver.ticket.dto.MobileAuditSubmitRequest;
import com.jefflower.fdserver.ticket.dto.MobileAuditSubmitResponse;
import com.jefflower.fdserver.ticket.service.AuditTokenService;
import com.jefflower.fdserver.ticket.service.TicketService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Tag(name = "移动审核", description = "通过一次性 Token 进行移动端工单审核（无需 JWT）")
@Slf4j
@RestController
@RequestMapping("/api/v1/audit-token")
@RequiredArgsConstructor
public class AuditTokenController {

    private final AuditTokenService auditTokenService;
    private final TicketService ticketService;

    @Operation(summary = "通过 Token 获取工单详情", description = "移动端通过审核 Token 获取工单详情，无需 JWT 认证")
    @GetMapping("/{token}")
    public ResponseEntity<ApiResponse<MobileAuditDetailResponse>> getDetailByToken(@PathVariable String token) {
        MobileAuditDetailResponse detail = auditTokenService.getDetailByToken(token);
        return ResponseEntity.ok(ApiResponse.ok(detail));
    }

    @Operation(summary = "通过 Token 提交审核", description = "移动端通过审核 Token 提交审核结果，先到先得")
    @PostMapping("/{token}/submit")
    public ResponseEntity<ApiResponse<MobileAuditSubmitResponse>> submitByToken(
            @PathVariable String token,
            @Valid @RequestBody MobileAuditSubmitRequest request) {

        // 1. 消费 Token（悲观锁防并发）
        Long ticketId = auditTokenService.consumeToken(token);
        if (ticketId == null) {
            // Token 已被使用 -- 已被他人审核
            return ResponseEntity.ok(ApiResponse.ok(MobileAuditSubmitResponse.fail("该工单已被他人审核")));
        }

        // 2. 构造审核请求并调用 TicketService（复用现有审核逻辑）
        try {
            var ticket = ticketService.getTicketById(ticketId);
            Long replyId = ticket.getReplies() != null
                    ? ticket.getReplies().stream().findFirst().map(r -> r.getId()).orElse(null)
                    : null;
            if (replyId == null) {
                return ResponseEntity.ok(ApiResponse.ok(MobileAuditSubmitResponse.fail("工单无回复内容，无法审核")));
            }

            AuditRequest auditRequest = new AuditRequest();
            auditRequest.setReplyId(replyId);
            auditRequest.setAuditResult(request.getAuditResult());
            auditRequest.setAuditRemark(request.getAuditRemark());

            // auditorId = null 表示移动端匿名审核
            ticketService.submitAudit(ticketId, auditRequest, null);

            String message = "PASS".equals(request.getAuditResult().name())
                    ? "审核通过，工单已进入推送队列"
                    : "审核驳回，工单已重新进入回复队列";

            return ResponseEntity.ok(ApiResponse.ok(
                    MobileAuditSubmitResponse.ok(message, request.getAuditResult().name())));
        } catch (Exception e) {
            log.error("[AuditToken] 移动审核提交失败: token={}", token, e);
            return ResponseEntity.ok(ApiResponse.ok(MobileAuditSubmitResponse.fail("审核提交失败: " + e.getMessage())));
        }
    }
}
