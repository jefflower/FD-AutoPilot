package com.jefflower.fdserver.ai.enums;

public enum ProviderType {
    GEMINI_CLI,      // Gemini CLI 调用
    HTTP_API,        // 通用 HTTP API（OpenAI 兼容等）
    WEB_AUTOMATION,  // 网页自动化（Shadow Window）
    LOCAL_FUNCTION,  // 本地函数

    // --- 以下为保留的旧值（向后兼容） ---
    @Deprecated LOCAL_CLI,       // 已更名为 GEMINI_CLI
    @Deprecated SHADOW_WINDOW    // 已更名为 WEB_AUTOMATION
}
