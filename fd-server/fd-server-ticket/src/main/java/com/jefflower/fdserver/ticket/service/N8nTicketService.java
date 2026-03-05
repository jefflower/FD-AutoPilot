package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.entity.*;
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
                                                      String ticketCategory) {
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

        if (ticket.getStatus() != TicketStatus.PROCESSING) {
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
