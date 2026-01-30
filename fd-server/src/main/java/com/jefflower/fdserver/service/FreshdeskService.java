package com.jefflower.fdserver.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.dto.TicketContent;
import com.jefflower.fdserver.entity.SyncLog;
import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.entity.TicketReply;
import com.jefflower.fdserver.enums.TicketStatus;
import com.jefflower.fdserver.enums.TriggerType;
import com.jefflower.fdserver.repository.TicketRepository;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class FreshdeskService {

    private final TicketRepository ticketRepository;
    private final MqPublisherService mqPublisherService;
    private final SyncConfigService syncConfigService;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${freshdesk.domain}")
    private String freshdeskDomain;

    @Value("${freshdesk.api-key}")
    private String apiKey;

    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        String auth = apiKey + ":X";
        String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));
        headers.set("Authorization", "Basic " + encodedAuth);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /**
     * 同步结果封装类
     */
    @Getter
    public static class SyncResult {
        private final int syncedCount;
        private final int updatedCount;
        private final boolean success;
        private final String message;

        public SyncResult(int syncedCount, int updatedCount, boolean success, String message) {
            this.syncedCount = syncedCount;
            this.updatedCount = updatedCount;
            this.success = success;
            this.message = message;
        }
    }

    /**
     * 带锁的同步方法（供外部调用）
     */
    public SyncResult syncTicketsWithLock(TriggerType triggerType) {
        // 尝试获取锁
        if (!syncConfigService.tryAcquireSyncLock()) {
            log.warn("Sync already in progress, skipping {} sync", triggerType);
            return new SyncResult(0, 0, false, "同步正在进行中，请稍后重试");
        }

        SyncLog syncLog = null;
        try {
            // 创建日志记录
            syncLog = syncConfigService.createSyncLog(triggerType);

            // 执行同步
            SyncResult result = doSyncTickets();

            // 更新日志
            syncConfigService.completeSyncLog(syncLog, result.getSyncedCount(), result.getUpdatedCount());

            // 更新上次同步时间
            syncConfigService.updateLastSyncTime(LocalDateTime.now());

            return result;
        } catch (Exception e) {
            log.error("Sync failed", e);
            if (syncLog != null) {
                syncConfigService.failSyncLog(syncLog, e.getMessage());
            }
            return new SyncResult(0, 0, false, "同步失败: " + e.getMessage());
        } finally {
            syncConfigService.releaseSyncLock();
        }
    }

    /**
     * 实际执行同步的内部方法
     */
    private SyncResult doSyncTickets() {
        log.info("Starting Freshdesk ticket sync...");

        // 获取上次同步时间
        LocalDateTime lastSyncTime = syncConfigService.getLastSyncTime();

        // 构建 URL
        StringBuilder urlBuilder = new StringBuilder();
        urlBuilder.append(String.format(
                "https://%s/api/v2/tickets?order_by=updated_at&order_type=desc&per_page=100&include=description",
                freshdeskDomain));

        if (lastSyncTime != null) {
            // 如果有上次同步时间，只获取更新的工单
            urlBuilder.append("&updated_since=").append(lastSyncTime.toString());
            log.info("Incremental sync since: {}", lastSyncTime);
        } else {
            log.info("Full sync (no last sync time)");
        }

        HttpEntity<String> entity = new HttpEntity<>(createHeaders());
        ResponseEntity<List> response = restTemplate.exchange(urlBuilder.toString(), HttpMethod.GET, entity,
                List.class);

        List<Map<String, Object>> tickets = response.getBody();
        log.info("Freshdesk API returned {} tickets", tickets != null ? tickets.size() : 0);
        if (tickets == null || tickets.isEmpty()) {
            log.info("No tickets to sync");
            return new SyncResult(0, 0, true, "没有需要同步的工单");
        }

        int syncedCount = 0;
        int updatedCount = 0;

        for (Map<String, Object> fdTicket : tickets) {
            String externalId = String.valueOf(fdTicket.get("id"));
            Integer status = (Integer) fdTicket.get("status");

            log.info("Freshdesk ticket {}: keys={}, subject={}, has_desc_text={}, has_desc={}",
                    externalId, fdTicket.keySet(), fdTicket.get("subject"),
                    fdTicket.get("description_text") != null, fdTicket.get("description") != null);

            // 只处理 Open 状态的工单 (Freshdesk status=2 表示 Open)
            if (status != null && status == 2) {
                Ticket ticket = ticketRepository.findByExternalId(externalId).orElse(null);
                boolean isNew = (ticket == null);

                if (isNew) {
                    ticket = new Ticket();
                    ticket.setExternalId(externalId);
                    ticket.setCreatedAt(LocalDateTime.now());
                }

                ticket.setSubject((String) fdTicket.get("subject"));

                // 获取描述内容
                String description = (String) fdTicket.get("description_text");
                if (description == null) {
                    description = (String) fdTicket.get("description");
                }

                // 获取并拼接所有对话（Conversations/Notes）
                String allContent = buildFullContent(externalId, description);
                log.info("Ticket {} - Description length: {}, AllContent length: {}",
                        externalId, description != null ? description.length() : 0,
                        allContent != null ? allContent.length() : 0);
                ticket.setContent(allContent);

                if (isNew) {
                    ticket.setStatus(TicketStatus.PENDING_TRANS);
                }

                ticketRepository.save(ticket);

                // 判断是否需要发送 MQ 任务
                // 只有 PENDING_TRANS 状态（还在队列中）才跳过，其他状态都发送
                boolean shouldSendMq = isNew || ticket.getStatus() != TicketStatus.PENDING_TRANS;

                if (shouldSendMq) {
                    // 重新设置状态为待翻译
                    if (!isNew) {
                        ticket.setStatus(TicketStatus.PENDING_TRANS);
                        ticketRepository.save(ticket);
                    }
                    mqPublisherService.sendTranslationTask(ticket);
                    log.info("Sent MQ task for ticket {}, isNew={}", externalId, isNew);
                } else {
                    log.info("Skipped MQ task for ticket {} (status={})", externalId, ticket.getStatus());
                }

                if (isNew) {
                    syncedCount++;
                } else {
                    updatedCount++;
                }
            }
        }

        log.info("Synced {} new tickets, updated {} existing tickets from Freshdesk", syncedCount, updatedCount);
        return new SyncResult(syncedCount, updatedCount, true,
                String.format("同步完成：新增 %d，更新 %d", syncedCount, updatedCount));
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
     * 构建包含描述和所有对话的 JSON 内容
     */
    private String buildFullContent(String externalId, String description) {
        TicketContent contentModel = new TicketContent();
        contentModel.setDescription(description);

        try {
            List<Map<String, Object>> conversations = fetchConversations(externalId);
            if (conversations != null && !conversations.isEmpty()) {
                List<TicketContent.ConversationDto> convDtos = conversations.stream()
                        .map(conv -> TicketContent.ConversationDto.builder()
                                .id(Long.valueOf(String.valueOf(conv.get("id"))))
                                .bodyText((String) conv.get("body_text"))
                                .isPrivate((Boolean) conv.get("private"))
                                .incoming((Boolean) conv.get("incoming"))
                                .userId(conv.get("user_id") != null ? Long.valueOf(String.valueOf(conv.get("user_id")))
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
            return description; // Fallback to plain description if serialization fails
        }
    }

    /**
     * 从 Freshdesk 获取对话
     */
    private List<Map<String, Object>> fetchConversations(String ticketId) {
        String url = String.format("https://%s/api/v2/tickets/%s/conversations", freshdeskDomain, ticketId);
        try {
            HttpEntity<String> entity = new HttpEntity<>(createHeaders());
            ResponseEntity<List<Map<String, Object>>> response = restTemplate.exchange(url, HttpMethod.GET, entity,
                    new org.springframework.core.ParameterizedTypeReference<List<Map<String, Object>>>() {
                    });
            return response.getBody();
        } catch (Exception e) {
            log.error("Error fetching conversations from Freshdesk: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 推送回复到 Freshdesk
     */
    public void pushReplyToFreshdesk(Ticket ticket, TicketReply reply) {
        log.info("Pushing reply to Freshdesk for ticket: {}", ticket.getExternalId());

        String url = String.format("https://%s/api/v2/tickets/%s/reply",
                freshdeskDomain, ticket.getExternalId());

        try {
            Map<String, Object> body = Map.of("body", reply.getTargetReply());
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, createHeaders());

            restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
            log.info("Successfully pushed reply to Freshdesk");
        } catch (Exception e) {
            log.error("Failed to push reply to Freshdesk", e);
        }
    }
}
