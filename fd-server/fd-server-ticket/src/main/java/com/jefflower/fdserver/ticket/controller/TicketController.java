package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.ticket.dto.*;
import com.jefflower.fdserver.ticket.entity.*;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.service.AuditTokenService;
import com.jefflower.fdserver.ticket.service.TicketService;
import com.jefflower.fdserver.ticket.service.TicketStatusLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
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
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Tag(name = "工单", description = "工单查询、翻译、回复、审核、推送等核心业务接口")
@Slf4j
@RestController
@RequestMapping("/api/v1/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final TicketService ticketService;
    private final TaskDistributionService taskDistributionService;
    private final AuditTokenService auditTokenService;
    private final TicketStatusLogService ticketStatusLogService;

    /**
     * 工单列表查询 — 默认返回轻量 DTO（不含 content 等大字段），
     * 传入 detail=true 时返回完整 Ticket 实体（向后兼容）。
     * 支持通过 sort_by 和 sort_dir 控制排序。
     */
    @Operation(summary = "查询工单列表", description = "分页查询工单列表，支持按状态、主题、有效性、时间范围过滤。默认返回轻量 DTO，detail=true 时返回完整实体")
    @GetMapping
    @RequiresPermission("ticket:read")
    public ResponseEntity<?> queryTickets(
            @Parameter(description = "工单状态过滤（逗号分隔多选，如 PENDING_TRANS,TRANSLATING）") @RequestParam(required = false) String status,
            @Parameter(description = "Freshdesk 外部 ID") @RequestParam(required = false, name = "external_id") String externalId,
            @Parameter(description = "主题关键字搜索") @RequestParam(required = false) String subject,
            @Parameter(description = "有效性标记过滤") @RequestParam(required = false, name = "is_valid") Boolean isValid,
            @Parameter(description = "创建时间起始") @RequestParam(required = false, name = "created_after") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdAfter,
            @Parameter(description = "创建时间截止") @RequestParam(required = false, name = "created_before") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime createdBefore,
            @Parameter(description = "Freshdesk 状态过滤（逗号分隔多选，如 2,3）") @RequestParam(required = false, name = "fd_status") String fdStatus,
            @Parameter(description = "页码，从 0 开始") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "每页大小") @RequestParam(defaultValue = "20") int size,
            @Parameter(description = "排序字段") @RequestParam(required = false, name = "sort_by", defaultValue = "updatedAt") String sortBy,
            @Parameter(description = "排序方向（ASC/DESC）") @RequestParam(required = false, name = "sort_dir", defaultValue = "DESC") String sortDir,
            @Parameter(description = "是否返回完整实体（默认 false 返回轻量 DTO）") @RequestParam(required = false, defaultValue = "false") boolean detail) {

        // 解析逗号分隔的状态列表
        List<TicketStatus> statuses = null;
        if (status != null && !status.isBlank()) {
            statuses = Arrays.stream(status.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(TicketStatus::valueOf)
                    .toList();
        }
        List<Integer> fdStatuses = null;
        if (fdStatus != null && !fdStatus.isBlank()) {
            fdStatuses = Arrays.stream(fdStatus.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(Integer::valueOf)
                    .toList();
        }

        Sort sort = Sort.by("ASC".equalsIgnoreCase(sortDir) ? Sort.Order.asc(sortBy) : Sort.Order.desc(sortBy));

        if (detail) {
            Page<Ticket> tickets = ticketService.queryTickets(
                    statuses, externalId, subject, isValid, createdAfter, createdBefore, fdStatuses, page, size);
            if (!tickets.isEmpty()) {
                Ticket first = tickets.getContent().get(0);
                log.info("Query tickets (detail) page {} size {}: total={}, firstTicket#{} contentLen={}",
                        page, size, tickets.getTotalElements(), first.getId(),
                        first.getContent() != null ? first.getContent().length() : 0);
            }
            return ResponseEntity.ok(ApiResponse.ok(tickets));
        }

        Page<TicketListDTO> ticketDTOs = ticketService.queryTicketsAsDTO(
                statuses, externalId, subject, isValid, createdAfter, createdBefore, fdStatuses, page, size, sort);
        log.info("Query tickets (DTO) page {} size {}: total={}",
                page, size, ticketDTOs.getTotalElements());
        return ResponseEntity.ok(ApiResponse.ok(ticketDTOs));
    }

    @Operation(summary = "获取工单详情", description = "根据工单 ID 获取完整的工单详情，包含翻译、回复等关联数据")
    @GetMapping("/{id}")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<Ticket>> getTicket(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        Ticket ticket = ticketService.getTicketById(id);
        log.info("Get ticket #{} response size: subjectLen={}, contentLen={}",
                id,
                ticket.getSubject() != null ? ticket.getSubject().length() : 0,
                ticket.getContent() != null ? ticket.getContent().length() : 0);
        return ResponseEntity.ok(ApiResponse.ok(ticket));
    }

    @Operation(summary = "提交翻译结果", description = "为指定工单上报翻译结果，包含目标语言、翻译后的标题和内容")
    @PostMapping("/{id}/translation")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<TicketTranslation>> submitTranslation(
            @Parameter(description = "工单 ID") @PathVariable Long id,
            @Valid @RequestBody TranslationRequest request) {
        TicketTranslation translation = ticketService.submitTranslation(id, request);
        return ResponseEntity.ok(ApiResponse.ok("翻译上报成功", translation));
    }

    @Operation(summary = "提交回复", description = "为指定工单上报回复内容，包含中文回复和目标语言回复")
    @PostMapping("/{id}/reply")
    @RequiresPermission("ticket:reply")
    public ResponseEntity<ApiResponse<TicketReply>> submitReply(
            @Parameter(description = "工单 ID") @PathVariable Long id,
            @RequestBody ReplyRequest request) {
        TicketReply reply = ticketService.submitReply(id, request);
        return ResponseEntity.ok(ApiResponse.ok("回复上报成功", reply));
    }

    @Operation(summary = "提交审核结果", description = "对指定工单的回复进行审核（通过或驳回），驳回时需填写审核意见")
    @PostMapping("/{id}/audit")
    @RequiresPermission("ticket:audit")
    public ResponseEntity<ApiResponse<TicketAudit>> submitAudit(
            @Parameter(description = "工单 ID") @PathVariable Long id,
            @Valid @RequestBody AuditRequest request,
            Authentication authentication) {
        Long auditorId = (Long) authentication.getDetails();
        TicketAudit audit = ticketService.submitAudit(id, request, auditorId);
        return ResponseEntity.ok(ApiResponse.ok("审核提交成功", audit));
    }

    @Operation(summary = "更新回复", description = "更新指定工单的指定回复内容")
    @PutMapping("/{id}/reply/{replyId}")
    @RequiresPermission("ticket:reply")
    public ResponseEntity<ApiResponse<TicketReply>> updateReply(
            @Parameter(description = "工单 ID") @PathVariable Long id,
            @Parameter(description = "回复 ID") @PathVariable Long replyId,
            @RequestBody ReplyRequest request) {
        TicketReply reply = ticketService.updateReply(id, replyId, request);
        return ResponseEntity.ok(ApiResponse.ok("回复更新成功", reply));
    }

    @Operation(summary = "跳过回复", description = "跳过指定工单的回复环节，直接标记为完成")
    @PostMapping("/{id}/skip-reply")
    @RequiresPermission("ticket:manage")
    public ResponseEntity<ApiResponse<Void>> skipReply(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        ticketService.skipReply(id);
        return ResponseEntity.ok(ApiResponse.ok("回复已跳过，工单标记完成", null));
    }

    @Operation(summary = "重启工作流", description = "重置工单状态为 PENDING_TRANS，n8n 定时扫描自动拾取处理。统一替代 ai-translate / ai-reply 端点。")
    @PostMapping("/{id}/restart-workflow")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Void>> restartWorkflow(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        ticketService.restartWorkflow(id);
        return ResponseEntity.ok(ApiResponse.ok("工作流已重启", null));
    }

    @Deprecated
    @Operation(summary = "触发 AI 翻译（已废弃）", description = "已废弃，请使用 POST /{id}/restart-workflow。实际行为：重置状态为 PENDING_TRANS。")
    @PostMapping("/{id}/ai-translate")
    @RequiresPermission("ticket:translate")
    public ResponseEntity<ApiResponse<Void>> triggerAiTranslation(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        ticketService.triggerAiTranslation(id);
        return ResponseEntity.ok(ApiResponse.ok("工作流已重启", null));
    }

    @Deprecated
    @Operation(summary = "触发 AI 回复（已废弃）", description = "已废弃，请使用 POST /{id}/restart-workflow。实际行为：校验翻译存在后重置状态为 PENDING_TRANS。")
    @PostMapping("/{id}/ai-reply")
    @RequiresPermission("ticket:reply")
    public ResponseEntity<ApiResponse<Void>> triggerAiReply(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        ticketService.triggerAiReply(id);
        return ResponseEntity.ok(ApiResponse.ok("工作流已重启", null));
    }

    @Operation(summary = "推送回复到 Freshdesk", description = "将指定已审核通过（APPROVED）工单的回复推送到 Freshdesk")
    @PostMapping("/{id}/push-reply")
    @RequiresPermission("ticket:push")
    public ResponseEntity<ApiResponse<Void>> pushApprovedReply(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        ticketService.pushApprovedReply(id);
        return ResponseEntity.ok(ApiResponse.ok("回复已推送到 Freshdesk", null));
    }

    @Operation(summary = "批量推送回复", description = "批量将多个已审核通过（APPROVED）工单的回复推送到 Freshdesk")
    @PostMapping("/batch-push")
    @RequiresPermission("ticket:push")
    public ResponseEntity<ApiResponse<Integer>> batchPushReplies(
            @RequestBody java.util.List<Long> ticketIds) {
        int count = ticketService.batchPushApprovedReplies(ticketIds);
        return ResponseEntity.ok(ApiResponse.ok("批量推送完成", count));
    }

    @Operation(summary = "获取队列计数", description = "获取翻译、回复、审核各队列中待处理和已领取的任务数量")
    @GetMapping("/queue-counts")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<Map<String, Long>>> getQueueCounts() {
        List<TaskStatus> pendingStatuses = List.of(TaskStatus.PENDING, TaskStatus.CLAIMED);
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("translation", taskDistributionService.countByTypeAndStatuses("ticket.translate", pendingStatuses));
        counts.put("reply", taskDistributionService.countByTypeAndStatuses("ticket.reply", pendingStatuses));
        counts.put("audit", taskDistributionService.countByTypeAndStatuses("ticket.audit", pendingStatuses));
        return ResponseEntity.ok(ApiResponse.ok(counts));
    }

    @Operation(summary = "更新工单有效性", description = "标记工单的知识库有效性（用于数据导出和筛选）")
    @PostMapping("/{id}/valid")
    @RequiresPermission("ticket:manage")
    public ResponseEntity<ApiResponse<Ticket>> updateValidity(
            @Parameter(description = "工单 ID") @PathVariable Long id,
            @RequestBody ValidRequest request) {
        Ticket ticket = ticketService.updateValidity(id, request.getIsValid());
        return ResponseEntity.ok(ApiResponse.ok("有效性更新成功", ticket));
    }

    @Operation(summary = "获取工单状态转换历史", description = "查询指定工单的状态转换日志，按时间正序排列")
    @GetMapping("/{id}/status-history")
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<TicketStatusLog>>> getStatusHistory(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        List<TicketStatusLog> history = ticketStatusLogService.getHistory(id);
        return ResponseEntity.ok(ApiResponse.ok(history));
    }

    @Operation(summary = "获取工单的审核 Token", description = "获取或创建指定工单的审核 Token，供桌面端预览移动审核页面使用")
    @GetMapping("/{id}/audit-token")
    @RequiresPermission("ticket:audit")
    public ResponseEntity<ApiResponse<Map<String, String>>> getAuditToken(
            @Parameter(description = "工单 ID") @PathVariable Long id) {
        String token = auditTokenService.getOrCreateToken(id);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("token", token)));
    }
}
