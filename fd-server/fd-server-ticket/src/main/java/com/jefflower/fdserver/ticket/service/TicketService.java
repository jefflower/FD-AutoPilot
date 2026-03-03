package com.jefflower.fdserver.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.dto.*;
import com.jefflower.fdserver.ticket.entity.*;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class TicketService {

    private final TicketRepository ticketRepository;
    private final TicketTranslationRepository translationRepository;
    private final TicketReplyRepository replyRepository;
    private final TicketAuditRepository auditRepository;
    private final ReplyPushService replyPushService;
    private final NotifyService notifyService;
    private final SystemConfigService configService;
    private final TicketStateMachine stateMachine;
    private final ObjectMapper objectMapper;

    /**
     * 翻译完整性校验：原始工单有 conversations 时，翻译结果也必须包含 conversations
     * 防止 Gemini 返回空 conversations 导致不完整的翻译被提交
     */
    private void validateTranslationCompleteness(Ticket ticket, String translatedContent) {
        if (ticket.getContent() == null || translatedContent == null) {
            return;
        }
        try {
            var originalNode = objectMapper.readTree(ticket.getContent());
            var translatedNode = objectMapper.readTree(translatedContent);

            var originalConversations = originalNode.path("conversations");
            var translatedConversations = translatedNode.path("conversations");

            int originalCount = originalConversations.isArray() ? originalConversations.size() : 0;
            int translatedCount = translatedConversations.isArray() ? translatedConversations.size() : 0;

            if (originalCount > 0 && translatedCount == 0) {
                // 降级为警告：Gemini CLI 有时只翻译标题和描述，不翻译对话，不应阻塞流程
                log.warn("[TicketService] 翻译不完整（已降级为警告）: ticketId={}, 原始conversations={}条, 翻译conversations={}条",
                        ticket.getId(), originalCount, translatedCount);
            }
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            // JSON 解析失败不阻塞流程，仅记录警告
            log.warn("[TicketService] 翻译完整性校验时 JSON 解析失败, ticketId={}: {}",
                    ticket.getId(), e.getMessage());
        }
    }

    /**
     * 列表查询（返回完整 Ticket 实体）— 保持向后兼容
     */
    public Page<Ticket> queryTickets(
            TicketStatus status,
            String externalId,
            String subject,
            Boolean isValid,
            LocalDateTime createdAfter,
            LocalDateTime createdBefore,
            int page,
            int size) {
        return ticketRepository.findByFilters(
                status, externalId, subject, isValid, createdAfter, createdBefore,
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("updatedAt"))));
    }

    /**
     * 列表查询（返回轻量 DTO）— 不查 content 等大字段，不加载关联数据
     * 支持自定义排序参数
     */
    public Page<TicketListDTO> queryTicketsAsDTO(
            TicketStatus status,
            String externalId,
            String subject,
            Boolean isValid,
            LocalDateTime createdAfter,
            LocalDateTime createdBefore,
            int page,
            int size,
            Sort sort) {
        Pageable pageable = PageRequest.of(page, size, sort != null ? sort : Sort.by(Sort.Order.desc("updatedAt")));
        return ticketRepository.findByFiltersAsDTO(
                status, externalId, subject, isValid, createdAfter, createdBefore, pageable);
    }

    /**
     * 获取工单详情（含关联的 translations 和 replies，通过 EntityGraph 一次性加载）
     */
    public Ticket getTicketById(Long id) {
        return ticketRepository.findByIdWithAssociations(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND, "工单不存在: " + id));
    }

    /**
     * 获取工单（不加载关联数据，用于内部状态更新等场景）
     */
    public Ticket getTicketByIdSimple(Long id) {
        return ticketRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND, "工单不存在: " + id));
    }

    @Transactional
    public TicketTranslation submitTranslation(Long ticketId, TranslationRequest request) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：只有 PROCESSING / PENDING_TRANS 状态才接受翻译上报
        // 如果状态已推进到更后面的阶段（如 PENDING_AUDIT 等），说明是重复消息，跳过
        if (!stateMachine.isInAcceptedStates(ticket.getStatus(), TicketStateMachine.TRANSLATION_ACCEPTED_STATES)) {
            log.warn("[TicketService] 幂等性检查: 翻译上报被跳过, ticketId={}, 当前状态={}, 期望状态=PROCESSING/PENDING_TRANS",
                    ticketId, ticket.getStatus());
            return translationRepository.findByTicketAndTargetLang(ticket, request.getTargetLang())
                    .orElseGet(() -> {
                        TicketTranslation empty = new TicketTranslation();
                        empty.setTicket(ticket);
                        empty.setTargetLang(request.getTargetLang());
                        return empty;
                    });
        }

        log.info("[TicketService] Submitting translation for ticket #{}, targetLang: {}",
                ticketId, request.getTargetLang());
        log.debug("[TicketService] Translation details - Title: {}, Content length: {}",
                request.getTranslatedTitle() != null
                        ? request.getTranslatedTitle().substring(0, Math.min(50, request.getTranslatedTitle().length()))
                        : "null",
                request.getTranslatedContent() != null ? request.getTranslatedContent().length() : 0);

        // 翻译完整性校验：原始工单有 conversations 时，翻译结果也必须有
        validateTranslationCompleteness(ticket, request.getTranslatedContent());

        // 先删除已存在的翻译记录（如果有）
        translationRepository.findByTicketAndTargetLang(ticket, request.getTargetLang())
                .ifPresent(existing -> {
                    log.debug("[TicketService] Deleting existing translation record ID: {}", existing.getId());
                    translationRepository.delete(existing);
                });

        // 创建新的翻译记录
        log.debug("[TicketService] Creating new translation record");
        TicketTranslation translation = new TicketTranslation();
        translation.setTicket(ticket);
        translation.setTargetLang(request.getTargetLang());
        translation.setTranslatedTitle(request.getTranslatedTitle());
        translation.setTranslatedContent(request.getTranslatedContent());
        TicketTranslation saved = translationRepository.save(translation);

        log.debug("[TicketService] Translation saved with ID: {}", saved.getId());

        return saved;
    }

    @Transactional
    public TicketReply submitReply(Long ticketId, ReplyRequest request) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：
        // n8n 工作流模式：翻译和回复可能并行执行，回复完成时状态可能仍是 PENDING_TRANS/PROCESSING，
        // 需要放宽检查范围。
        var acceptedStates = TicketStateMachine.WORKFLOW_REPLY_ACCEPTED_STATES;
        if (!stateMachine.isInAcceptedStates(ticket.getStatus(), acceptedStates)) {
            log.warn("[TicketService] 幂等性检查: 回复上报被跳过, ticketId={}, 当前状态={}, 期望状态={}",
                    ticketId, ticket.getStatus(), acceptedStates);
            return replyRepository.findByTicket(ticket).stream()
                    .findFirst()
                    .orElseGet(() -> {
                        TicketReply empty = new TicketReply();
                        empty.setTicket(ticket);
                        return empty;
                    });
        }

        log.info("[TicketService] Submitting reply for ticket #{}", ticketId);

        // 删除该工单已有的回复
        replyRepository.deleteByTicket(ticket);

        TicketReply reply = new TicketReply();
        reply.setTicket(ticket);
        reply.setZhReply(request.getZhReply());
        reply.setTargetReply(request.getTargetReply());
        TicketReply saved = replyRepository.save(reply);

        return saved;
    }

    @Transactional
    public TicketAudit submitAudit(Long ticketId, AuditRequest request, Long auditorId) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：只有 PENDING_AUDIT 状态才接受审核上报
        // 如果状态已推进到 APPROVED / COMPLETED，说明是重复消息，跳过
        if (!stateMachine.isInAcceptedStates(ticket.getStatus(), TicketStateMachine.AUDIT_ACCEPTED_STATES)) {
            log.warn("[TicketService] 幂等性检查: 审核上报被跳过, ticketId={}, 当前状态={}, 期望状态=PENDING_AUDIT",
                    ticketId, ticket.getStatus());
            return auditRepository.findTopByTicketOrderByCreatedAtDesc(ticket)
                    .orElseGet(() -> {
                        TicketAudit empty = new TicketAudit();
                        empty.setTicket(ticket);
                        return empty;
                    });
        }

        log.info("[TicketService] Submitting audit for ticket #{}", ticketId);

        // PASS 审核前校验：必须有翻译和回复内容
        if (request.getAuditResult() == com.jefflower.fdserver.ticket.enums.AuditResult.PASS) {
            if (!translationRepository.existsByTicket(ticket)) {
                throw new BusinessException(ErrorCode.TRANSLATION_REQUIRED);
            }
            if (!replyRepository.existsByTicket(ticket)) {
                throw new BusinessException(ErrorCode.REPLY_REQUIRED);
            }
        }

        TicketAudit audit = new TicketAudit();
        audit.setTicket(ticket);
        audit.setReplyId(request.getReplyId());
        audit.setAuditResult(request.getAuditResult());
        audit.setAuditRemark(request.getAuditRemark());
        audit.setAuditorId(auditorId);
        TicketAudit saved = auditRepository.save(audit);

        // 审核结果处理（n8n 定时扫描拾取驳回的工单）
        AuditResult result = request.getAuditResult();
        ticket.setLastAuditRemark(request.getAuditRemark());

        switch (result) {
            case PASS -> {
                if (configService.isAutoReplyEnabled()) {
                    // 自动推送模式 → 推送到 Freshdesk
                    try {
                        TicketReply reply = replyRepository.findById(request.getReplyId()).orElse(null);
                        if (reply != null) {
                            replyPushService.pushReplyToFreshdesk(ticket, reply);
                            stateMachine.transition(ticket, TicketStatus.COMPLETED);
                            notifyService.notifyReplyPushed(ticket);
                        } else {
                            stateMachine.transition(ticket, TicketStatus.APPROVED);
                        }
                    } catch (Exception e) {
                        log.error("[TicketService] 自动推送失败, ticketId={}: {}", ticketId, e.getMessage());
                        stateMachine.transition(ticket, TicketStatus.APPROVED);
                    }
                } else {
                    // 手动推送模式
                    stateMachine.transition(ticket, TicketStatus.APPROVED);
                }
            }
            case REJECT -> {
                // 驳回 → PROCESSING，n8n 下次扫描 pending-reply 时重新生成回复
                stateMachine.transition(ticket, TicketStatus.PROCESSING);
            }
            case RETRANSLATE -> {
                // 驳回至重新翻译 → PENDING_TRANS，n8n 下次扫描 pending 时重新翻译
                stateMachine.transition(ticket, TicketStatus.PENDING_TRANS);
            }
        }
        ticketRepository.save(ticket);

        return saved;
    }

    @Transactional
    public TicketReply updateReply(Long ticketId, Long replyId, ReplyRequest request) {
        getTicketByIdSimple(ticketId); // 验证工单存在
        TicketReply reply = replyRepository.findById(replyId)
                .orElseThrow(() -> new BusinessException(ErrorCode.REPLY_NOT_FOUND, "回复不存在: " + replyId));
        if (!reply.getTicket().getId().equals(ticketId)) {
            throw new BusinessException(ErrorCode.REPLY_NOT_BELONG_TO_TICKET);
        }
        reply.setZhReply(request.getZhReply());
        reply.setTargetReply(request.getTargetReply());
        return replyRepository.save(reply);
    }

    @Transactional
    public void pushApprovedReply(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        // 手动推送仅允许 APPROVED 状态（APPROVED → COMPLETED 是唯一合法路径）
        if (ticket.getStatus() != TicketStatus.APPROVED) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    String.format("手动推送要求工单状态为 APPROVED，当前状态: %s", ticket.getStatus()));
        }

        TicketReply reply = replyRepository.findByTicket(ticket).stream()
                .filter(r -> Boolean.TRUE.equals(r.getIsSelected()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.SELECTED_REPLY_NOT_FOUND));

        replyPushService.pushReplyToFreshdesk(ticket, reply);

        stateMachine.transition(ticket, TicketStatus.COMPLETED);
        ticketRepository.save(ticket);

        notifyService.notifyReplyPushed(ticket);
    }

    @Transactional
    public int batchPushApprovedReplies(java.util.List<Long> ticketIds) {
        int successCount = 0;
        for (Long id : ticketIds) {
            try {
                pushApprovedReply(id);
                successCount++;
            } catch (Exception e) {
                log.error("批量推送失败, ticketId={}", id, e);
            }
        }
        return successCount;
    }

    /**
     * 跳过回复：最后一条对话不是客户消息时，直接标记工单为 COMPLETED，跳过审核流程
     */
    @Transactional
    public void skipReply(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        log.info("[TicketService] Skipping reply for ticket #{}, current status: {}", ticketId, ticket.getStatus());

        stateMachine.forceTransition(ticket, TicketStatus.COMPLETED);
        ticketRepository.save(ticket);
    }

    /**
     * 重启工单处理流程 — 重置状态为 PENDING_TRANS，n8n 定时扫描自动拾取。
     */
    @Transactional
    public void restartWorkflow(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        stateMachine.forceTransition(ticket, TicketStatus.PENDING_TRANS);
        ticketRepository.save(ticket);
        log.info("[TicketService] 工单 #{} 状态已重置为 PENDING_TRANS，等待 n8n 拾取", ticketId);
    }

    /**
     * @deprecated 使用 {@link #restartWorkflow(Long)} 替代，此方法保留仅为 API 向后兼容
     */
    @Transactional
    public void triggerAiTranslation(Long ticketId) {
        restartWorkflow(ticketId);
    }

    /**
     * @deprecated 使用 {@link #restartWorkflow(Long)} 替代，此方法保留仅为 API 向后兼容。
     * 额外校验：翻译必须存在（用户意图是"重新生成回复"，翻译是前提条件）
     */
    @Transactional
    public void triggerAiReply(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        boolean hasTranslation = translationRepository.existsByTicket(ticket);
        if (!hasTranslation) {
            throw new BusinessException(ErrorCode.TRANSLATION_REQUIRED,
                    "工单 #" + ticketId + " 尚未完成翻译，无法触发回复");
        }
        restartWorkflow(ticketId);
    }

    @Transactional
    public Ticket updateValidity(Long ticketId, Boolean isValid) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        ticket.setIsValid(isValid);
        return ticketRepository.save(ticket);
    }

    /**
     * 批量回退处理中的工单状态（用于队列重置）
     * PROCESSING → PENDING_TRANS
     * @return 回退的工单数量
     */
    @Transactional
    public int resetProcessingTickets() {
        LocalDateTime now = LocalDateTime.now();
        int count = ticketRepository.updateStatusBatch(TicketStatus.PROCESSING, TicketStatus.PENDING_TRANS, now);
        log.info("[TicketService] 队列重置：回退了 {} 个处理中的工单", count);
        return count;
    }

    /**
     * 清除所有工单及关联数据（翻译、回复、审核），重置为全新数据库
     * @return 删除的工单总数
     */
    @Transactional
    public long purgeAllTickets() {
        long ticketCount = ticketRepository.count();
        // 先删除子表（外键依赖），再删除主表
        auditRepository.deleteAll();
        replyRepository.deleteAll();
        translationRepository.deleteAll();
        ticketRepository.deleteAll();
        log.info("[TicketService] 数据清理完成：删除了 {} 个工单及所有关联数据", ticketCount);
        return ticketCount;
    }
}
