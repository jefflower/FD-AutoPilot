package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Map;

/**
 * Capability 级执行请求 DTO。
 * 由 n8n 工作流通过 /api/v1/n8n/capabilities/{capability}/execute 端点传入。
 */
@Getter
@Setter
@NoArgsConstructor
public class CapabilityExecuteRequest {

    /** Agent 执行输入 */
    private Map<String, Object> input;

    /** 关联业务类型，默认 "n8n" */
    private String refType = "n8n";

    /** 关联业务 ID */
    private String refId;

    /** 超时时间（毫秒），为 null 时使用默认值 */
    private Long timeoutMs;

    /** 指定目标客户端 ID（路由过滤） */
    private String targetClientId;

    /** 指定目标用户 ID（路由过滤） */
    private String targetUserId;
}
