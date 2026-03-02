package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
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

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 100;

    // ========== 查询 ==========

    /**
     * 查询可被 n8n 处理的待翻译工单（PENDING_TRANS 状态）
     */
    public List<Ticket> findPendingTickets(int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ticketRepository.findByFilters(
                TicketStatus.PENDING_TRANS, null, null, null, null, null,
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Order.asc("createdAt")))
        ).getContent();
    }

    /**
     * 查询审核驳回后需要重新回复的工单（PROCESSING 状态）
     */
    public List<Ticket> findPendingReplyTickets(int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ticketRepository.findByFilters(
                TicketStatus.PROCESSING, null, null, null, null, null,
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Order.asc("updatedAt")))
        ).getContent();
    }

    // ========== 保存 Agent 结果 ==========

    /**
     * 保存翻译结果 — 删除旧翻译，保存新翻译，更新状态为 PROCESSING
     */
    @Transactional
    public Map<String, Object> saveTranslationResult(Long ticketId, String translatedTitle,
                                                      String translatedContent, String targetLang) {
        Ticket ticket = getTicket(ticketId);
        String lang = targetLang != null ? targetLang : "zh-CN";

        log.info("[N8nTicketService] 保存翻译结果 #{}, targetLang={}", ticketId, lang);

        if (ticket.getStatus() != TicketStatus.PENDING_TRANS && ticket.getStatus() != TicketStatus.PROCESSING) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    "工单 #" + ticketId + " 当前状态 " + ticket.getStatus() + "，不可保存翻译结果");
        }

        TicketStatus beforeStatus = ticket.getStatus();

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

    // ========== 内部方法 ==========

    private Ticket getTicket(Long ticketId) {
        return ticketRepository.findById(ticketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND, "工单不存在: " + ticketId));
    }
}
