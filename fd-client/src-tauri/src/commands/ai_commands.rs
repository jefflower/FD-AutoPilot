//! AI-related Tauri commands.
//!
//! Gemini CLI translation/execution, Claude CLI execution, NotebookLM-py, and sync-translate commands.
//! Each command writes an execution log entry to the shared ExecLogStore.

use std::sync::Arc;

use crate::ai::{ClaudeClient, GeminiClient, TauriLogger};
use crate::antigravity::AntiGravityClient;
use crate::execution_log::{ExecLogEntry, ExecLogStore};
use tauri::AppHandle;

/// Helper: write an execution log entry, swallowing errors (logging should never break execution).
fn write_log(
    log_store: &Arc<ExecLogStore>,
    agent_code: &str,
    command_desc: &str,
    input_params: Option<String>,
    result: &Result<String, String>,
    duration_ms: i64,
) {
    let (status, stdout, error_msg) = match result {
        Ok(output) => ("success", Some(output.clone()), None),
        Err(err) => ("failed", None, Some(err.clone())),
    };

    let entry = ExecLogEntry {
        id: None,
        agent_code: agent_code.to_string(),
        status: status.to_string(),
        command: Some(command_desc.to_string()),
        input_params,
        prompt_full: None,
        stdout,
        stderr: None,
        error_msg,
        duration_ms: Some(duration_ms),
        ref_type: None,
        ref_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    if let Err(e) = log_store.insert(&entry) {
        eprintln!("[ExecLog] Failed to insert {} log: {}", agent_code, e);
    }
}

#[tauri::command]
pub async fn translate_ticket_direct_cmd(
    app: AppHandle,
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    ticket: crate::models::Ticket,
    target_lang: String,
    system_prompt: Option<String>,
) -> Result<crate::models::Ticket, String> {
    let start = std::time::Instant::now();
    let logger = TauriLogger { app: &app };
    let result =
        GeminiClient::translate_ticket(&logger, &ticket, &target_lang, system_prompt.as_deref())
            .await;
    let duration_ms = start.elapsed().as_millis() as i64;

    // 日志：translate 特殊处理（返回 Ticket 而非 String）
    let input_json = serde_json::json!({
        "targetLang": target_lang,
        "promptLength": system_prompt.as_ref().map(|p| p.len()).unwrap_or(0),
    })
    .to_string();

    let str_result = match &result {
        Ok(_) => Ok("translate success".to_string()),
        Err(e) => Err(e.clone()),
    };
    write_log(
        &log_store,
        "ticket-translate",
        &format!("translate_ticket (target: {})", target_lang),
        Some(input_json),
        &str_result,
        duration_ms,
    );

    result
}

#[tauri::command]
pub async fn execute_gemini_cmd(
    app: AppHandle,
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    prompt: String,
    models: Vec<String>,
    agent_code: Option<String>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let logger = TauriLogger { app: &app };
    let result = GeminiClient::execute_gemini(&logger, &prompt, &models).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let code = agent_code.as_deref().unwrap_or("gemini-cli");
    let input_json = serde_json::json!({
        "promptLength": prompt.len(),
        "models": models,
    })
    .to_string();

    write_log(
        &log_store,
        code,
        &format!("gemini (prompt: {} chars, models: {:?})", prompt.len(), models),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}

#[tauri::command]
pub async fn execute_claude_cmd(
    app: AppHandle,
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    prompt: String,
    agent_code: Option<String>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let logger = TauriLogger { app: &app };
    let result = ClaudeClient::execute_claude(&logger, &prompt).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let code = agent_code.as_deref().unwrap_or("claude-cli");
    let input_json = serde_json::json!({
        "promptLength": prompt.len(),
    })
    .to_string();

    write_log(
        &log_store,
        code,
        &format!("claude (prompt: {} chars)", prompt.len()),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}

#[tauri::command]
pub async fn execute_notebooklm_py_cmd(
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    query: String,
    notebook_id: String,
    agent_code: Option<String>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let result = crate::ai::execute_notebooklm_py(&query, &notebook_id).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let code = agent_code.as_deref().unwrap_or("notebooklm-py");
    let input_json = serde_json::json!({
        "queryLength": query.len(),
        "notebookId": notebook_id,
    })
    .to_string();

    write_log(
        &log_store,
        code,
        &format!("notebooklm-py (query: {} chars, notebook: {})", query.len(), notebook_id),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}

#[tauri::command]
pub async fn execute_notebooklm_rag_cmd(
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    query: String,
    source_content: String,
    notebook_id: String,
    agent_code: Option<String>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let result = crate::ai::execute_notebooklm_rag(&query, &source_content, &notebook_id).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let code = agent_code.as_deref().unwrap_or("notebooklm-rag");
    let input_json = serde_json::json!({
        "queryLength": query.len(),
        "sourceContentLength": source_content.len(),
        "notebookId": notebook_id,
    })
    .to_string();

    write_log(
        &log_store,
        code,
        &format!("notebooklm-rag (query: {} chars, source: {} chars, notebook: {})", query.len(), source_content.len(), notebook_id),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}

/// NotebookLM CLI 通用命令（Tauri IPC 模式）
/// 前端传入 action + 可选参数，内部委托给 bridge 的 notebooklm_cli_handler 同款逻辑
#[tauri::command]
pub async fn execute_notebooklm_cli_cmd(
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    action: String,
    notebook_id: Option<String>,
    source_id: Option<String>,
    content_or_path: Option<String>,
    source_type: Option<String>,
    title: Option<String>,
) -> Result<serde_json::Value, String> {
    use crate::bridge::agent_handler::build_notebooklm_cli_args;
    use crate::bridge::types::NotebookLmCliRequest;

    let start = std::time::Instant::now();

    // 构建请求（复用 bridge 的参数构建逻辑）
    let mut req = NotebookLmCliRequest {
        action: action.clone(),
        notebook_id,
        source_id,
        content_or_path,
        source_type,
        title,
    };

    // add-source: 如果内容是原始文本（非文件/URL），写入临时文件
    let mut temp_file_path: Option<std::path::PathBuf> = None;
    if req.action == "add-source" {
        if let Some(content) = &req.content_or_path {
            let is_url = content.starts_with("http://") || content.starts_with("https://");
            let is_file = !is_url && std::path::Path::new(content).exists();
            if !is_url && !is_file {
                let ext = req.source_type.as_deref().unwrap_or("txt");
                let temp_dir = std::env::temp_dir().join("fd-bridge-sources");
                let _ = std::fs::create_dir_all(&temp_dir);
                let base_name = req.title.as_deref().unwrap_or("source");
                let file_name = if base_name.contains('.') {
                    base_name.to_string()
                } else {
                    format!("{}.{}", base_name, ext)
                };
                let file_path = temp_dir.join(&file_name);
                std::fs::write(&file_path, content.as_bytes())
                    .map_err(|e| format!("Failed to write temp file: {}", e))?;
                req.content_or_path = Some(file_path.to_string_lossy().to_string());
                temp_file_path = Some(file_path);
            }
        }
    }

    let args = build_notebooklm_cli_args(&req)
        .map_err(|e| format!("参数构建失败: {}", e))?;

    let timeout_secs = match req.action.as_str() {
        "add-source" => 120,
        "source-fulltext" => 60,
        _ => 30,
    };

    let result = crate::ai::execute_notebooklm_cli(args, timeout_secs).await;

    // 清理临时文件
    if let Some(ref path) = temp_file_path {
        let _ = std::fs::remove_file(path);
    }

    let duration_ms = start.elapsed().as_millis() as i64;

    let input_json = serde_json::json!({
        "action": action,
        "notebookId": req.notebook_id,
        "sourceId": req.source_id,
    }).to_string();

    write_log(
        &log_store,
        "notebooklm-cli",
        &format!("notebooklm {}", action),
        Some(input_json),
        &result,
        duration_ms,
    );

    match result {
        Ok(output) => {
            // 尝试解析为 JSON
            serde_json::from_str::<serde_json::Value>(&output)
                .or_else(|_| Ok(serde_json::Value::String(output)))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn execute_antigravity_cmd(
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    prompt: String,
    model: String,
    agent_code: Option<String>,
    system_prompt: Option<String>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let result = AntiGravityClient::chat(
        &prompt,
        &model,
        system_prompt.as_deref(),
        temperature,
    )
    .await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let code = agent_code.as_deref().unwrap_or("antigravity-tools");
    let input_json = serde_json::json!({
        "promptLength": prompt.len(),
        "model": model,
        "hasSystemPrompt": system_prompt.is_some(),
        "temperature": temperature,
    })
    .to_string();

    write_log(
        &log_store,
        code,
        &format!("antigravity (model: {}, prompt: {} chars)", model, prompt.len()),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}

#[tauri::command]
pub async fn sync_translate_reply_cmd(
    app: AppHandle,
    log_store: tauri::State<'_, Arc<ExecLogStore>>,
    source_text: String,
    reference_text: String,
    direction: String,
    target_lang: String,
) -> Result<String, String> {
    let start = std::time::Instant::now();
    let logger = TauriLogger { app: &app };
    let result = GeminiClient::sync_translate_reply(
        &logger,
        &source_text,
        &reference_text,
        &direction,
        &target_lang,
    )
    .await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let input_json = serde_json::json!({
        "sourceLength": source_text.len(),
        "referenceLength": reference_text.len(),
        "direction": direction,
        "targetLang": target_lang,
    })
    .to_string();

    write_log(
        &log_store,
        "sync-translate-reply",
        &format!("sync-translate-reply ({} → {})", direction, target_lang),
        Some(input_json),
        &result,
        duration_ms,
    );

    result
}
