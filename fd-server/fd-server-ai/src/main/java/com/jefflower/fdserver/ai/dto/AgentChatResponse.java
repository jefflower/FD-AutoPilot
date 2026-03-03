package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AgentChatResponse {

    /** AI 输出内容 */
    private String output;

    /** 是否成功 */
    private boolean success;

    /** 错误消息（仅失败时有值） */
    private String errorMessage;
}
