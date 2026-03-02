package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Agent 配置三级合并器。
 * <p>
 * 优先级：runtimeParams (最高) > instance.localConfig > definition.agentConfig (最低)
 */
@Component
public class AgentConfigMerger {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 三级配置合并。
     *
     * @param def           Agent 定义（基础配置来源）
     * @param instance      Agent 实例（可为 null，跳过 localConfig 层）
     * @param runtimeParams 运行时参数（最高优先级，可为 null）
     * @return 合并后的配置 Map
     */
    public Map<String, Object> merge(AgentDefinition def, AgentInstance instance, Map<String, Object> runtimeParams) {
        Map<String, Object> merged = new LinkedHashMap<>();

        // 注入独立字段 systemPrompt 作为基础（优先级最低）
        if (def.getSystemPrompt() != null) {
            merged.put("systemPrompt", def.getSystemPrompt());
        }

        // 基础层：definition.agentConfig（会覆盖 systemPrompt 如果有的话）
        if (def.getAgentConfig() != null) {
            merged.putAll(parseJson(def.getAgentConfig()));
        }

        // 覆盖层：instance.localConfig
        if (instance != null && instance.getLocalConfig() != null) {
            merged.putAll(parseJson(instance.getLocalConfig()));
        }

        // 最高优先级：runtimeParams
        if (runtimeParams != null) {
            merged.putAll(runtimeParams);
        }

        return merged;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }
}
