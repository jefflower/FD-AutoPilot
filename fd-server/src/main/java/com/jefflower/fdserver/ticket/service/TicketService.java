package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.ticket.dto.*;
import com.jefflower.fdserver.ticket.entity.*;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.*;
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
    private final MqPublisherService mqPublisherService;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final WeChatWorkNotifyService weChatWorkNotifyService;
    private final TaskDistributionService taskDistributionService;

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
                .orElseThrow(() -> new RuntimeException("工单不存在: " + id));
    }

    /**
     * 获取工单（不加载关联数据，用于内部状态更新等场景）
     */
    public Ticket getTicketByIdSimple(Long id) {
        return ticketRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("工单不存在: " + id));
    }

    @Transactional
    public TicketTranslation submitTranslation(Long ticketId, TranslationRequest request) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：只有 TRANSLATING / PENDING_TRANS / PENDING_REPLY 状态才接受翻译上报
        // 如果状态已推进到更后面的阶段（如 REPLYING、PENDING_AUDIT 等），说明是重复消息，跳过
        if (ticket.getStatus() != TicketStatus.TRANSLATING
                && ticket.getStatus() != TicketStatus.PENDING_TRANS
                && ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            log.warn("[TicketService] 幂等性检查: 翻译上报被跳过, ticketId={}, 当前状态={}, 期望状态=TRANSLATING/PENDING_TRANS/PENDING_REPLY",
                    ticketId, ticket.getStatus());
            return translationRepository.findByTicketAndTargetLang(ticket, request.getTargetLang())
                    .orElseGet(() -> {
                        TicketTranslation empty = new TicketTranslation();
                        empty.setTicket(ticket);
                        empty.setTargetLang(request.getTargetLang());
                        return empty;
                    });
        }

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

        // 完成翻译任务
        taskDistributionService.completeByReference("ticket.translate", String.valueOf(ticketId));

        // 如果已经是 PENDING_REPLY 状态，说明已经触发过后续流程，无需重复处理
        if (ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            // 发送回复任务到 MQ
            mqPublisherService.sendReplyTask(ticket);
            // 创建回复任务实例
            taskDistributionService.createTask("ticket.reply", "ticket",
                    String.valueOf(ticket.getId()), null,
                    com.jefflower.fdserver.task.enums.TriggerType.EVENT);
        }

        return saved;
    }

    @Transactional
    public TicketReply submitReply(Long ticketId, ReplyRequest request) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：只有 REPLYING / PENDING_REPLY 状态才接受回复上报
        // 如果状态已推进到 PENDING_AUDIT 或更后面，说明是重复消息，跳过
        if (ticket.getStatus() != TicketStatus.REPLYING
                && ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            log.warn("[TicketService] 幂等性检查: 回复上报被跳过, ticketId={}, 当前状态={}, 期望状态=REPLYING/PENDING_REPLY",
                    ticketId, ticket.getStatus());
            return replyRepository.findByTicket(ticket).stream()
                    .findFirst()
                    .orElseGet(() -> {
                        TicketReply empty = new TicketReply();
                        empty.setTicket(ticket);
                        return empty;
                    });
        }

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

        // 完成回复任务
        taskDistributionService.completeByReference("ticket.reply", String.valueOf(ticketId));

        // 发送审核任务到 MQ
        mqPublisherService.sendAuditTask(ticket);
        // 创建审核任务实例
        taskDistributionService.createTask("ticket.audit", "ticket",
                String.valueOf(ticket.getId()), null,
                com.jefflower.fdserver.task.enums.TriggerType.EVENT);

        // 通知企业微信：AI回复已完成，等待审核
        weChatWorkNotifyService.notifyMqReplyCompleted(ticket);

        return saved;
    }

    @Transactional
    public TicketAudit submitAudit(Long ticketId, AuditRequest request, Long auditorId) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 幂等性检查：只有 AUDITING / PENDING_AUDIT 状态才接受审核上报
        // 如果状态已推进到 APPROVED / COMPLETED，说明是重复消息，跳过
        // 注意：PENDING_REPLY 也是合法的（REJECT 后回到 PENDING_REPLY），但此时不应再次审核
        if (ticket.getStatus() != TicketStatus.AUDITING
                && ticket.getStatus() != TicketStatus.PENDING_AUDIT) {
            log.warn("[TicketService] 幂等性检查: 审核上报被跳过, ticketId={}, 当前状态={}, 期望状态=AUDITING/PENDING_AUDIT",
                    ticketId, ticket.getStatus());
            return auditRepository.findTopByTicketOrderByCreatedAtDesc(ticket)
                    .orElseGet(() -> {
                        TicketAudit empty = new TicketAudit();
                        empty.setTicket(ticket);
                        return empty;
                    });
        }

        log.info("[TicketService] Submitting audit for ticket #{}", ticketId);

        TicketAudit audit = new TicketAudit();
        audit.setTicket(ticket);
        audit.setReplyId(request.getReplyId());
        audit.setAuditResult(request.getAuditResult());
        audit.setAuditRemark(request.getAuditRemark());
        audit.setAuditorId(auditorId);
        TicketAudit saved = auditRepository.save(audit);

        // 完成审核任务
        taskDistributionService.completeByReference("ticket.audit", String.valueOf(ticketId));

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
            // REJECT 后重新创建回复任务实例
            taskDistributionService.createTask("ticket.reply", "ticket",
                    String.valueOf(ticket.getId()), null,
                    com.jefflower.fdserver.task.enums.TriggerType.EVENT);

            weChatWorkNotifyService.notifyAuditReject(ticket, request.getAuditRemark());
        }

        return saved;
    }

    @Transactional
    public TicketReply updateReply(Long ticketId, Long replyId, ReplyRequest request) {
        Ticket ticket = getTicketByIdSimple(ticketId);
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
        Ticket ticket = getTicketByIdSimple(ticketId);
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
        Ticket ticket = getTicketByIdSimple(ticketId);
        log.info("[TicketService] Skipping reply for ticket #{}, current status: {}", ticketId, ticket.getStatus());

        ticket.setStatus(TicketStatus.COMPLETED);
        ticket.setUpdatedAt(LocalDateTime.now());
        ticketRepository.save(ticket);
    }

    @Transactional
    public void triggerAiTranslation(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);
        ticket.setStatus(TicketStatus.TRANSLATING);
        ticketRepository.save(ticket);
        mqPublisherService.sendTranslationTask(ticket);
        taskDistributionService.createTask("ticket.translate", "ticket",
                String.valueOf(ticket.getId()), null,
                com.jefflower.fdserver.task.enums.TriggerType.MANUAL);
    }

    @Transactional
    public void triggerAiReply(Long ticketId) {
        Ticket ticket = getTicketByIdSimple(ticketId);

        // 校验是否已完成翻译
        boolean hasTranslation = translationRepository.existsByTicket(ticket);
        if (!hasTranslation) {
            throw new RuntimeException("工单 #" + ticketId + " 尚未完成翻译，无法触发回复");
        }

        ticket.setStatus(TicketStatus.REPLYING);
        ticketRepository.save(ticket);
        mqPublisherService.sendReplyTask(ticket);
        taskDistributionService.createTask("ticket.reply", "ticket",
                String.valueOf(ticket.getId()), null,
                com.jefflower.fdserver.task.enums.TriggerType.MANUAL);
    }

    @Transactional
    public Ticket updateValidity(Long ticketId, Boolean isValid) {
        Ticket ticket = getTicketByIdSimple(ticketId);
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
