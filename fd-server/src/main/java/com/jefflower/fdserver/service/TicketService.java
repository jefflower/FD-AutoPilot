package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.*;
import com.jefflower.fdserver.entity.*;
import com.jefflower.fdserver.enums.AuditResult;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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
    private final MqPublisherService mqPublisherService;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final WeChatWorkNotifyService weChatWorkNotifyService;

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

    public Ticket getTicketById(Long id) {
        return ticketRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("工单不存在: " + id));
    }

    @Transactional
    public TicketTranslation submitTranslation(Long ticketId, TranslationRequest request) {
        Ticket ticket = getTicketById(ticketId);
        System.out.println("[TicketService] Submitting translation for ticket #" + ticketId + ", targetLang: "
                + request.getTargetLang());
        System.out.println("[TicketService] Translation details - Title: " +
                (request.getTranslatedTitle() != null
                        ? request.getTranslatedTitle().substring(0, Math.min(50, request.getTranslatedTitle().length()))
                        : "null")
                +
                ", Content length: "
                + (request.getTranslatedContent() != null ? request.getTranslatedContent().length() : 0));

        // 先删除已存在的翻译记录（如果有）
        translationRepository.findByTicketAndTargetLang(ticket, request.getTargetLang())
                .ifPresent(existing -> {
                    System.out.println("[TicketService] Deleting existing translation record ID: " + existing.getId());
                    translationRepository.delete(existing);
                });

        // 创建新的翻译记录
        System.out.println("[TicketService] Creating new translation record");
        TicketTranslation translation = new TicketTranslation();
        translation.setTicket(ticket);
        translation.setTargetLang(request.getTargetLang());
        translation.setTranslatedTitle(request.getTranslatedTitle());
        translation.setTranslatedContent(request.getTranslatedContent());
        TicketTranslation saved = translationRepository.save(translation);

        System.out.println("[TicketService] Translation saved with ID: " + saved.getId());

        // 如果已经是 PENDING_REPLY 状态，说明已经触发过后续流程，无需重复处理
        if (ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            // 发送回复任务到 MQ
            mqPublisherService.sendReplyTask(ticket);
        }

        return saved;
    }

    @Transactional
    public TicketReply submitReply(Long ticketId, ReplyRequest request) {
        Ticket ticket = getTicketById(ticketId);
        System.out.println("[TicketService] Submitting reply for ticket #" + ticketId);

        // 删除该工单已有的回复
        replyRepository.deleteByTicket(ticket);

        TicketReply reply = new TicketReply();
        reply.setTicket(ticket);
        reply.setZhReply(request.getZhReply());
        reply.setTargetReply(request.getTargetReply());
        TicketReply saved = replyRepository.save(reply);

        ticket.setStatus(TicketStatus.PENDING_AUDIT);
        ticket.setUpdatedAt(LocalDateTime.now());
        ticketRepository.save(ticket);

        // 发送审核任务到 MQ
        mqPublisherService.sendAuditTask(ticket);

        // 通知企业微信：AI回复已完成，等待审核
        weChatWorkNotifyService.notifyMqReplyCompleted(ticket);

        return saved;
    }

    @Transactional
    public TicketAudit submitAudit(Long ticketId, AuditRequest request, Long auditorId) {
        Ticket ticket = getTicketById(ticketId);
        log.info("[TicketService] Submitting audit for ticket #{}", ticketId);

        TicketAudit audit = new TicketAudit();
        audit.setTicket(ticket);
        audit.setReplyId(request.getReplyId());
        audit.setAuditResult(request.getAuditResult());
        audit.setAuditRemark(request.getAuditRemark());
        audit.setAuditorId(auditorId);
        TicketAudit saved = auditRepository.save(audit);

        if (request.getAuditResult() == AuditResult.PASS) {
            TicketReply reply = replyRepository.findById(request.getReplyId())
                    .orElseThrow(() -> new RuntimeException("回复不存在"));
            reply.setIsSelected(true);
            replyRepository.save(reply);

            boolean autoReply = systemConfigService.isAutoReplyEnabled();
            if (autoReply) {
                // 自动推送模式：直接推送到 Freshdesk → COMPLETED
                ticket.setStatus(TicketStatus.COMPLETED);
                replyPushService.pushReplyToFreshdesk(ticket, reply);
            } else {
                // 手动推送模式：进入 APPROVED 等待推送
                ticket.setStatus(TicketStatus.APPROVED);
            }
            ticket.setLastAuditRemark(null);
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            weChatWorkNotifyService.notifyAuditPass(ticket);
        } else {
            // REJECT：保存审核意见，回到待回复状态
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticket.setLastAuditRemark(request.getAuditRemark());
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            mqPublisherService.sendReplyTask(ticket);

            weChatWorkNotifyService.notifyAuditReject(ticket, request.getAuditRemark());
        }

        return saved;
    }

    @Transactional
    public TicketReply updateReply(Long ticketId, Long replyId, ReplyRequest request) {
        Ticket ticket = getTicketById(ticketId);
        TicketReply reply = replyRepository.findById(replyId)
                .orElseThrow(() -> new RuntimeException("回复不存在: " + replyId));
        if (!reply.getTicket().getId().equals(ticketId)) {
            throw new RuntimeException("回复不属于此工单");
        }
        reply.setZhReply(request.getZhReply());
        reply.setTargetReply(request.getTargetReply());
        return replyRepository.save(reply);
    }

    @Transactional
    public void pushApprovedReply(Long ticketId) {
        Ticket ticket = getTicketById(ticketId);
        if (ticket.getStatus() != TicketStatus.APPROVED) {
            throw new RuntimeException("工单状态不是 APPROVED，无法推送");
        }

        TicketReply reply = replyRepository.findByTicket(ticket).stream()
                .filter(r -> Boolean.TRUE.equals(r.getIsSelected()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("未找到已选中的回复"));

        replyPushService.pushReplyToFreshdesk(ticket, reply);

        ticket.setStatus(TicketStatus.COMPLETED);
        ticket.setUpdatedAt(LocalDateTime.now());
        ticketRepository.save(ticket);

        weChatWorkNotifyService.notifyReplyPushed(ticket);
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
        Ticket ticket = getTicketById(ticketId);
        log.info("[TicketService] Skipping reply for ticket #{}, current status: {}", ticketId, ticket.getStatus());

        ticket.setStatus(TicketStatus.COMPLETED);
        ticket.setUpdatedAt(LocalDateTime.now());
        ticketRepository.save(ticket);
    }

    @Transactional
    public void triggerAiTranslation(Long ticketId) {
        Ticket ticket = getTicketById(ticketId);
        ticket.setStatus(TicketStatus.TRANSLATING);
        ticketRepository.save(ticket);
        mqPublisherService.sendTranslationTask(ticket);
    }

    @Transactional
    public void triggerAiReply(Long ticketId) {
        Ticket ticket = getTicketById(ticketId);

        // 校验是否已完成翻译
        boolean hasTranslation = translationRepository.existsByTicket(ticket);
        if (!hasTranslation) {
            throw new RuntimeException("工单 #" + ticketId + " 尚未完成翻译，无法触发回复");
        }

        ticket.setStatus(TicketStatus.REPLYING);
        ticketRepository.save(ticket);
        mqPublisherService.sendReplyTask(ticket);
    }

    @Transactional
    public Ticket updateValidity(Long ticketId, Boolean isValid) {
        Ticket ticket = getTicketById(ticketId);
        ticket.setIsValid(isValid);
        return ticketRepository.save(ticket);
    }

    /**
     * 批量回退处理中的工单状态（用于队列重置）
     * TRANSLATING → PENDING_TRANS
     * REPLYING → PENDING_REPLY
     * AUDITING → PENDING_AUDIT
     * @return 回退的工单数量
     */
    @Transactional
    public int resetProcessingTickets() {
        LocalDateTime now = LocalDateTime.now();
        int count = 0;
        count += ticketRepository.updateStatusBatch(TicketStatus.TRANSLATING, TicketStatus.PENDING_TRANS, now);
        count += ticketRepository.updateStatusBatch(TicketStatus.REPLYING, TicketStatus.PENDING_REPLY, now);
        count += ticketRepository.updateStatusBatch(TicketStatus.AUDITING, TicketStatus.PENDING_AUDIT, now);
        log.info("[TicketService] 队列重置：回退了 {} 个处理中的工单", count);
        return count;
    }
}
