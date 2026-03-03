package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.dto.MobileAuditDetailResponse;
import com.jefflower.fdserver.ticket.entity.AuditToken;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketAudit;
import com.jefflower.fdserver.ticket.enums.AuditTokenStatus;
import com.jefflower.fdserver.ticket.repository.AuditTokenRepository;
import com.jefflower.fdserver.ticket.repository.TicketAuditRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuditTokenService {

    private final AuditTokenRepository auditTokenRepository;
    private final TicketRepository ticketRepository;
    private final TicketAuditRepository ticketAuditRepository;
    private final SystemConfigService systemConfigService;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /**
     * 为工单生成审核 Token。先撤销该工单已有的 ACTIVE Token，再生成新 Token。
     */
    @Transactional
    public String generateToken(Long ticketId) {
        // 撤销该工单已有的 ACTIVE Token
        auditTokenRepository.updateStatusByTicketIdAndStatus(
                ticketId, AuditTokenStatus.ACTIVE, AuditTokenStatus.REVOKED);

        // 生成新 Token（SecureRandom 32 bytes -> Base64URL = 43 chars）
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        int expireHours = systemConfigService.getAuditTokenExpireHours();

        AuditToken auditToken = new AuditToken();
        auditToken.setToken(token);
        auditToken.setTicketId(ticketId);
        auditToken.setStatus(AuditTokenStatus.ACTIVE);
        auditToken.setExpireAt(LocalDateTime.now().plusHours(expireHours));
        auditToken.setCreatedAt(LocalDateTime.now());
        auditTokenRepository.save(auditToken);

        log.info("[AuditToken] 生成审核Token: ticketId={}, expireHours={}", ticketId, expireHours);
        return token;
    }

    /**
     * 获取或创建指定工单的审核 Token（用于桌面端预览）。
     * 如果已有 ACTIVE 且未过期的 Token 则复用，否则生成新的。
     */
    @Transactional
    public String getOrCreateToken(Long ticketId) {
        return auditTokenRepository.findFirstByTicketIdAndStatusOrderByCreatedAtDesc(ticketId, AuditTokenStatus.ACTIVE)
                .filter(t -> t.getExpireAt().isAfter(LocalDateTime.now()))
                .map(AuditToken::getToken)
                .orElseGet(() -> generateToken(ticketId));
    }

    /**
     * 通过 Token 获取工单详情（供移动端审核页面）
     */
    public MobileAuditDetailResponse getDetailByToken(String tokenStr) {
        AuditToken auditToken = findAndValidateToken(tokenStr);

        Ticket ticket = ticketRepository.findByIdWithAssociations(auditToken.getTicketId())
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND));

        MobileAuditDetailResponse response = new MobileAuditDetailResponse();
        response.setTicketId(ticket.getId());
        response.setExternalId(ticket.getExternalId());
        response.setSubject(ticket.getSubject());
        response.setContent(ticket.getContent());
        response.setStatus(ticket.getStatus().name());
        response.setLastAuditRemark(ticket.getLastAuditRemark());
        response.setAlreadyAudited(auditToken.getStatus() == AuditTokenStatus.USED);

        // 填充翻译内容（取最新一条）
        if (ticket.getTranslations() != null && !ticket.getTranslations().isEmpty()) {
            ticket.getTranslations().stream()
                    .max((a, b) -> a.getId().compareTo(b.getId()))
                    .ifPresent(translation -> {
                        response.setTranslatedTitle(translation.getTranslatedTitle());
                        response.setTranslatedContent(translation.getTranslatedContent());
                    });
        }

        // 填充回复内容（取最新一条）
        if (ticket.getReplies() != null && !ticket.getReplies().isEmpty()) {
            ticket.getReplies().stream().findFirst().ifPresent(reply -> {
                response.setZhReply(reply.getZhReply());
                response.setTargetReply(reply.getTargetReply());
                response.setReplyId(reply.getId());
            });
        }

        // 填充审核历史
        List<TicketAudit> audits = ticketAuditRepository.findByTicketOrderByCreatedAtDesc(ticket);
        response.setAuditHistory(audits.stream().map(a -> {
            MobileAuditDetailResponse.AuditHistoryItem item = new MobileAuditDetailResponse.AuditHistoryItem();
            item.setAuditResult(a.getAuditResult().name());
            item.setAuditRemark(a.getAuditRemark());
            item.setCreatedAt(a.getCreatedAt());
            return item;
        }).collect(Collectors.toList()));

        return response;
    }

    /**
     * 消费 Token（悲观锁防并发）。
     * 返回关联的 ticketId，调用方负责执行实际审核逻辑。
     * 返回 null 表示 Token 已被他人使用。
     */
    @Transactional
    public Long consumeToken(String tokenStr) {
        AuditToken auditToken = auditTokenRepository.findByTokenForUpdate(tokenStr)
                .orElseThrow(() -> new BusinessException(ErrorCode.AUDIT_TOKEN_NOT_FOUND));

        // 二次校验（悲观锁后）
        if (auditToken.getStatus() == AuditTokenStatus.USED) {
            return null; // 已被使用，返回 null 表示"已被他人审核"
        }
        if (auditToken.getStatus() != AuditTokenStatus.ACTIVE) {
            throw new BusinessException(ErrorCode.AUDIT_TOKEN_INVALID);
        }
        if (auditToken.getExpireAt().isBefore(LocalDateTime.now())) {
            auditToken.setStatus(AuditTokenStatus.EXPIRED);
            auditTokenRepository.save(auditToken);
            throw new BusinessException(ErrorCode.AUDIT_TOKEN_EXPIRED);
        }

        // 标记为已使用
        auditToken.setStatus(AuditTokenStatus.USED);
        auditToken.setUsedAt(LocalDateTime.now());
        auditTokenRepository.save(auditToken);

        return auditToken.getTicketId();
    }

    // ========== 内部方法 ==========

    private AuditToken findAndValidateToken(String tokenStr) {
        AuditToken auditToken = auditTokenRepository.findByToken(tokenStr)
                .orElseThrow(() -> new BusinessException(ErrorCode.AUDIT_TOKEN_NOT_FOUND));

        // USED 状态：允许查看但标记 alreadyAudited
        if (auditToken.getStatus() == AuditTokenStatus.USED) {
            return auditToken;
        }

        // EXPIRED / REVOKED
        if (auditToken.getStatus() != AuditTokenStatus.ACTIVE) {
            throw new BusinessException(ErrorCode.AUDIT_TOKEN_INVALID);
        }

        // 检查过期时间
        if (auditToken.getExpireAt().isBefore(LocalDateTime.now())) {
            auditToken.setStatus(AuditTokenStatus.EXPIRED);
            auditTokenRepository.save(auditToken);
            throw new BusinessException(ErrorCode.AUDIT_TOKEN_EXPIRED);
        }

        return auditToken;
    }
}
