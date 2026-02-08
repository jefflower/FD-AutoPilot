package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.*;
import com.jefflower.fdserver.entity.*;
import com.jefflower.fdserver.enums.AuditResult;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class TicketService {

    private final TicketRepository ticketRepository;
    private final TicketTranslationRepository translationRepository;
    private final TicketReplyRepository replyRepository;
    private final TicketAuditRepository auditRepository;
    private final MqPublisherService mqPublisherService;
    private final ReplyPushService replyPushService;

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

        return saved;
    }

    @Transactional
    public TicketAudit submitAudit(Long ticketId, AuditRequest request, Long auditorId) {
        Ticket ticket = getTicketById(ticketId);
        System.out.println("[TicketService] Submitting audit for ticket #" + ticketId);

        TicketAudit audit = new TicketAudit();
        audit.setTicket(ticket);
        audit.setReplyId(request.getReplyId());
        audit.setAuditResult(request.getAuditResult());
        audit.setAuditRemark(request.getAuditRemark());
        audit.setAuditorId(auditorId);
        TicketAudit saved = auditRepository.save(audit);

        if (request.getAuditResult() == AuditResult.PASS) {
            ticket.setStatus(TicketStatus.COMPLETED);
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            // 同步回复到 Freshdesk
            TicketReply reply = replyRepository.findById(request.getReplyId())
                    .orElseThrow(() -> new RuntimeException("回复不存在"));
            reply.setIsSelected(true);
            replyRepository.save(reply);

            replyPushService.pushReplyToFreshdesk(ticket, reply);
        } else {
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticket.setUpdatedAt(LocalDateTime.now());
            ticketRepository.save(ticket);

            // 重新发送回复任务
            mqPublisherService.sendReplyTask(ticket);
        }

        return saved;
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
}
