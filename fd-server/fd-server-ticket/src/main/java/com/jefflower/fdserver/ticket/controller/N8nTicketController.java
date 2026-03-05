package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketStatusLog;
import com.jefflower.fdserver.ticket.service.N8nTicketService;
import com.jefflower.fdserver.ticket.service.TicketStatusLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * n8n 工单自动化控制器
 * <p>
 * Agent 调用由通用端点 POST /api/v1/n8n/agents/{agentCode}/execute 处理（自动准备输入）。
 * 本控制器负责：查询工单、保存 Agent 结果、推送通知。
 */
@Tag(name = "n8n 工单自动化", description = "供 n8n 工作流调用的工单处理接口")
@Slf4j
@RestController
@RequestMapping("/api/v1/n8n/tickets")
@RequiredArgsConstructor
public class N8nTicketController {

    private final N8nTicketService n8nTicketService;
    private final TicketStatusLogService ticketStatusLogService;

    // ========== 查询 ==========

    @Operation(summary = "获取待翻译工单", description = "查询 PENDING_TRANS 状态工单，可按 fdStatus 过滤 Freshdesk 状态（2=Open），limit 默认20，最大100")
    @GetMapping("/pending")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<Ticket>>> getPendingTickets(
            @RequestParam(value = "limit", defaultValue = "20") int limit,
            @RequestParam(value = "fdStatus", required = false) Integer fdStatus) {
        List<Ticket> tickets = n8nTicketService.findPendingTickets(limit, fdStatus);
        log.info("[N8nTicketController] 查询待处理工单: count={}, limit={}, fdStatus={}", tickets.size(), limit, fdStatus);
        return ResponseEntity.ok(ApiResponse.ok(tickets));
    }

    @Operation(summary = "获取待重新回复工单", description = "查询审核驳回后需要重新回复的工单（PROCESSING 状态）")
    @GetMapping("/pending-reply")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<Ticket>>> getPendingReplyTickets(
            @RequestParam(value = "limit", defaultValue = "20") int limit) {
        List<Ticket> tickets = n8nTicketService.findPendingReplyTickets(limit);
        log.info("[N8nTicketController] 查询待重新回复工单: count={}, limit={}", tickets.size(), limit);
        return ResponseEntity.ok(ApiResponse.ok(tickets));
    }

    // ========== 保存 Agent 结果 ==========

    @Operation(summary = "保存翻译结果", description = "保存翻译 Agent 的执行结果，更新工单状态")
    @PostMapping("/{id}/save-translation")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> saveTranslation(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        String translatedTitle = body.getOrDefault("translatedTitle", "");
        String translatedContent = body.getOrDefault("translatedContent", "");
        String targetLang = body.getOrDefault("targetLang", "zh-CN");
        String ticketCategory = body.get("ticketCategory");
        Map<String, Object> result = n8nTicketService.saveTranslationResult(id, translatedTitle, translatedContent, targetLang, ticketCategory);
        return ResponseEntity.ok(ApiResponse.ok("翻译结果已保存", result));
    }

    @Operation(summary = "保存回复结果", description = "保存回复 Agent 的执行结果，更新工单状态为待审核")
    @PostMapping("/{id}/save-reply")
    @RequiresPermission("ticket:reply")
    public ResponseEntity<ApiResponse<Map<String, Object>>> saveReply(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        String targetReply = body.getOrDefault("targetReply", "");
        String zhReply = body.getOrDefault("zhReply", "");
        Map<String, Object> result = n8nTicketService.saveReplyResult(id, targetReply, zhReply);
        return ResponseEntity.ok(ApiResponse.ok("回复结果已保存", result));
    }

    // ========== 通知 ==========

    @Operation(summary = "推送审核通知", description = "生成审核链接并通过钉钉/企微推送通知")
    @PostMapping("/{id}/notify-audit")
    @RequiresPermission("ticket:audit")
    public ResponseEntity<ApiResponse<Map<String, Object>>> notifyPendingAudit(
            @PathVariable Long id) {
        Map<String, Object> result = n8nTicketService.notifyPendingAudit(id);
        return ResponseEntity.ok(ApiResponse.ok("审核通知已发送", result));
    }

    // ========== AI 判定已解决 ==========

    @Operation(summary = "AI 判定工单已解决",
            description = "翻译 Agent 判定工单为已解决状态，更新 Freshdesk 为 Resolved(4) 并完结工单")
    @PostMapping("/{id}/resolve-completed")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> resolveCompleted(@PathVariable Long id) {
        Map<String, Object> result = n8nTicketService.resolveCompleted(id);
        return ResponseEntity.ok(ApiResponse.ok("工单已完结", result));
    }

    // ========== 人工处理 ==========

    @Operation(summary = "标记为人工处理", description = "将工单标记为需人工处理状态")
    @PostMapping("/{id}/mark-manual")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> markManualRequired(
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, String> body) {
        String reason = body != null ? body.get("reason") : null;
        Map<String, Object> result = n8nTicketService.markManualRequired(id, reason);
        return ResponseEntity.ok(ApiResponse.ok("已标记为人工处理", result));
    }

    @Operation(summary = "获取待人工处理工单", description = "查询所有 MANUAL_REQUIRED 状态的工单")
    @GetMapping("/manual-required")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<Ticket>>> getManualRequiredTickets(
            @RequestParam(value = "limit", defaultValue = "50") int limit) {
        List<Ticket> tickets = n8nTicketService.findManualRequiredTickets(limit);
        return ResponseEntity.ok(ApiResponse.ok(tickets));
    }

    @Operation(summary = "人工处理完成", description = "人工处理后继续处理或直接完结")
    @PostMapping("/{id}/resolve-manual")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> resolveManualTicket(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        String action = body.getOrDefault("action", "");
        Map<String, Object> result = n8nTicketService.resolveManualTicket(id, action);
        return ResponseEntity.ok(ApiResponse.ok("人工处理完成", result));
    }

    // ========== 刷新工单数据 ==========

    @Operation(summary = "刷新工单 Freshdesk 数据", description = "从 Freshdesk API 同步工单最新内容（含对话），不改变工单状态")
    @PostMapping("/{id}/refresh")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<Ticket>> refreshTicket(@PathVariable Long id) {
        Ticket ticket = n8nTicketService.refreshAndGetTicket(id);
        return ResponseEntity.ok(ApiResponse.ok(ticket));
    }

    // ========== 调试 ==========

    @Operation(summary = "获取工单状态转换历史", description = "查询状态转换日志，供 n8n 调试")
    @GetMapping("/{ticketId}/status-history")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<TicketStatusLog>>> getStatusHistory(
            @PathVariable Long ticketId) {
        List<TicketStatusLog> history = ticketStatusLogService.getHistory(ticketId);
        return ResponseEntity.ok(ApiResponse.ok(history));
    }
}
