package com.jefflower.fdserver.ticket.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.entity.TicketTranslation;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.repository.TicketTranslationRepository;
import com.jefflower.fdserver.ticket.service.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import lombok.extern.slf4j.Slf4j;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 工单业务回调注册。
 * <p>
 * 将工单业务逻辑注册到 WorkflowCallbackRegistry，
 * 由 BPMN 流程中的 BusinessCallbackDelegate 在适当时机调用。
 */
@Slf4j
@Component
@Order(15)
public class TicketWorkflowCallbackConfig implements CommandLineRunner {

    private final WorkflowCallbackRegistry callbackRegistry;
    private final TicketRepository ticketRepository;
    private final TicketReplyRepository replyRepository;
    private final TicketTranslationRepository translationRepository;
    private final TaskInstanceRepository taskInstanceRepository;
    private final TicketStateMachine stateMachine;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final NotifyService notifyService;
    private final AuditTokenService auditTokenService;
    private final ObjectMapper objectMapper;

    public TicketWorkflowCallbackConfig(WorkflowCallbackRegistry callbackRegistry,
                                         TicketRepository ticketRepository,
                                         TicketReplyRepository replyRepository,
                                         TicketTranslationRepository translationRepository,
                                         TaskInstanceRepository taskInstanceRepository,
                                         TicketStateMachine stateMachine,
                                         ReplyPushService replyPushService,
                                         SystemConfigService systemConfigService,
                                         NotifyService notifyService,
                                         AuditTokenService auditTokenService,
                                         ObjectMapper objectMapper) {
        this.callbackRegistry = callbackRegistry;
        this.ticketRepository = ticketRepository;
        this.replyRepository = replyRepository;
        this.translationRepository = translationRepository;
        this.taskInstanceRepository = taskInstanceRepository;
        this.stateMachine = stateMachine;
        this.replyPushService = replyPushService;
        this.systemConfigService = systemConfigService;
        this.notifyService = notifyService;
        this.auditTokenService = auditTokenService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run(String... args) {
        // 迁移清理：取消旧 Legacy 模式创建的任务（不含 processInstanceId）
        cleanupLegacyTasks();

        // 注册业务数据提供者
        registerTicketDataProvider();
        registerDecisionDataProvider();

        registerTranslationStarted();
        registerTranslationDone();
        registerTranslationSkip();
        registerReplyDone();
        registerReplySkip();
        registerBothDone();
        registerNotifyAudit();
        registerAuditStarted();
        registerAuditPass();
        registerAuditReject();
        registerAuditRetranslate();
        log.info("[TicketWorkflowCallbackConfig] All ticket workflow callbacks registered");
    }

    /**
     * 迁移清理：取消旧 Legacy 模式残留的 PENDING/CLAIMED 任务，后续版本可移除。
     * <p>
     * 旧的任务（payload 不含 processInstanceId）会阻塞客户端消费 BPMN 创建的新任务
     * （因为 claim API 按 ID 排序，旧任务 ID 更小优先被领取）。
     * 旧任务完成后因无 processInstanceId 无法触发工作流推进，导致整个流程卡住。
     */
    private void cleanupLegacyTasks() {
        List<TaskInstance> legacyPending = taskInstanceRepository.findAll().stream()
                .filter(t -> t.getStatus() == TaskStatus.PENDING || t.getStatus() == TaskStatus.CLAIMED)
                .filter(t -> t.getPayload() == null || !t.getPayload().contains("processInstanceId"))
                .filter(t -> t.getTaskType().startsWith("ticket."))
                .toList();

        if (legacyPending.isEmpty()) {
            log.info("[TicketWorkflowCallbackConfig] No legacy tasks to cleanup");
            return;
        }

        int count = 0;
        for (TaskInstance task : legacyPending) {
            task.setStatus(TaskStatus.CANCELLED);
            taskInstanceRepository.save(task);
            count++;
        }
        log.warn("[TicketWorkflowCallbackConfig] Cancelled {} legacy tasks (no processInstanceId) — " +
                "these were created before switching to Flowable BPMN mode", count);
    }

    private void registerTicketDataProvider() {
        callbackRegistry.registerDataProvider("ticket", businessKey -> {
            Long ticketId = Long.parseLong(businessKey);
            Ticket ticket = ticketRepository.findById(ticketId)
                    .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND,
                            "Data provider: ticket not found: " + businessKey));
            Map<String, Object> data = new java.util.HashMap<>();
            data.put("id", ticket.getId());
            data.put("subject", ticket.getSubject());
            data.put("content", ticket.getContent());
            if (ticket.getLastAuditRemark() != null) {
                data.put("lastAuditRemark", ticket.getLastAuditRemark());
            }
            return data;
        });
    }

    /**
     * ticket.translationStarted — Agent 翻译任务已创建
     * <p>
     * PENDING_TRANS → PROCESSING，标记工单进入处理中状态。
     */
    private void registerTranslationStarted() {
        callbackRegistry.register("ticket.translationStarted", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            if (ticket.getStatus() == TicketStatus.PENDING_TRANS) {
                stateMachine.transition(ticket, TicketStatus.PROCESSING);
                ticketRepository.save(ticket);
                log.info("[TicketWorkflowCallback] translationStarted for ticket {}: PENDING_TRANS → PROCESSING", businessKey);
            }
        });
    }

    /**
     * ticket.translationDone — 翻译完成
     * <p>
     * 并行模式下无需状态转换（已经是 PROCESSING），等 bothDone 统一推进到 PENDING_AUDIT。
     */
    private void registerTranslationDone() {
        callbackRegistry.register("ticket.translationDone", (businessKey, vars) -> {
            log.info("[TicketWorkflowCallback] translationDone for ticket {}, staying in PROCESSING", businessKey);
        });
    }

    private void registerReplyDone() {
        callbackRegistry.register("ticket.replyDone", (businessKey, vars) -> {
            // 并行网关模式下，回复完成时翻译可能还没完成。
            // 不设置 PENDING_AUDIT 状态，不发送审核通知。
            // 审核创建在 bothDone 回调中统一完成（并行汇聚后触发）。
            log.info("[TicketWorkflowCallback] replyDone for ticket {}, waiting for parallel join", businessKey);
        });
    }

    private void registerBothDone() {
        callbackRegistry.register("ticket.bothDone", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            stateMachine.transition(ticket, TicketStatus.PENDING_AUDIT);
            ticketRepository.save(ticket);
            log.info("[TicketWorkflowCallback] bothDone for ticket {}, transitioned to PENDING_AUDIT", businessKey);
        });
    }

    /**
     * ticket.notifyAudit — 发送审核通知（独立 BPMN 节点）
     * <p>
     * 生成 auditToken，通过企业微信/钉钉机器人发送审核链接。
     * 通知失败不阻塞流程（try-catch 吞异常，仅记录日志）。
     */
    private void registerNotifyAudit() {
        callbackRegistry.register("ticket.notifyAudit", (businessKey, vars) -> {
            try {
                Ticket ticket = findTicket(businessKey);
                String auditToken = auditTokenService.generateToken(ticket.getId());
                notifyService.notifyPendingAudit(ticket, auditToken);
                log.info("[TicketWorkflowCallback] notifyAudit sent for ticket {}", businessKey);
            } catch (Exception e) {
                log.warn("[TicketWorkflowCallback] notifyAudit failed for ticket {}: {}", businessKey, e.getMessage());
            }
        });
    }

    /**
     * ticket.auditStarted — 人工审核任务已创建
     * <p>
     * PENDING_AUDIT → AUDITING，标记工单进入审核中状态。
     */
    private void registerAuditStarted() {
        callbackRegistry.register("ticket.auditStarted", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            if (ticket.getStatus() == TicketStatus.PENDING_AUDIT) {
                stateMachine.transition(ticket, TicketStatus.AUDITING);
                ticketRepository.save(ticket);
                log.info("[TicketWorkflowCallback] auditStarted for ticket {}: PENDING_AUDIT → AUDITING", businessKey);
            }
        });
    }

    private void registerAuditPass() {
        callbackRegistry.register("ticket.auditPass", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);

            Long replyId = toLong(vars.get("replyId"));
            if (replyId != null) {
                TicketReply reply = replyRepository.findById(replyId)
                        .orElseThrow(() -> new BusinessException(ErrorCode.REPLY_NOT_FOUND));
                reply.setIsSelected(true);
                replyRepository.save(reply);

                boolean autoReply = systemConfigService.isAutoReplyEnabled();
                if (autoReply) {
                    stateMachine.transition(ticket, TicketStatus.COMPLETED);
                    replyPushService.pushReplyToFreshdesk(ticket, reply);
                } else {
                    stateMachine.transition(ticket, TicketStatus.APPROVED);
                }
            } else {
                stateMachine.transition(ticket, TicketStatus.APPROVED);
            }

            ticket.setLastAuditRemark(null);
            ticketRepository.save(ticket);
            notifyService.notifyAuditPass(ticket);
        });
    }

    private void registerAuditReject() {
        callbackRegistry.register("ticket.auditReject", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);

            String auditRemark = vars.get("auditRemark") != null ? vars.get("auditRemark").toString() : null;
            stateMachine.transition(ticket, TicketStatus.PROCESSING);
            ticket.setLastAuditRemark(auditRemark);
            ticketRepository.save(ticket);

            notifyService.notifyAuditReject(ticket, auditRemark);
            // 注意：BPMN 流程会自动循环回 reply_agent，由 AgentTaskDelegate 创建回复任务
        });
    }

    /**
     * ticket.auditRetranslate — 审核驳回至重新翻译
     * <p>
     * PENDING_AUDIT → PENDING_TRANS，保存驳回意见，发送驳回通知。
     * BPMN 流程会自动循环回 translate_agent。
     */
    private void registerAuditRetranslate() {
        callbackRegistry.register("ticket.auditRetranslate", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);

            String auditRemark = vars.get("auditRemark") != null ? vars.get("auditRemark").toString() : null;
            stateMachine.transition(ticket, TicketStatus.PENDING_TRANS);
            ticket.setLastAuditRemark(auditRemark);
            ticketRepository.save(ticket);

            notifyService.notifyAuditReject(ticket, auditRemark);
            log.info("[TicketWorkflowCallback] auditRetranslate for ticket {}, transitioned to PENDING_TRANS", businessKey);
        });
    }

    /**
     * ticket.translationSkip — 翻译被跳过（已有完整翻译）
     * <p>
     * PENDING_TRANS → PROCESSING（如果当前还不是 PROCESSING），记录跳过日志。
     */
    private void registerTranslationSkip() {
        callbackRegistry.register("ticket.translationSkip", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            if (ticket.getStatus() != TicketStatus.PROCESSING) {
                stateMachine.transition(ticket, TicketStatus.PROCESSING);
                ticketRepository.save(ticket);
            }
            log.info("[TicketWorkflowCallback] translationSkip for ticket {}: 翻译已存在，跳过 Agent 执行", businessKey);
        });
    }

    /**
     * ticket.replySkip — 回复被跳过（最后消息非客户）
     * <p>
     * 不做状态转换（并行网关中回复分支完成，等 bothDone 统一处理），仅记录日志。
     */
    private void registerReplySkip() {
        callbackRegistry.register("ticket.replySkip", (businessKey, vars) -> {
            log.info("[TicketWorkflowCallback] replySkip for ticket {}: 最后消息非客户，跳过回复 Agent 执行", businessKey);
        });
    }

    /**
     * ticket.decision 数据提供者 — 为 DecisionDelegate 提供业务决策数据。
     * <p>
     * 返回 Map 包含：
     * <ul>
     *   <li>hasTranslation: boolean — 工单是否已有完整翻译</li>
     *   <li>isLastMessageFromCustomer: boolean — 最后对话是否来自客户</li>
     * </ul>
     */
    private void registerDecisionDataProvider() {
        callbackRegistry.registerDataProvider("ticket.decision", businessKey -> {
            Ticket ticket = findTicket(businessKey);
            Map<String, Object> data = new HashMap<>();
            data.put("hasTranslation", hasCompleteTranslation(ticket));
            data.put("isLastMessageFromCustomer", isLastConversationFromCustomer(ticket));
            return data;
        });
    }

    /**
     * 检查工单是否已有完整翻译。
     * <p>
     * 完整翻译的定义：存在 TicketTranslation 记录且 translatedContent 非空，
     * 并且 translatedContent 的 JSON 结构与 content 匹配（conversations 数组长度一致）。
     */
    private boolean hasCompleteTranslation(Ticket ticket) {
        List<TicketTranslation> translations = translationRepository.findByTicket(ticket);
        if (translations.isEmpty()) {
            return false;
        }

        // 取最新翻译
        TicketTranslation latest = translations.stream()
                .sorted((a, b) -> b.getId().compareTo(a.getId()))
                .findFirst()
                .orElse(null);

        if (latest == null || latest.getTranslatedContent() == null || latest.getTranslatedContent().isBlank()) {
            return false;
        }

        // 结构匹配检查：参考前端 isTranslationStructureMatch 逻辑
        return isTranslationStructureMatch(ticket.getContent(), latest.getTranslatedContent());
    }

    /**
     * 比较 content 和 translatedContent 的 JSON 结构是否匹配。
     * <p>
     * 检查点：翻译后有 description、conversations 数组长度一致。
     */
    private boolean isTranslationStructureMatch(String content, String translatedContent) {
        if (content == null || translatedContent == null) {
            return false;
        }
        try {
            JsonNode original = objectMapper.readTree(content);
            JsonNode translated = objectMapper.readTree(translatedContent);

            // 翻译必须有 description
            JsonNode descNode = translated.path("description");
            if (descNode.isMissingNode() || !descNode.isTextual() || descNode.asText().isBlank()) {
                return false;
            }

            // conversations 数组长度必须一致
            JsonNode origConvs = original.path("conversations");
            JsonNode transConvs = translated.path("conversations");

            int origCount = origConvs.isArray() ? origConvs.size() : 0;
            int transCount = transConvs.isArray() ? transConvs.size() : 0;

            if (origCount != transCount) {
                return false;
            }

            return true;
        } catch (Exception e) {
            log.warn("[TicketWorkflowCallback] Failed to check translation structure match for ticket {}: {}",
                    content != null ? content.substring(0, Math.min(50, content.length())) : "null",
                    e.getMessage());
            return false;
        }
    }

    /**
     * 检查最后一条对话是否来自客户。
     * <p>
     * 解析 ticket.content JSON，取 conversations 数组最后一条：
     * - incoming == true → 客户消息
     * - incoming == false → 客服/Agent 消息
     * <p>
     * 如果无法解析或无对话记录，默认返回 true（不跳过回复）。
     */
    private boolean isLastConversationFromCustomer(Ticket ticket) {
        if (ticket.getContent() == null || ticket.getContent().isBlank()) {
            return true; // 无内容，不跳过
        }
        try {
            JsonNode root = objectMapper.readTree(ticket.getContent());
            JsonNode conversations = root.path("conversations");
            if (!conversations.isArray() || conversations.isEmpty()) {
                return true; // 无对话记录，不跳过
            }

            JsonNode lastConv = conversations.get(conversations.size() - 1);
            JsonNode incomingNode = lastConv.path("incoming");

            // Freshdesk API: incoming=true 表示客户发来的消息，incoming=false 表示客服/Agent 发出的回复
            if (incomingNode.isBoolean()) {
                return incomingNode.asBoolean();
            }

            // incoming 字段缺失时默认认为是客户消息（不跳过）
            return true;
        } catch (Exception e) {
            log.warn("[TicketWorkflowCallback] Failed to parse conversations for ticket {}: {}",
                    ticket.getId(), e.getMessage());
            return true; // 解析失败，不跳过
        }
    }

    private Ticket findTicket(String businessKey) {
        Long ticketId = Long.parseLong(businessKey);
        return ticketRepository.findById(ticketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND,
                        "Workflow callback: ticket not found: " + businessKey));
    }

    private Long toLong(Object value) {
        if (value == null) return null;
        if (value instanceof Long l) return l;
        if (value instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
