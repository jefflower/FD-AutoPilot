package com.jefflower.fdserver.ai.config;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.enums.CallMode;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.service.AgentBinding;
import com.jefflower.fdserver.ai.service.AgentBindingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@Order(10)
public class AiDataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AiDataInitializer.class);
    private final AgentDefinitionRepository repository;
    private final AgentBindingRepository bindingRepository;

    public AiDataInitializer(AgentDefinitionRepository repository,
                              AgentBindingRepository bindingRepository) {
        this.repository = repository;
        this.bindingRepository = bindingRepository;
    }

    // --- Input/Output Schema constants ---
    private static final String TRANSLATE_INPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"ticket\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"subject\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"id\",\"subject\",\"content\"]},\"targetLang\":{\"type\":\"string\"}},\"required\":[\"ticket\",\"targetLang\"]}";

    private static final String TRANSLATE_OUTPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"subject\":{\"type\":\"string\"},\"conversations\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"original\":{\"type\":\"string\"},\"translated\":{\"type\":\"string\"}}}}},\"required\":[\"subject\",\"conversations\"]}";

    private static final String REPLY_INPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"ticket\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"subject\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"id\",\"subject\",\"content\"]},\"lastAuditRemark\":{\"type\":\"string\"}},\"required\":[\"ticket\"]}";

    private static final String REPLY_OUTPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"targetReply\":{\"type\":\"string\"},\"zhReply\":{\"type\":\"string\"}},\"required\":[\"targetReply\",\"zhReply\"]}";

    private static final String TRACKING_INPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"trackingNumbers\":{\"type\":\"array\",\"items\":{\"type\":\"string\"},\"maxItems\":3}},\"required\":[\"trackingNumbers\"]}";

    private static final String TRACKING_OUTPUT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"results\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"trackingNumber\":{\"type\":\"string\"},\"status\":{\"type\":\"string\"},\"details\":{\"type\":\"string\"}}}}}}";

    private static final String DEFAULT_TEMPLATE_ENGINE = "simple";

    @Override
    @Transactional
    public void run(String... args) {
        ensureBuiltInAgent(
                "gemini-translate",
                "Gemini CLI 翻译",
                "通过 Gemini CLI 翻译工单内容",
                ProviderType.GEMINI_CLI,
                ExecutionEnv.CLIENT_ONLY,
                "translation",
                "ticket",
                CallMode.MQ,
                null,
                "{\"invokeCommand\":\"execute_gemini_cmd\",\"models\":[\"gemini-2.5-flash\"],\"timeout\":120,\"systemPrompt\":\"You are a professional customer support translator. Translate the following support ticket into ${TARGET_LANG}.\\n\\nCRITICAL INSTRUCTIONS:\\n1. Response must be ONLY a valid JSON object.\\n2. Do NOT include any intro, outro, explanations, or markdown blocks (like ```json).\\n3. You MUST translate BOTH the subject/description AND EVERY item in the 'conversations' list.\\n4. Maintain the original 'id' for each conversation item.\\n5. Ensure the content is ONLY in ${TARGET_LANG} - DO NOT output in English if the target is ${TARGET_LANG}.\\n6. JSON Structure Example:\\n{\\n  \\\"subject\\\": \\\"翻译后的标题\\\",\\n  \\\"description_text\\\": \\\"翻译后的正文内容\\\",\\n  \\\"conversations\\\": [\\n    {\\\"id\\\": 123, \\\"body_text\\\": \\\"翻译后的对话消息\\\"}\\n  ]\\n}\\n\\n${TICKET_CONTENT}\"}",
                0,
                TRANSLATE_INPUT_SCHEMA,
                TRANSLATE_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE
        );

        ensureBuiltInAgent(
                "notebooklm-reply",
                "NotebookLM 回复",
                "通过 NotebookLM Shadow Window 生成工单回复",
                ProviderType.WEB_AUTOMATION,
                ExecutionEnv.CLIENT_ONLY,
                "reply",
                "ticket",
                CallMode.MQ,
                null,
                "{\"windowLabel\":\"notebook_shadow\",\"notebookId\":\"\",\"notebookUrl\":\"\",\"prompt\":\"请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\\n\\n${工单内容}\"}",
                1,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE
        );

        ensureBuiltInAgent(
                "tracking-query",
                "物流查询",
                "通过 17track Shadow Window 查询物流信息",
                ProviderType.WEB_AUTOMATION,
                ExecutionEnv.CLIENT_ONLY,
                "tracking",
                "logistics",
                CallMode.MQ,
                null,
                "{\"windowLabel\":\"tracking_shadow\"}",
                2,
                TRACKING_INPUT_SCHEMA,
                TRACKING_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE
        );

        ensureBuiltInAgent(
                "antigravity-translate",
                "Antigravity 翻译",
                "通过 Antigravity (OpenAI 兼容 API) 翻译工单内容",
                ProviderType.HTTP_API,
                ExecutionEnv.BOTH,
                "translation",
                "ticket",
                CallMode.HTTP,
                "http://localhost:8045/v1",
                "{\"baseUrl\":\"http://localhost:8045/v1\",\"model\":\"gemini-2.5-flash\",\"apiKey\":\"\",\"maxTokens\":8192,\"systemPrompt\":\"You are a professional translator. Translate the given customer support ticket content to the target language.\\n\\nIMPORTANT: You MUST respond with a valid JSON object in the following exact format:\\n{\\n  \\\"subject\\\": \\\"translated ticket subject\\\",\\n  \\\"descriptionText\\\": \\\"translated description\\\",\\n  \\\"conversations\\\": [\\n    {\\n      \\\"id\\\": original_id,\\n      \\\"bodyText\\\": \\\"translated conversation text\\\",\\n      \\\"userId\\\": original_userId,\\n      \\\"createdAt\\\": \\\"original_createdAt\\\",\\n      \\\"incoming\\\": original_incoming,\\n      \\\"isPrivate\\\": original_isPrivate\\n    }\\n  ]\\n}\\n\\nRules:\\n1. Preserve ALL original field values (id, userId, createdAt, incoming, isPrivate) exactly as provided.\\n2. Only translate the text content fields: subject, descriptionText, and each conversation's bodyText.\\n3. Maintain the same number of conversations in the same order.\\n4. Return ONLY the JSON object, no additional text or markdown.\"}",
                3,
                TRANSLATE_INPUT_SCHEMA,
                TRANSLATE_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE
        );

        // 初始化默认能力绑定（仅在绑定表为空时创建，不覆盖用户手动配置）
        ensureDefaultBinding("translation", "gemini-translate");
        ensureDefaultBinding("reply", "notebooklm-reply");
        ensureDefaultBinding("tracking", "tracking-query");
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
                                     String providerConfig, int sortOrder,
                                     String inputSchema, String outputSchema, String templateEngine) {
        var existing = repository.findByCode(code);
        if (existing.isPresent()) {
            // Backfill fields for existing agents if null
            AgentDefinition def = existing.get();
            boolean updated = false;

            if (def.getInputSchema() == null && inputSchema != null) {
                def.setInputSchema(inputSchema);
                updated = true;
            }
            if (def.getOutputSchema() == null && outputSchema != null) {
                def.setOutputSchema(outputSchema);
                updated = true;
            }
            if (def.getTemplateEngine() == null && templateEngine != null) {
                def.setTemplateEngine(templateEngine);
                updated = true;
            }
            if (def.getGroupCode() == null && groupCode != null) {
                def.setGroupCode(groupCode);
                updated = true;
            }

            // Backfill callMode and callUrl
            if (def.getCallMode() == null && callMode != null) {
                def.setCallMode(callMode);
                updated = true;
            }
            if (def.getCallUrl() == null && callUrl != null) {
                def.setCallUrl(callUrl);
                updated = true;
            }

            // Migrate deprecated providerType values
            if (def.getProviderType() == ProviderType.LOCAL_CLI) {
                def.setProviderType(ProviderType.GEMINI_CLI);
                updated = true;
                log.info("[AiDataInitializer] Migrated agent {} providerType: LOCAL_CLI -> GEMINI_CLI", code);
            }
            if (def.getProviderType() == ProviderType.SHADOW_WINDOW) {
                def.setProviderType(ProviderType.WEB_AUTOMATION);
                updated = true;
                log.info("[AiDataInitializer] Migrated agent {} providerType: SHADOW_WINDOW -> WEB_AUTOMATION", code);
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
        def.setProviderType(providerType);
        def.setExecutionEnv(executionEnv);
        def.setCapability(capability);
        def.setGroupCode(groupCode);
        def.setCallMode(callMode);
        def.setCallUrl(callUrl);
        def.setProviderConfig(providerConfig);
        def.setInputSchema(inputSchema);
        def.setOutputSchema(outputSchema);
        def.setTemplateEngine(templateEngine);
        def.setEnabled(true);
        def.setBuiltIn(true);
        def.setSortOrder(sortOrder);

        repository.save(def);
        log.info("[AiDataInitializer] Created built-in agent: {}", code);
    }
}
