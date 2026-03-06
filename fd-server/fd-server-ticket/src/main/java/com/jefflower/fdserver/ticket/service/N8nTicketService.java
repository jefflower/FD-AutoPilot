package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.entity.*;
import com.jefflower.fdserver.ticket.enums.TicketCategory;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * n8n 工单自动化服务
 * <p>
 * 提供工单自动化处理逻辑，供 n8n 工作流调用。
 * Agent 调用由通用端点 /agents/{agentCode}/execute 纯透传处理，本服务负责：
 * - 查询待处理工单
 * - 保存 Agent 执行结果
 * - 推送审核通知
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class N8nTicketService {

    private final TicketRepository ticketRepository;
    private final TicketTranslationRepository translationRepository;
    private final TicketReplyRepository replyRepository;
    private final AuditTokenService auditTokenService;
    private final NotifyService notifyService;
    private final TicketStatusLogService statusLogService;
    private final TicketStateMachine stateMachine;
    private final FreshdeskApiClient freshdeskApiClient;
    private final FreshdeskSyncService freshdeskSyncService;

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 100;

    // ========== 查询 ==========

    /**
     * 查询可被 n8n 处理的待翻译工单（PENDING_TRANS 状态）
     * @param fdStatus Freshdesk 状态过滤（可选，如 2=Open），null 则不过滤
     */
    public List<Ticket> findPendingTickets(int limit, Integer fdStatus) {
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ticketRepository.findByFilters(
                List.of(TicketStatus.PENDING_TRANS), null, null, null, null, null,
                fdStatus != null ? List.of(fdStatus) : null, null,
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Order.asc("createdAt")))
        ).getContent();
    }

    /**
     * 查询审核驳回后需要重新回复的工单（PROCESSING 状态）
     */
    public List<Ticket> findPendingReplyTickets(int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ticketRepository.findByFilters(
                List.of(TicketStatus.PROCESSING), null, null, null, null, null,
                null, null,
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Order.asc("updatedAt")))
        ).getContent();
    }

    // ========== 保存 Agent 结果 ==========

    /**
     * 保存翻译结果 — 删除旧翻译，保存新翻译，更新状态为 PROCESSING
     */
    @Transactional
    public Map<String, Object> saveTranslationResult(Long ticketId, String translatedTitle,
                                                      String translatedContent, String targetLang,
                                                      String ticketCategory,
                                                      String orderNumber, String trackingNumber,
                                                      String videoUrls) {
        Ticket ticket = getTicket(ticketId);
        String lang = targetLang != null ? targetLang : "zh-CN";

        log.info("[N8nTicketService] 保存翻译结果 #{}, targetLang={}, category={}", ticketId, lang, ticketCategory);

        if (ticket.getStatus() != TicketStatus.PENDING_TRANS && ticket.getStatus() != TicketStatus.PROCESSING) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + ticket.getStatus() + "，不可保存翻译结果");
        }

        TicketStatus beforeStatus = ticket.getStatus();

        // 保存 AI 分类类别
        if (ticketCategory != null) {
            ticket.setTicketCategory(ticketCategory);
        }

        // 保存物流单号（仅物流查询类工单）
        if (orderNumber != null && !orderNumber.isBlank()) {
            ticket.setOrderNumber(orderNumber);
        }
        if (trackingNumber != null && !trackingNumber.isBlank()) {
            ticket.setTrackingNumber(trackingNumber);
        }
        if (videoUrls != null && !videoUrls.isBlank()) {
            ticket.setVideoUrls(videoUrls);
        }

        // 删除旧翻译
        translationRepository.findByTicketAndTargetLang(ticket, lang)
                .ifPresent(translationRepository::delete);

        // 保存新翻译
        TicketTranslation translation = new TicketTranslation();
        translation.setTicket(ticket);
        translation.setTargetLang(lang);
        translation.setTranslatedTitle(translatedTitle);
        translation.setTranslatedContent(translatedContent);
        translationRepository.save(translation);

        // 更新状态
        if (ticket.getStatus() == TicketStatus.PENDING_TRANS) {
            ticket.setStatus(TicketStatus.PROCESSING);
            ticketRepository.save(ticket);
            statusLogService.logTransition(ticket, beforeStatus, TicketStatus.PROCESSING,
                    "n8n", "翻译结果已保存，等待回复");
        }

        log.info("[N8nTicketService] 工单 #{} 翻译结果已保存, title={}",
                ticketId, translatedTitle.substring(0, Math.min(50, translatedTitle.length())));

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("translatedTitle", translatedTitle);
        response.put("ticketCategory", ticketCategory);
        response.put("status", ticket.getStatus().name());
        return response;
    }

    /**
     * 保存回复结果 — 删除旧回复，保存新回复，更新状态为 PENDING_AUDIT
     */
    @Transactional
    public Map<String, Object> saveReplyResult(Long ticketId, String targetReply, String zhReply) {
        Ticket ticket = getTicket(ticketId);

        log.info("[N8nTicketService] 保存回复结果 #{}", ticketId);

        if (ticket.getStatus() != TicketStatus.PROCESSING && ticket.getStatus() != TicketStatus.REPLYING) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + ticket.getStatus() + "，不可保存回复结果");
        }

        TicketStatus beforeStatus = ticket.getStatus();

        // 删除旧回复
        replyRepository.deleteByTicket(ticket);

        // 保存新回复
        TicketReply reply = new TicketReply();
        reply.setTicket(ticket);
        reply.setTargetReply(targetReply);
        reply.setZhReply(zhReply);
        reply.setIsSelected(true);
        TicketReply saved = replyRepository.save(reply);

        // 更新状态
        ticket.setStatus(TicketStatus.PENDING_AUDIT);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, TicketStatus.PENDING_AUDIT,
                "n8n", "回复结果已保存，进入待审核");

        log.info("[N8nTicketService] 工单 #{} 回复结果已保存, replyId={}", ticketId, saved.getId());

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("replyId", saved.getId());
        response.put("status", TicketStatus.PENDING_AUDIT.name());
        return response;
    }

    // ========== 通知 ==========

    /**
     * 推送审核通知：生成审核链接，通过钉钉/企微通知审核人员
     */
    public Map<String, Object> notifyPendingAudit(Long ticketId) {
        Ticket ticket = getTicket(ticketId);

        if (ticket.getStatus() != TicketStatus.PENDING_AUDIT) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + ticket.getStatus() + "，不可发送审核通知");
        }

        String auditToken = auditTokenService.generateToken(ticketId);
        notifyService.notifyPendingAudit(ticket, auditToken);

        log.info("[N8nTicketService] 工单 #{} 已推送审核通知", ticketId);

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("status", "notified");
        return response;
    }

    // ========== AI 判定已解决 ==========

    /**
     * AI 判定工单已解决 — 完结工单，同步更新 Freshdesk 状态为 Resolved(4)
     */
    @Transactional
    public Map<String, Object> resolveCompleted(Long ticketId) {
        Ticket ticket = getTicket(ticketId);
        TicketStatus beforeStatus = ticket.getStatus();

        log.info("[N8nTicketService] 工单 #{} AI 判定已解决，当前状态: {}", ticketId, beforeStatus);

        // 校验状态：只有 PENDING_TRANS 或 PROCESSING 可以直接完结
        if (beforeStatus != TicketStatus.PENDING_TRANS && beforeStatus != TicketStatus.PROCESSING) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + beforeStatus + "，不可直接完结");
        }

        // 同步更新 Freshdesk 工单状态为 Resolved(4)
        try {
            freshdeskApiClient.updateTicketStatus(ticket.getExternalId(), 4);
            log.info("[N8nTicketService] Freshdesk 工单 #{} 状态已更新为 Resolved(4)", ticket.getExternalId());
        } catch (Exception e) {
            log.error("[N8nTicketService] Freshdesk API 调用失败, ticketId={}, externalId={}", ticketId, ticket.getExternalId(), e);
            throw new BusinessException(ErrorCode.BUSINESS_ERROR,
                    "Freshdesk API 调用失败: " + e.getMessage());
        }

        // 更新本地状态
        ticket.setFdStatus(4);  // Resolved
        stateMachine.transition(ticket, TicketStatus.COMPLETED);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, TicketStatus.COMPLETED,
                "n8n", "AI 判定工单已解决，Freshdesk 已同步 Resolved");

        log.info("[N8nTicketService] 工单 #{} 已完结 (AI resolved), fdStatus=4", ticketId);

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("fdStatus", 4);
        response.put("status", TicketStatus.COMPLETED.name());
        return response;
    }

    // ========== 人工处理 ==========

    /**
     * 标记工单为需人工处理状态（AI 分类为商务合作/其他等不适合自动回复的类别时调用）
     */
    @Transactional
    public Map<String, Object> markManualRequired(Long ticketId, String reason) {
        Ticket ticket = getTicket(ticketId);
        TicketStatus beforeStatus = ticket.getStatus();
        stateMachine.transition(ticket, TicketStatus.MANUAL_REQUIRED);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, TicketStatus.MANUAL_REQUIRED,
                "n8n", reason != null ? reason : "AI 分类为需人工处理");
        log.info("[N8nTicketService] 工单 #{} 标记为人工处理, reason={}", ticketId, reason);
        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("status", TicketStatus.MANUAL_REQUIRED.name());
        return response;
    }

    /**
     * 查询所有 MANUAL_REQUIRED 状态的工单
     */
    public List<Ticket> findManualRequiredTickets(int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ticketRepository.findByFilters(
                List.of(TicketStatus.MANUAL_REQUIRED), null, null, null, null, null,
                null, null,
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Order.desc("updatedAt")))
        ).getContent();
    }

    /**
     * 人工处理完成 — 继续处理或直接完结
     * @param action "continue" 继续回复流程 / "complete" 直接完结
     */
    @Transactional
    public Map<String, Object> resolveManualTicket(Long ticketId, String action) {
        Ticket ticket = getTicket(ticketId);
        TicketStatus beforeStatus = ticket.getStatus();
        TicketStatus targetStatus;
        String logMessage;
        if ("continue".equals(action)) {
            targetStatus = TicketStatus.PENDING_REPLY;
            logMessage = "人工处理：继续回复流程";
        } else if ("complete".equals(action)) {
            targetStatus = TicketStatus.COMPLETED;
            logMessage = "人工处理：直接完结";
        } else {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "无效的操作: " + action);
        }
        stateMachine.transition(ticket, targetStatus);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, targetStatus, "manual", logMessage);
        log.info("[N8nTicketService] 工单 #{} 人工处理完成: {} → {}", ticketId, beforeStatus, targetStatus);
        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("status", targetStatus.name());
        return response;
    }

    /**
     * 人工回复保存 — 保存人工编写的回复，可选目标状态（待审核 或 完成）
     *
     * @param targetStatusStr 目标状态："PENDING_AUDIT"（默认）或 "COMPLETED"
     */
    @Transactional
    public Map<String, Object> saveManualReply(Long ticketId, String targetReply, String zhReply, String targetStatusStr) {
        Ticket ticket = getTicket(ticketId);
        TicketStatus beforeStatus = ticket.getStatus();

        // 解析目标状态
        TicketStatus targetStatus;
        String logMessage;
        if ("COMPLETED".equalsIgnoreCase(targetStatusStr)) {
            targetStatus = TicketStatus.COMPLETED;
            logMessage = "人工回复已保存，直接完成等待推送";
        } else {
            targetStatus = TicketStatus.PENDING_AUDIT;
            logMessage = "人工回复已保存，进入待审核";
        }

        // 删除旧回复
        replyRepository.deleteByTicket(ticket);
        replyRepository.flush();

        // 保存新回复
        TicketReply reply = new TicketReply();
        reply.setTicket(ticket);
        reply.setTargetReply(targetReply);
        reply.setZhReply(zhReply);
        reply.setReplyLang(ticket.getSourceLang());
        reply.setIsSelected(true);
        reply.setCreatedAt(java.time.LocalDateTime.now());
        TicketReply saved = replyRepository.save(reply);

        // 状态转换
        stateMachine.transition(ticket, targetStatus);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, targetStatus, "manual", logMessage);

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("replyId", saved.getId());
        response.put("status", targetStatus.name());
        return response;
    }

    /**
     * 提交 AI 回复 — 将人工处理工单转为 REPLYING 状态，并通过 n8n webhook 异步执行回复
     * <p>
     * 前端调用后立即返回，工单从人工列表消失；n8n 异步处理回复后工单进入审核。
     */
    @Transactional
    public Map<String, Object> submitForAiReply(Long ticketId) {
        Ticket ticket = getTicket(ticketId);
        TicketStatus beforeStatus = ticket.getStatus();

        if (beforeStatus != TicketStatus.MANUAL_REQUIRED) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + beforeStatus + "，仅 MANUAL_REQUIRED 可提交 AI 回复");
        }

        // 转为 REPLYING — 立即从人工处理列表消失
        stateMachine.transition(ticket, TicketStatus.REPLYING);
        ticketRepository.save(ticket);
        statusLogService.logTransition(ticket, beforeStatus, TicketStatus.REPLYING,
                "manual", "人工提交 AI 回复，等待 n8n 异步处理");

        // 触发 n8n webhook（fire & forget）
        triggerAiReplyWebhook(ticketId);

        log.info("[N8nTicketService] 工单 #{} 已提交 AI 回复, {} → REPLYING", ticketId, beforeStatus);

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("status", TicketStatus.REPLYING.name());
        return response;
    }

    /**
     * 触发 n8n AI 回复 webhook（异步，不阻塞）
     */
    private void triggerAiReplyWebhook(Long ticketId) {
        try {
            String webhookUrl = System.getenv("N8N_AI_REPLY_WEBHOOK_URL");
            if (webhookUrl == null || webhookUrl.isBlank()) {
                webhookUrl = "http://localhost:5678/webhook/fd-ai-reply";
            }
            java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();
            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                    .uri(java.net.URI.create(webhookUrl))
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                            "{\"ticketId\":" + ticketId + "}"))
                    .build();
            // 异步发送，不等待结果
            client.sendAsync(request, java.net.http.HttpResponse.BodyHandlers.ofString())
                    .thenAccept(resp -> log.info("[N8nTicketService] n8n webhook 响应: {}", resp.statusCode()))
                    .exceptionally(ex -> {
                        log.error("[N8nTicketService] n8n webhook 调用失败, ticketId={}", ticketId, ex);
                        return null;
                    });
        } catch (Exception e) {
            log.error("[N8nTicketService] 触发 n8n webhook 异常, ticketId={}", ticketId, e);
            // 不抛异常，状态已转为 REPLYING，n8n 可人工重试
        }
    }

    /**
     * 清除回复 — 删除工单的所有回复，不改变工单状态
     */
    @Transactional
    public Map<String, Object> clearReplies(Long ticketId) {
        Ticket ticket = getTicket(ticketId);

        // 删除所有回复
        replyRepository.deleteByTicket(ticket);
        replyRepository.flush();

        log.info("[N8nTicketService] 工单 #{} 清除回复，当前状态: {}", ticketId, ticket.getStatus());

        Map<String, Object> response = new HashMap<>();
        response.put("ticketId", ticketId);
        response.put("status", ticket.getStatus().name());
        return response;
    }

    // ========== 刷新工单数据 ==========

    /**
     * 从 Freshdesk API 刷新工单最新数据（含对话），不改变工单状态。
     * 供 n8n 工作流在循环处理每个工单前调用。
     */
    public Ticket refreshAndGetTicket(Long ticketId) {
        return freshdeskSyncService.refreshTicketContent(ticketId);
    }

    // ========== 内部方法 ==========

    private Ticket getTicket(Long ticketId) {
        return ticketRepository.findById(ticketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND, "工单不存在: " + ticketId));
    }
}
