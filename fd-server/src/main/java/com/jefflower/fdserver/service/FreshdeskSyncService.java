package com.jefflower.fdserver.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.client.FreshdeskApiClient;
import com.jefflower.fdserver.dto.TicketContent;
import com.jefflower.fdserver.entity.SyncLog;
import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.enums.TriggerType;
import com.jefflower.fdserver.repository.TicketRepository;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Freshdesk 工单同步服务（重构版）
 *
 * 修复：
 * 1. 分页遍历 — 使用 FreshdeskApiClient 处理 Link header 分页
 * 2. 状态安全 — 不重置处理中/已完成的工单状态
 * 3. 内容哈希 — 通过 SHA-256 检测内容是否真正变化
 * 4. 事务保证 — processSingleTicket 使用 @Transactional
 * 5. 丰富字段 — 存储 Freshdesk 优先级、来源、标签等元数据
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FreshdeskSyncService {

    private final FreshdeskApiClient apiClient;
    private final TicketRepository ticketRepository;
    private final MqPublisherService mqPublisherService;
    private final SyncConfigService syncConfigService;
    private final ObjectMapper objectMapper;

    @Value("${freshdesk.sync.statuses:2,3}")
    private String syncStatuses;

    /**
     * 同步结果
     */
    @Getter
    public static class SyncResult {
        private final int syncedCount;
        private final int updatedCount;
        private final int skippedCount;
        private final boolean success;
        private final String message;

        public SyncResult(int syncedCount, int updatedCount, int skippedCount,
                boolean success, String message) {
            this.syncedCount = syncedCount;
            this.updatedCount = updatedCount;
            this.skippedCount = skippedCount;
            this.success = success;
            this.message = message;
        }
    }

    /**
     * 单工单同步结果
     */
    public enum TicketSyncResult {
        NEW, UPDATED, SKIPPED
    }

    // ========== 对外接口（兼容原 FreshdeskService） ==========

    /**
     * 带锁的同步方法（供外部调用）
     */
    public SyncResult syncTicketsWithLock(TriggerType triggerType) {
        if (!syncConfigService.tryAcquireSyncLock()) {
            log.warn("Sync already in progress, skipping {} sync", triggerType);
            return new SyncResult(0, 0, 0, false, "同步正在进行中，请稍后重试");
        }

        SyncLog syncLog = null;
        try {
            syncLog = syncConfigService.createSyncLog(triggerType);
            SyncResult result = doSyncTickets();
            syncConfigService.completeSyncLog(syncLog, result.getSyncedCount(), result.getUpdatedCount());
            syncConfigService.updateLastSyncTime(
                    LocalDateTime.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
            return result;
        } catch (Exception e) {
            log.error("Sync failed", e);
            if (syncLog != null) {
                syncConfigService.failSyncLog(syncLog, e.getMessage());
            }
            return new SyncResult(0, 0, 0, false, "同步失败: " + e.getMessage());
        } finally {
            syncConfigService.releaseSyncLock();
        }
    }

    /**
     * 兼容旧接口（手动触发）
     */
    public int syncTickets() {
        SyncResult result = syncTicketsWithLock(TriggerType.MANUAL);
        if (!result.isSuccess()) {
            throw new RuntimeException(result.getMessage());
        }
        return result.getSyncedCount();
    }

    /**
     * Webhook 触发的单工单同步
     */
    public void processSingleTicketFromWebhook(Map<String, Object> fdTicket) {
        SyncLog syncLog = syncConfigService.createSyncLog(TriggerType.WEBHOOK);
        try {
            TicketSyncResult result = processSingleTicket(fdTicket, "WEBHOOK");
            int synced = result == TicketSyncResult.NEW ? 1 : 0;
            int updated = result == TicketSyncResult.UPDATED ? 1 : 0;
            syncConfigService.completeSyncLog(syncLog, synced, updated);
        } catch (Exception e) {
            syncConfigService.failSyncLog(syncLog, e.getMessage());
            throw e;
        }
    }

    // ========== 内部同步逻辑 ==========

    /**
     * 批量同步（分页获取所有工单）
     */
    private SyncResult doSyncTickets() {
        log.info("Starting Freshdesk ticket sync...");

        LocalDateTime lastSyncTime = syncConfigService.getLastSyncTime();
        // Freshdesk 要求 ISO8601 格式: 2024-12-01T10:30:00Z（不能有微秒）
        String updatedSince = lastSyncTime != null
                ? lastSyncTime.truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
                        .format(DateTimeFormatter.ISO_LOCAL_DATE_TIME) + "Z"
                : null;

        Set<Integer> statuses = parseStatuses();

        // 使用 API 客户端的分页能力获取所有工单
        List<Map<String, Object>> allTickets = apiClient.fetchAllTickets(updatedSince, statuses);

        log.info("Freshdesk API returned {} tickets total", allTickets.size());
        if (allTickets.isEmpty()) {
            return new SyncResult(0, 0, 0, true, "没有需要同步的工单");
        }

        int syncedCount = 0, updatedCount = 0, skippedCount = 0;

        for (Map<String, Object> fdTicket : allTickets) {
            try {
                TicketSyncResult result = processSingleTicket(fdTicket, "POLLING");
                switch (result) {
                    case NEW -> syncedCount++;
                    case UPDATED -> updatedCount++;
                    case SKIPPED -> skippedCount++;
                }
            } catch (Exception e) {
                String externalId = String.valueOf(fdTicket.get("id"));
                log.error("Failed to process ticket {}: {}", externalId, e.getMessage());
            }
        }

        log.info("Sync completed: new={}, updated={}, skipped={}", syncedCount, updatedCount, skippedCount);
        return new SyncResult(syncedCount, updatedCount, skippedCount, true,
                String.format("同步完成：新增 %d，更新 %d，跳过 %d", syncedCount, updatedCount, skippedCount));
    }

    /**
     * 处理单个工单（核心逻辑）
     * 修复：状态安全 + content_hash + 事务
     */
    @Transactional
    public TicketSyncResult processSingleTicket(Map<String, Object> fdTicket, String syncSource) {
        String externalId = String.valueOf(fdTicket.get("id"));
        Ticket existing = ticketRepository.findByExternalId(externalId).orElse(null);
        boolean isNew = (existing == null);

        // 获取描述
        String description = (String) fdTicket.get("description_text");
        if (description == null) {
            description = (String) fdTicket.get("description");
        }

        // 获取对话（带分页）
        String allContent = buildFullContent(externalId, description);

        // 计算内容哈希
        String newHash = computeContentHash(allContent);

        // 内容未变化且工单已存在 → 跳过（仅更新同步时间）
        if (!isNew && newHash.equals(existing.getContentHash())) {
            existing.setLastSyncedAt(LocalDateTime.now());
            existing.setSyncSource(syncSource);
            // 仍然更新 Freshdesk 元数据（状态、优先级等可能变化）
            populateFreshdeskMetadata(existing, fdTicket);
            ticketRepository.save(existing);
            log.debug("Ticket {} content unchanged, skipped workflow trigger", externalId);
            return TicketSyncResult.SKIPPED;
        }

        Ticket ticket = isNew ? new Ticket() : existing;
        if (isNew) {
            ticket.setExternalId(externalId);
            ticket.setCreatedAt(LocalDateTime.now());
        }

        // 填充所有字段
        ticket.setSubject((String) fdTicket.get("subject"));
        ticket.setContent(allContent);
        ticket.setContentHash(newHash);
        ticket.setLastSyncedAt(LocalDateTime.now());
        ticket.setSyncSource(syncSource);
        populateFreshdeskMetadata(ticket, fdTicket);

        // 状态安全判断
        boolean shouldTriggerWorkflow = shouldTriggerWorkflow(ticket, isNew);

        if (shouldTriggerWorkflow) {
            ticket.setStatus(TicketStatus.PENDING_TRANS);
        }

        ticketRepository.save(ticket);

        if (shouldTriggerWorkflow) {
            mqPublisherService.sendTranslationTask(ticket);
            log.info("Sent MQ translation task for ticket {} (isNew={}, syncSource={})",
                    externalId, isNew, syncSource);
        }

        return isNew ? TicketSyncResult.NEW : TicketSyncResult.UPDATED;
    }

    /**
     * 状态安全判断
     *
     * 规则：
     * - 新工单 → 总是触发
     * - PENDING_TRANS → 不重发（已在队列中）
     * - TRANSLATING ~ AUDITING（处理中）→ 不打断
     * - COMPLETED + 内容变化 → 重新触发
     */
    private boolean shouldTriggerWorkflow(Ticket ticket, boolean isNew) {
        if (isNew)
            return true;

        TicketStatus currentStatus = ticket.getStatus();

        // 处于活跃处理中的状态，不允许重置
        Set<TicketStatus> doNotDisturb = Set.of(
                TicketStatus.PENDING_TRANS,
                TicketStatus.TRANSLATING,
                TicketStatus.PENDING_REPLY,
                TicketStatus.REPLYING,
                TicketStatus.PENDING_AUDIT,
                TicketStatus.AUDITING);

        if (doNotDisturb.contains(currentStatus)) {
            return false;
        }

        // COMPLETED + 内容已变化（hash 不同，因为相同 hash 在上面已经 SKIPPED）
        return currentStatus == TicketStatus.COMPLETED;
    }

    // ========== 内容构建 ==========

    /**
     * 构建包含描述和所有对话的 JSON 内容
     */
    private String buildFullContent(String externalId, String description) {
        TicketContent contentModel = new TicketContent();
        contentModel.setDescription(description);

        try {
            List<Map<String, Object>> conversations = apiClient.fetchAllConversations(externalId);
            if (conversations != null && !conversations.isEmpty()) {
                List<TicketContent.ConversationDto> convDtos = conversations.stream()
                        .map(conv -> TicketContent.ConversationDto.builder()
                                .id(Long.valueOf(String.valueOf(conv.get("id"))))
                                .bodyText((String) conv.get("body_text"))
                                .isPrivate((Boolean) conv.get("private"))
                                .incoming((Boolean) conv.get("incoming"))
                                .userId(conv.get("user_id") != null
                                        ? Long.valueOf(String.valueOf(conv.get("user_id")))
                                        : null)
                                .createdAt((String) conv.get("created_at"))
                                .build())
                        .filter(c -> c.getBodyText() != null && !c.getBodyText().trim().isEmpty())
                        .toList();
                contentModel.setConversations(convDtos);
            }
        } catch (Exception e) {
            log.error("Failed to fetch/process conversations for ticket {}", externalId, e);
        }

        try {
            return objectMapper.writeValueAsString(contentModel);
        } catch (Exception e) {
            log.error("Failed to serialize ticket content to JSON", e);
            return description;
        }
    }

    // ========== 字段填充 ==========

    /**
     * 填充 Freshdesk 元数据字段
     */
    private void populateFreshdeskMetadata(Ticket ticket, Map<String, Object> fdTicket) {
        ticket.setFdStatus(getInteger(fdTicket, "status"));
        ticket.setFdPriority(getInteger(fdTicket, "priority"));
        ticket.setFdSource(getInteger(fdTicket, "source"));
        ticket.setFdType((String) fdTicket.get("type"));
        ticket.setFdRequesterId(getLong(fdTicket, "requester_id"));
        ticket.setFdResponderId(getLong(fdTicket, "responder_id"));
        ticket.setFdGroupId(getLong(fdTicket, "group_id"));

        // 标签数组转逗号分隔字符串
        Object tags = fdTicket.get("tags");
        if (tags instanceof List<?> tagList) {
            ticket.setFdTags(String.join(",", tagList.stream()
                    .map(String::valueOf).toList()));
        }

        // Freshdesk 时间戳
        ticket.setFdCreatedAt(parseDateTime(fdTicket, "created_at"));
        ticket.setFdUpdatedAt(parseDateTime(fdTicket, "updated_at"));
    }

    // ========== 工具方法 ==========

    private String computeContentHash(String content) {
        if (content == null)
            return "";
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(content.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    private Set<Integer> parseStatuses() {
        Set<Integer> result = new HashSet<>();
        if (syncStatuses != null && !syncStatuses.isBlank()) {
            for (String s : syncStatuses.split(",")) {
                try {
                    result.add(Integer.parseInt(s.trim()));
                } catch (NumberFormatException e) {
                    log.warn("Invalid status value in config: {}", s);
                }
            }
        }
        return result;
    }

    private Integer getInteger(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val instanceof Integer i)
            return i;
        if (val instanceof Number n)
            return n.intValue();
        return null;
    }

    private Long getLong(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val instanceof Long l)
            return l;
        if (val instanceof Number n)
            return n.longValue();
        return null;
    }

    private LocalDateTime parseDateTime(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val instanceof String s && !s.isEmpty()) {
            try {
                // Freshdesk 格式: "2024-12-01T10:30:00Z" 或 "2024-12-01T10:30:00+05:30"
                String normalized = s.replace("Z", "");
                // 移除时区偏移（简化处理）
                if (normalized.contains("+")) {
                    normalized = normalized.substring(0, normalized.indexOf('+'));
                }
                return LocalDateTime.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            } catch (Exception e) {
                log.debug("Failed to parse datetime '{}' for key '{}'", val, key);
            }
        }
        return null;
    }
}
