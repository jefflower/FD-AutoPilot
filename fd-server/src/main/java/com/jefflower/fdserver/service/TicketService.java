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
    private final FreshdeskService freshdeskService;

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

        // 查找是否已存在该语言的翻译，如果存在则更新，否则新增
        TicketTranslation translation = translationRepository
                .findByTicketAndTargetLang(ticket, request.getTargetLang())
                .orElse(new TicketTranslation());

        translation.setTicket(ticket);
        translation.setTargetLang(request.getTargetLang());
        translation.setTranslatedTitle(request.getTranslatedTitle());
        translation.setTranslatedContent(request.getTranslatedContent());
        translationRepository.save(translation);

        // 如果已经是 PENDING_REPLY 状态，说明已经触发过后续流程，无需重复处理
        if (ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticketRepository.save(ticket);

            // 发送回复任务到 MQ
            mqPublisherService.sendReplyTask(ticket);
        }

        return translation;
    }

    @Transactional
    public TicketReply submitReply(Long ticketId, ReplyRequest request) {
        Ticket ticket = getTicketById(ticketId);

        TicketReply reply = new TicketReply();
        reply.setTicket(ticket);
        reply.setZhReply(request.getZhReply());
        reply.setTargetReply(request.getTargetReply());
        replyRepository.save(reply);

        ticket.setStatus(TicketStatus.PENDING_AUDIT);
        ticketRepository.save(ticket);

        // 发送审核任务到 MQ
        mqPublisherService.sendAuditTask(ticket);

        return reply;
    }

    @Transactional
    public TicketAudit submitAudit(Long ticketId, AuditRequest request, Long auditorId) {
        Ticket ticket = getTicketById(ticketId);

        TicketAudit audit = new TicketAudit();
        audit.setTicket(ticket);
        audit.setReplyId(request.getReplyId());
        audit.setAuditResult(request.getAuditResult());
        audit.setAuditRemark(request.getAuditRemark());
        audit.setAuditorId(auditorId);
        auditRepository.save(audit);

        if (request.getAuditResult() == AuditResult.PASS) {
            ticket.setStatus(TicketStatus.COMPLETED);
            ticketRepository.save(ticket);

            // 同步回复到 Freshdesk
            TicketReply reply = replyRepository.findById(request.getReplyId())
                    .orElseThrow(() -> new RuntimeException("回复不存在"));
            reply.setIsSelected(true);
            replyRepository.save(reply);

            freshdeskService.pushReplyToFreshdesk(ticket, reply);
        } else {
            ticket.setStatus(TicketStatus.PENDING_REPLY);
            ticketRepository.save(ticket);

            // 重新发送回复任务
            mqPublisherService.sendReplyTask(ticket);
        }

        return audit;
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
