package com.jefflower.fdserver.ai.config;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
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

    public AiDataInitializer(AgentDefinitionRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public void run(String... args) {
        ensureBuiltInAgent(
                "gemini-translate",
                "Gemini CLI 翻译",
                "通过 Gemini CLI 翻译工单内容",
                ProviderType.LOCAL_CLI,
                ExecutionEnv.CLIENT_ONLY,
                "translation",
                "{\"invokeCommand\":\"execute_gemini_cmd\",\"models\":[\"gemini-2.5-flash\"],\"timeout\":120,\"systemPrompt\":\"You are a professional customer support translator. Translate the following support ticket into ${TARGET_LANG}.\\n\\nCRITICAL INSTRUCTIONS:\\n1. Response must be ONLY a valid JSON object.\\n2. Do NOT include any intro, outro, explanations, or markdown blocks (like ```json).\\n3. You MUST translate BOTH the subject/description AND EVERY item in the 'conversations' list.\\n4. Maintain the original 'id' for each conversation item.\\n5. Ensure the content is ONLY in ${TARGET_LANG} - DO NOT output in English if the target is ${TARGET_LANG}.\\n6. JSON Structure Example:\\n{\\n  \\\"subject\\\": \\\"翻译后的标题\\\",\\n  \\\"description_text\\\": \\\"翻译后的正文内容\\\",\\n  \\\"conversations\\\": [\\n    {\\\"id\\\": 123, \\\"body_text\\\": \\\"翻译后的对话消息\\\"}\\n  ]\\n}\\n\\n${TICKET_CONTENT}\"}",
                0
        );

        ensureBuiltInAgent(
                "notebooklm-reply",
                "NotebookLM 回复",
                "通过 NotebookLM Shadow Window 生成工单回复",
                ProviderType.SHADOW_WINDOW,
                ExecutionEnv.CLIENT_ONLY,
                "reply",
                "{\"windowLabel\":\"notebook_shadow\",\"notebookId\":\"\",\"notebookUrl\":\"\",\"prompt\":\"请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\\n\\n${工单内容}\"}",
                1
        );

        ensureBuiltInAgent(
                "tracking-query",
                "物流查询",
                "通过 17track Shadow Window 查询物流信息",
                ProviderType.SHADOW_WINDOW,
                ExecutionEnv.CLIENT_ONLY,
                "tracking",
                "{\"windowLabel\":\"tracking_shadow\"}",
                2
        );

        ensureBuiltInAgent(
                "antigravity-translate",
                "Antigravity 翻译",
                "通过 Antigravity (OpenAI 兼容 API) 翻译工单内容",
                ProviderType.HTTP_API,
                ExecutionEnv.BOTH,
                "translation",
                "{\"baseUrl\":\"http://localhost:8045/v1\",\"model\":\"gemini-2.5-flash\",\"apiKey\":\"\",\"maxTokens\":8192,\"systemPrompt\":\"You are a professional translator. Translate the given customer support ticket content to the target language.\\n\\nIMPORTANT: You MUST respond with a valid JSON object in the following exact format:\\n{\\n  \\\"subject\\\": \\\"translated ticket subject\\\",\\n  \\\"descriptionText\\\": \\\"translated description\\\",\\n  \\\"conversations\\\": [\\n    {\\n      \\\"id\\\": original_id,\\n      \\\"bodyText\\\": \\\"translated conversation text\\\",\\n      \\\"userId\\\": original_userId,\\n      \\\"createdAt\\\": \\\"original_createdAt\\\",\\n      \\\"incoming\\\": original_incoming,\\n      \\\"isPrivate\\\": original_isPrivate\\n    }\\n  ]\\n}\\n\\nRules:\\n1. Preserve ALL original field values (id, userId, createdAt, incoming, isPrivate) exactly as provided.\\n2. Only translate the text content fields: subject, descriptionText, and each conversation's bodyText.\\n3. Maintain the same number of conversations in the same order.\\n4. Return ONLY the JSON object, no additional text or markdown.\"}",
                3
        );
    }

    private void ensureBuiltInAgent(String code, String name, String description,
                                     ProviderType providerType, ExecutionEnv executionEnv,
                                     String capability, String providerConfig, int sortOrder) {
        if (repository.existsByCode(code)) {
            return;
        }

        AgentDefinition def = new AgentDefinition();
        def.setCode(code);
        def.setName(name);
        def.setDescription(description);
        def.setProviderType(providerType);
        def.setExecutionEnv(executionEnv);
        def.setCapability(capability);
        def.setProviderConfig(providerConfig);
        def.setEnabled(true);
        def.setBuiltIn(true);
        def.setSortOrder(sortOrder);

        repository.save(def);
        log.info("[AiDataInitializer] Created built-in agent: {}", code);
    }
}
