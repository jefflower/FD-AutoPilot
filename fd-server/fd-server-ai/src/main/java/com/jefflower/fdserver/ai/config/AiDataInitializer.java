package com.jefflower.fdserver.ai.config;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.CallMode;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.ai.service.AgentBinding;
import com.jefflower.fdserver.ai.service.AgentBindingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;

@Component
@Order(10)
public class AiDataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AiDataInitializer.class);
    private final AgentDefinitionRepository repository;
    private final AgentBindingRepository bindingRepository;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public AiDataInitializer(AgentDefinitionRepository repository,
            AgentBindingRepository bindingRepository,
            CapabilityDefinitionRepository capabilityDefinitionRepository) {
        this.repository = repository;
        this.bindingRepository = bindingRepository;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
    }

    // --- Input/Output Schema constants ---
    private static final String TRANSLATE_INPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"ticket\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"content\":{\"type\":\"string\"}},\"required\":[\"id\",\"content\"]},\"targetLang\":{\"type\":\"string\"}},\"required\":[\"ticket\",\"targetLang\"]}";

    private static final String TRANSLATE_OUTPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"subject\":{\"type\":\"string\"},\"description\":{\"type\":\"string\"},\"conversations\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"bodyText\":{\"type\":\"string\"}},\"required\":[\"id\",\"bodyText\"]}}},\"required\":[\"subject\",\"description\",\"conversations\"]}";

    private static final String REPLY_INPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"ticket\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"subject\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"id\",\"subject\",\"content\"]},\"lastAuditRemark\":{\"type\":\"string\"}},\"required\":[\"ticket\"]}";

    private static final String REPLY_OUTPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"targetReply\":{\"type\":\"string\"},\"zhReply\":{\"type\":\"string\"}},\"required\":[\"targetReply\",\"zhReply\"]}";

    private static final String DEFAULT_TEMPLATE_ENGINE = "simple";

    @Override
    @Transactional
    public void run(String... args) {
        // 0. 清理 PostgreSQL 自动生成的过时 CHECK 约束（新增枚举值后约束不会自动更新）
        dropOutdatedCheckConstraints();

        // 1. 初始化内置 Capability（必须在 Agent 初始化之前）
        initBuiltInCapabilities();

        // 2. 初始化内置 Agent（含 requiredCapability）
        initBuiltInAgents();

        // 3. 回填旧数据的 requiredCapability
        backfillRequiredCapability();

        // 4. 清理已移除的内置 Agent
        cleanupRemovedBuiltInAgents(Set.of("ticket-translate", "ticket-reply", "n8n-workflow-designer",
                "logistics-reply", "completion-reply"));

        // 5. 初始化默认能力绑定
        ensureDefaultBinding("ticket-translate", "ticket-translate");
        ensureDefaultBinding("ticket-reply", "ticket-reply");
        ensureDefaultBinding("logistics-reply", "logistics-reply");
        ensureDefaultBinding("completion-reply", "completion-reply");
    }

    /**
     * 清理 PostgreSQL 自动生成的 enum CHECK 约束，并移除已废弃字段的 NOT NULL 约束。
     * Hibernate ddl-auto=update 在创建枚举列时会生成 CHECK 约束，
     * 但新增枚举值后不会自动更新约束，导致插入新值时违反约束。
     * 同时 ddl-auto=update 不会自动移除 NOT NULL 约束，需要手动处理。
     */
    private void dropOutdatedCheckConstraints() {
        String[] sqls = {
                "ALTER TABLE ai_agent_definition DROP CONSTRAINT IF EXISTS ai_agent_definition_provider_type_check",
                "ALTER TABLE ai_agent_definition DROP CONSTRAINT IF EXISTS ai_agent_definition_execution_env_check",
                "ALTER TABLE ai_agent_definition DROP CONSTRAINT IF EXISTS ai_agent_definition_call_mode_check",
                "ALTER TABLE ai_capability_definition DROP CONSTRAINT IF EXISTS ai_capability_definition_provider_type_check",
                "ALTER TABLE ai_capability_definition DROP CONSTRAINT IF EXISTS ai_capability_definition_execution_env_check",
                // 已废弃字段允许 NULL（Hibernate ddl-auto=update 不会自动移除 NOT NULL）
                "ALTER TABLE ai_agent_definition ALTER COLUMN execution_env DROP NOT NULL",
                "ALTER TABLE ai_agent_definition ALTER COLUMN provider_type DROP NOT NULL"
        };
        for (String sql : sqls) {
            try {
                entityManager.createNativeQuery(sql).executeUpdate();
            } catch (Exception e) {
                // 约束可能不存在或数据库不支持 IF EXISTS，忽略
                log.debug("[AiDataInitializer] Constraint drop skipped: {}", e.getMessage());
            }
        }
        entityManager.flush();
        log.info("[AiDataInitializer] Cleaned up outdated enum check constraints");
    }

    /**
     * 初始化内置 Capability Definition。
     * 使用 findByCode 做幂等检查，已存在则跳过。
     */
    private void initBuiltInCapabilities() {
        ensureBuiltInCapability("gemini-cli", "Gemini CLI", ProviderType.GEMINI_CLI,
                "{\"command\":\"gemini --version\"}", "{\"steps\":[\"安装 Gemini CLI\"]}", 0, true, null);

        ensureBuiltInCapability("claude-cli", "Claude CLI", ProviderType.CLAUDE_CLI,
                "{\"command\":\"claude --version\"}", "{\"steps\":[\"安装 Claude CLI\"]}", 1, true, null);

        ensureBuiltInCapability("notebooklm-py", "NotebookLM Python", ProviderType.NOTEBOOKLM_PY,
                "{\"command\":\"python -c \\\"import notebooklm\\\"\"}", "{\"steps\":[\"pip install notebooklm-py\"]}",
                2, true,
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");

        ensureBuiltInCapability("shadow-window", "Shadow Window", ProviderType.TRACKING_SHADOW,
                null, null, 3, false,
                "{\"targetUrl\":{\"type\":\"string\",\"label\":\"Target URL\",\"required\":true,\"description\":\"目标网页 URL\"}}");
    }

    private void ensureBuiltInCapability(String code, String name, ProviderType providerType,
            String detectConfig, String installGuide,
            int sortOrder, boolean enabled, String configSchema) {
        var existing = capabilityDefinitionRepository.findByCode(code);
        if (existing.isPresent()) {
            // 生产数据保护：已存在的 Capability 不再强制更新 configSchema，仅打印差异提示
            CapabilityDefinition cap = existing.get();
            if (configSchema != null && !configSchema.equals(cap.getConfigSchema())) {
                log.warn(
                        "[AiDataInitializer] Capability '{}' configSchema differs from code definition (DB value preserved). "
                                + "Code: {}, DB: {}",
                        code, configSchema, cap.getConfigSchema());
            }
            return;
        }
        CapabilityDefinition cap = new CapabilityDefinition();
        cap.setCode(code);
        cap.setName(name);
        cap.setProviderType(providerType);
        cap.setDetectConfig(detectConfig);
        cap.setInstallGuide(installGuide);
        cap.setSortOrder(sortOrder);
        cap.setEnabled(enabled);
        cap.setBuiltIn(true);
        cap.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        cap.setConfigSchema(configSchema);
        capabilityDefinitionRepository.save(cap);
        log.info("[AiDataInitializer] Created built-in capability: {}", code);
    }

    /**
     * 初始化内置 Agent（含 requiredCapability 参数）。
     */
    private void initBuiltInAgents() {
        // === 工单处理 Agent（n8n 工作流 + Sync Bridge 使用） ===
        ensureBuiltInAgent(
                "ticket-translate",
                "工单翻译并分类",
                "通过 Gemini CLI 翻译工单内容并完成业务分类",
                null,
                null,
                "ticket-translate",
                "ticket",
                null,
                null,
                null,
                "You are a professional customer service translator and classifier.\n\n"
                        + "Task: Translate the following ticket JSON into Simplified Chinese (中文), classify the ticket into one of 4 categories, and determine if the issue is already resolved.\n\n"
                        + "CATEGORIES:\n"
                        + "- PRODUCT_FAULT: Product quality issues, usage problems, returns/exchanges\n"
                        + "- LOGISTICS_INQUIRY: Shipping status, delivery time, tracking inquiries\n"
                        + "- BUSINESS_COOPERATION: Agency cooperation, bulk purchasing, business partnership\n"
                        + "- OTHER: Cannot be categorized into above\n\n"
                        + "RESOLVED DETECTION:\n"
                        + "- Set \"resolved\" to true ONLY when the customer explicitly confirms the issue is resolved, expresses thanks for resolution, or indicates no further help is needed\n"
                        + "- Set \"resolved\" to false for all other cases (new issues, ongoing problems, questions, etc.)\n\n"
                        + "STRICT OUTPUT FORMAT:\n"
                        + "- Output ONLY a raw JSON object. Start with { and end with }.\n"
                        + "- Do NOT wrap in markdown code fences (```).\n"
                        + "- Do NOT add any text before or after the JSON.\n"
                        + "- Keep the JSON structure identical, only translate text values.\n"
                        + "- ADD a \"category\" field at the top level with one of: PRODUCT_FAULT, LOGISTICS_INQUIRY, BUSINESS_COOPERATION, OTHER\n"
                        + "- ADD a \"resolved\" field at the top level with true or false\n\n"
                        + "Ticket JSON:\n${TICKET_CONTENT}",
                0,
                TRANSLATE_INPUT_SCHEMA,
                TRANSLATE_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "gemini-cli");

        ensureBuiltInAgent(
                "ticket-reply",
                "工单回复",
                "通过 NotebookLM Python 生成工单回复",
                null,
                null,
                "ticket-reply",
                "ticket",
                null,
                null,
                "{\"notebookId\":\"7662c1de-8bba-4d54-b834-e38161f942f4\"}",
                "根据下面的工单内容，使用用户工单的语言做出回复及回复的中文翻译。\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Hello, thanks for contacting us.\",\"你好，感谢联系我们。\"]\n\n"
                        + "工单内容：\n${TICKET_CONTENT}",
                1,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");

        // === n8n 工作流设计师 Agent ===
        ensureBuiltInAgent(
                "n8n-workflow-designer",
                "n8n 工作流设计师",
                "通过 AI 对话设计和管理 n8n 工作流",
                null,
                null,
                "n8n-workflow-designer",
                "workflow",
                null,
                null,
                null,
                "你是一个专业的 n8n 工作流设计师。根据用户的需求设计和修改 n8n 工作流。\n\n"
                        + "## 工作区参考文档\n${WORKSPACE_DOCS}\n\n"
                        + "## 当前工作流 JSON\n${CURRENT_WORKFLOW_JSON}\n\n"
                        + "## 工作流中相关 Agent 的提示词\n${RELATED_AGENT_PROMPTS}\n\n"
                        + "## 对话历史\n${CONVERSATION_HISTORY}\n\n"
                        + "## 用户消息\n${USER_MESSAGE}\n\n"
                        + "## 输出要求\n"
                        + "你的回复必须严格遵循以下结构化 JSON 格式（用 ```json 包裹），不要输出其他格式：\n\n"
                        + "```json\n"
                        + "{\n"
                        + "  \"explanation\": \"设计思路说明，解释你做了什么以及为什么\",\n"
                        + "  \"workflowJson\": { ... 完整的 n8n 工作流 JSON 对象 ... },\n"
                        + "  \"agentPromptAdjustments\": [\n"
                        + "    {\n"
                        + "      \"agentCode\": \"agent-code\",\n"
                        + "      \"agentName\": \"Agent 名称\",\n"
                        + "      \"reason\": \"为什么需要调整提示词\",\n"
                        + "      \"suggestedPrompt\": \"建议的新 systemPrompt 完整内容\"\n"
                        + "    }\n"
                        + "  ],\n"
                        + "  \"apiAdjustments\": [\n"
                        + "    {\n"
                        + "      \"endpoint\": \"/api/v1/xxx\",\n"
                        + "      \"method\": \"POST/GET/PUT/DELETE\",\n"
                        + "      \"description\": \"需要新增或修改的 API 说明\",\n"
                        + "      \"suggestedChanges\": \"具体的调整建议\"\n"
                        + "    }\n"
                        + "  ]\n"
                        + "}\n"
                        + "```\n\n"
                        + "### 字段说明\n"
                        + "- **explanation**: 必填。用自然语言说明设计思路、修改内容、每个节点的作用\n"
                        + "- **workflowJson**: 必填。完整的 n8n 工作流 JSON 对象（不是字符串！）\n"
                        + "- **agentPromptAdjustments**: 如果工作流变更需要配套调整 Agent 提示词则填写，否则为空数组\n"
                        + "- **apiAdjustments**: 如果工作流设计需要新增或修改后端 API 则填写，否则为空数组\n\n"
                        + "### 注意事项\n"
                        + "1. workflowJson 必须是合法的 n8n 工作流 JSON 对象，包含 nodes、connections、settings\n"
                        + "2. 参考\"工作流中相关 Agent 的提示词\"了解现有 Agent 的工作方式\n"
                        + "3. 如果修改了工作流中调用 Agent 的方式，务必在 agentPromptAdjustments 中给出配套的提示词调整\n"
                        + "4. 如果工作流需要调用目前不存在的 API，在 apiAdjustments 中说明",
                10,
                null,
                null,
                DEFAULT_TEMPLATE_ENGINE,
                "claude-cli");

        // === 物流查询回复 Agent ===
        ensureBuiltInAgent(
                "logistics-reply",
                "物流查询回复",
                "针对物流查询类工单生成专业回复",
                null, null,
                "logistics-reply",
                "ticket",
                null, null,
                null, // agentConfig（notebookId 需要后续在管理后台配置）
                "根据下面的物流查询工单内容，使用用户工单的语言做出回复及回复的中文翻译。\n\n"
                        + "回复要点：\n"
                        + "- 确认收到物流查询请求\n"
                        + "- 提供可能的物流进度说明\n"
                        + "- 告知预计处理时间\n"
                        + "- 语气专业友好\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Hello, thanks for contacting us.\",\"你好，感谢联系我们。\"]\n\n"
                        + "工单内容：\n${TICKET_CONTENT}",
                2,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");

        // === 处理完成回复 Agent ===
        ensureBuiltInAgent(
                "completion-reply",
                "处理完成回复",
                "针对已解决/客户致谢类工单生成确认回复",
                null, null,
                "completion-reply",
                "ticket",
                null, null,
                null, // agentConfig（notebookId 需要后续在管理后台配置）
                "根据下面的工单内容，客户已确认问题解决或表示感谢。使用用户工单的语言做出礼貌的确认回复及中文翻译。\n\n"
                        + "回复要点：\n"
                        + "- 感谢客户的反馈\n"
                        + "- 确认问题已圆满解决\n"
                        + "- 欢迎后续联系\n"
                        + "- 语气温暖亲切\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Thank you for your feedback!\",\"感谢您的反馈！\"]\n\n"
                        + "工单内容：\n${TICKET_CONTENT}",
                3,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");
    }

    /**
     * 回填旧数据的 requiredCapability。
     * 遍历所有 AgentDefinition，对 requiredCapability == null 的记录按 providerType 映射回填。
     */
    @SuppressWarnings("deprecation")
    private void backfillRequiredCapability() {
        List<AgentDefinition> allAgents = repository.findAll();
        for (AgentDefinition agent : allAgents) {
            if (agent.getRequiredCapability() != null) {
                continue;
            }
            String mappedCapability = mapProviderTypeToCapability(agent.getProviderType());
            if (mappedCapability != null) {
                agent.setRequiredCapability(mappedCapability);
                repository.save(agent);
                log.info("[AiDataInitializer] Backfilled requiredCapability for agent '{}': {}",
                        agent.getCode(), mappedCapability);
            }
        }
    }

    /**
     * 按 providerType 映射到 Capability code。
     * HTTP_API 和 LOCAL_FUNCTION 不回填。
     */
    @SuppressWarnings("deprecation")
    private String mapProviderTypeToCapability(ProviderType providerType) {
        if (providerType == null)
            return null;
        return switch (providerType) {
            case GEMINI_CLI -> "gemini-cli";
            case CLAUDE_CLI -> "claude-cli";
            case NOTEBOOKLM, NOTEBOOKLM_PY -> "notebooklm-py";
            case TRACKING_SHADOW -> "shadow-window";
            default -> null; // HTTP_API, LOCAL_FUNCTION, deprecated types
        };
    }

    /**
     * 清理已移除的内置 Agent。仅删除 builtIn=true 且 code 不在当前定义集合中的记录。
     * 同时清理指向已删除 Agent 的能力绑定。
     */
    private void cleanupRemovedBuiltInAgents(Set<String> currentBuiltInCodes) {
        List<AgentDefinition> builtInAgents = repository.findByBuiltInTrue();
        for (AgentDefinition agent : builtInAgents) {
            if (!currentBuiltInCodes.contains(agent.getCode())) {
                // 清理指向该 Agent 的绑定
                bindingRepository.findByCapability(agent.getCapability()).ifPresent(binding -> {
                    if (agent.getCode().equals(binding.getAgentCode())) {
                        bindingRepository.delete(binding);
                        log.info("[AiDataInitializer] Removed stale binding: {} -> {}", binding.getCapability(),
                                binding.getAgentCode());
                    }
                });
                repository.delete(agent);
                log.info("[AiDataInitializer] Removed obsolete built-in agent: {}", agent.getCode());
            }
        }
    }

    /**
     * 确保默认能力绑定存在。仅当该 capability 尚未配置绑定时才创建。
     */
    private void ensureDefaultBinding(String capability, String agentCode) {
        if (bindingRepository.findByCapability(capability).isPresent()) {
            return; // 已有绑定，不覆盖
        }
        // 确认目标 Agent 存在
        if (repository.findByCode(agentCode).isEmpty()) {
            log.warn("[AiDataInitializer] Cannot create default binding: agent '{}' not found", agentCode);
            return;
        }
        AgentBinding binding = new AgentBinding();
        binding.setCapability(capability);
        binding.setAgentCode(agentCode);
        bindingRepository.save(binding);
        log.info("[AiDataInitializer] Created default binding: {} -> {}", capability, agentCode);
    }

    @SuppressWarnings("deprecation")
    private void ensureBuiltInAgent(String code, String name, String description,
            ProviderType providerType, ExecutionEnv executionEnv,
            String capability, String groupCode,
            CallMode callMode, String callUrl,
            String agentConfig, String systemPrompt, int sortOrder,
            String inputSchema, String outputSchema,
            String templateEngine, String requiredCapability) {
        var existing = repository.findByCode(code);
        if (existing.isPresent()) {
            // 重启自动同步：systemPrompt / inputSchema / outputSchema 以代码为准，自动覆盖
            // agentConfig 由用户在管理后台配置（如 notebookId），不覆盖
            AgentDefinition def = existing.get();
            boolean updated = false;

            // systemPrompt 自动同步
            if (systemPrompt != null && !systemPrompt.equals(def.getSystemPrompt())) {
                log.info("[AiDataInitializer] Agent '{}' systemPrompt updated from code definition", code);
                def.setSystemPrompt(systemPrompt);
                updated = true;
            }
            // inputSchema 自动同步
            if (inputSchema != null && !inputSchema.equals(def.getInputSchema())) {
                log.info("[AiDataInitializer] Agent '{}' inputSchema updated from code definition", code);
                def.setInputSchema(inputSchema);
                updated = true;
            }
            // outputSchema 自动同步
            if (outputSchema != null && !outputSchema.equals(def.getOutputSchema())) {
                log.info("[AiDataInitializer] Agent '{}' outputSchema updated from code definition", code);
                def.setOutputSchema(outputSchema);
                updated = true;
            }
            // agentConfig 差异检测（不覆盖，由用户管理）
            if (agentConfig == null ? def.getAgentConfig() != null : !agentConfig.equals(def.getAgentConfig())) {
                log.debug(
                        "[AiDataInitializer] Agent '{}' agentConfig differs from code definition (DB value preserved). "
                                + "Code: {}, DB: {}",
                        code, agentConfig, def.getAgentConfig());
            }

            // 回填 groupCode（仅旧值为 null 时）
            if (def.getGroupCode() == null && groupCode != null) {
                def.setGroupCode(groupCode);
                updated = true;
            }

            // 清空已废弃的 callMode、callUrl、templateEngine、executionEnv、providerType
            if (def.getCallMode() != null) {
                def.setCallMode(null);
                updated = true;
            }
            if (def.getCallUrl() != null) {
                def.setCallUrl(null);
                updated = true;
            }
            if (def.getTemplateEngine() != null) {
                def.setTemplateEngine(null);
                updated = true;
            }
            // executionEnv 已由 CapabilityDefinition 定义，Agent 层不再使用
            if (def.getExecutionEnv() != null) {
                def.setExecutionEnv(null);
                updated = true;
                log.info("[AiDataInitializer] Cleared deprecated executionEnv for agent: {}", code);
            }
            // providerType 可从 requiredCapability → CapabilityDefinition.providerType 推导
            if (def.getProviderType() != null) {
                def.setProviderType(null);
                updated = true;
                log.info("[AiDataInitializer] Cleared deprecated providerType for agent: {}", code);
            }

            // Backfill requiredCapability
            if (def.getRequiredCapability() == null && requiredCapability != null) {
                def.setRequiredCapability(requiredCapability);
                updated = true;
                log.info("[AiDataInitializer] Backfilled requiredCapability for agent '{}': {}", code,
                        requiredCapability);
            }

            if (updated) {
                repository.save(def);
                log.info("[AiDataInitializer] Backfilled fields for agent: {}", code);
            }
            return;
        }

        AgentDefinition def = new AgentDefinition();
        def.setCode(code);
        def.setName(name);
        def.setDescription(description);
        // providerType 和 executionEnv 不再在 Agent 层设置（由 CapabilityDefinition 定义）
        def.setCapability(capability);
        def.setGroupCode(groupCode);
        def.setCallMode(callMode);
        def.setCallUrl(callUrl);
        def.setAgentConfig(agentConfig);
        def.setSystemPrompt(systemPrompt);
        def.setInputSchema(inputSchema);
        def.setOutputSchema(outputSchema);
        def.setTemplateEngine(templateEngine);
        def.setRequiredCapability(requiredCapability);
        def.setEnabled(true);
        def.setBuiltIn(true);
        def.setSortOrder(sortOrder);

        repository.save(def);
        log.info("[AiDataInitializer] Created built-in agent: {}", code);
    }
}
