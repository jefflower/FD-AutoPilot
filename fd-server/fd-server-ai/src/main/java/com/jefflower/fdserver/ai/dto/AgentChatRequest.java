package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AgentChatRequest {

    /** 用户消息 */
    private String userMessage;

    /** 对话历史 */
    private List<ChatMessage> conversationHistory;

    /** 上下文数据（模板变量 → 值） */
    private Map<String, String> contextData;

    /** 关联业务类型 */
    private String refType;

    /** 关联业务 ID */
    private Long refId;

    /** 要使用的 Agent code（可选，由控制器决定默认值） */
    private String agentCode;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatMessage {
        private String role; // "user" / "assistant"
        private String content;
    }
}
