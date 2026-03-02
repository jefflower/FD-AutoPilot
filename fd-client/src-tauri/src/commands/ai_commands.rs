//! AI-related Tauri commands.
//!
//! Gemini CLI translation/execution, Claude CLI execution, NotebookLM-py, and sync-translate commands.

use crate::ai::{ClaudeClient, GeminiClient, TauriLogger};
use tauri::AppHandle;

#[tauri::command]
pub async fn translate_ticket_direct_cmd(
    app: AppHandle,
    ticket: crate::models::Ticket,
    target_lang: String,
    system_prompt: Option<String>,
) -> Result<crate::models::Ticket, String> {
    let logger = TauriLogger { app: &app };
    GeminiClient::translate_ticket(&logger, &ticket, &target_lang, system_prompt.as_deref()).await
}

#[tauri::command]
pub async fn execute_gemini_cmd(
    app: AppHandle,
    prompt: String,
    models: Vec<String>,
) -> Result<String, String> {
    let logger = TauriLogger { app: &app };
    GeminiClient::execute_gemini(&logger, &prompt, &models).await
}

#[tauri::command]
pub async fn execute_claude_cmd(
    app: AppHandle,
    prompt: String,
) -> Result<String, String> {
    let logger = TauriLogger { app: &app };
    ClaudeClient::execute_claude(&logger, &prompt).await
}

#[tauri::command]
pub async fn execute_notebooklm_py_cmd(
    query: String,
    notebook_id: String,
) -> Result<String, String> {
    crate::ai::execute_notebooklm_py(&query, &notebook_id).await
}

#[tauri::command]
pub async fn sync_translate_reply_cmd(
    app: AppHandle,
    source_text: String,
    reference_text: String,
    direction: String,
    target_lang: String,
) -> Result<String, String> {
    let logger = TauriLogger { app: &app };
    GeminiClient::sync_translate_reply(
        &logger,
        &source_text,
        &reference_text,
        &direction,
        &target_lang,
    )
    .await
}
