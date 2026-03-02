package com.jefflower.fdserver.ai.enums;

public enum ProviderType {
    GEMINI_CLI,          // Gemini CLI 调用
    CLAUDE_CLI,          // Claude CLI 调用
    HTTP_API,            // 通用 HTTP API（OpenAI 兼容等）
    NOTEBOOKLM,          // NotebookLM Shadow Window
    NOTEBOOKLM_PY,       // NotebookLM Python 库（notebooklm-py）
    TRACKING_SHADOW,     // 物流查询 Shadow Window（17track 等）
    LOCAL_FUNCTION,      // 本地函数

    // --- 以下为保留的旧值（向后兼容） ---
    @Deprecated LOCAL_CLI,         // → GEMINI_CLI
    @Deprecated SHADOW_WINDOW,     // → NOTEBOOKLM / TRACKING_SHADOW
    @Deprecated WEB_AUTOMATION     // → NOTEBOOKLM / TRACKING_SHADOW
}
