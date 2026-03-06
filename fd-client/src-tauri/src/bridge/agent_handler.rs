//! Agent execution HTTP handlers.
//!
//! Handlers for Gemini CLI, NotebookLM-py, translate, and sync-translate endpoints.

use axum::extract::{Json, State};
use axum::http::StatusCode;

use crate::ai::{ClaudeClient, GeminiClient, StderrLogger};
use crate::antigravity::AntiGravityClient;
use crate::execution_log::ExecLogEntry;

use super::types::*;
use super::LogState;

pub async fn translate_handler(
    State(state): State<LogState>,
    Json(req): Json<TranslateRequest>,
) -> TicketResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/translate: subject={}",
        req.ticket.subject.as_deref().unwrap_or("(none)")
    );

    let start = std::time::Instant::now();
    let input_json = serde_json::json!({
        "ticketId": req.ticket.id,
        "subject": req.ticket.subject,
        "targetLang": req.target_lang,
        "systemPrompt": req.system_prompt.as_deref().unwrap_or("(default)"),
        "conversationCount": req.ticket.conversations.len(),
        "descriptionLength": req.ticket.description_text.as_deref().map(|s| s.len()).unwrap_or(0),
    })
    .to_string();

    let logger = StderrLogger;
    let result = GeminiClient::translate_ticket(
        &logger,
        &req.ticket,
        &req.target_lang,
        req.system_prompt.as_deref(),
    )
    .await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: "ticket-translate".to_string(),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "gemini translate ticket#{}",
            req.ticket.id
        )),
        input_params: Some(input_json),
        prompt_full: req.system_prompt.clone(),
        stdout: result
            .as_ref()
            .ok()
            .and_then(|t| serde_json::to_string(t).ok()),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type: Some("ticket".to_string()),
        ref_id: Some(req.ticket.id.to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert translate log: {}", e);
    }

    match result {
        Ok(ticket) => (StatusCode::OK, Json(ok_response(ticket))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn gemini_handler(
    State(state): State<LogState>,
    Json(req): Json<GeminiRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/gemini: prompt_len={}, models={:?}",
        req.prompt.len(),
        req.models
    );

    let start = std::time::Instant::now();

    let ref_type = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ref_id = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refId"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });

    let input_json = serde_json::json!({
        "metadata": req.metadata,
        "promptLength": req.prompt.len(),
        "promptPreview": &req.prompt[..req.prompt.char_indices().take_while(|&(i, _)| i < 500).last().map_or(0, |(i, c)| i + c.len_utf8())],
        "models": req.models,
    })
    .to_string();

    let logger = StderrLogger;
    let result = GeminiClient::execute_gemini(&logger, &req.prompt, &req.models).await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: req.agent_code.clone().unwrap_or_else(|| "gemini-cli".to_string()),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "gemini (prompt: {} chars, models: {:?})",
            req.prompt.len(),
            req.models
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.prompt.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type,
        ref_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert gemini log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn claude_handler(
    State(state): State<LogState>,
    Json(req): Json<ClaudeRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/claude: prompt_len={}",
        req.prompt.len(),
    );

    let start = std::time::Instant::now();

    let ref_type = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ref_id = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refId"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });

    let input_json = serde_json::json!({
        "metadata": req.metadata,
        "promptLength": req.prompt.len(),
        "promptPreview": &req.prompt[..req.prompt.char_indices().take_while(|&(i, _)| i < 500).last().map_or(0, |(i, c)| i + c.len_utf8())],
    })
    .to_string();

    let logger = StderrLogger;
    let result = ClaudeClient::execute_claude(&logger, &req.prompt).await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: req.agent_code.clone().unwrap_or_else(|| "claude-cli".to_string()),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "claude (prompt: {} chars)",
            req.prompt.len(),
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.prompt.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type,
        ref_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert claude log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn sync_translate_handler(
    State(state): State<LogState>,
    Json(req): Json<SyncTranslateRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/sync-translate: direction={}, targetLang={}",
        req.direction, req.target_lang
    );

    let start = std::time::Instant::now();
    let input_json = serde_json::json!({
        "sourceTextLength": req.source_text.len(),
        "referenceTextLength": req.reference_text.len(),
        "direction": req.direction,
        "targetLang": req.target_lang,
    })
    .to_string();

    let logger = StderrLogger;
    let result = GeminiClient::sync_translate_reply(
        &logger,
        &req.source_text,
        &req.reference_text,
        &req.direction,
        &req.target_lang,
    )
    .await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: "sync-translate".to_string(),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "gemini sync-translate {} -> {}",
            req.direction, req.target_lang
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.source_text.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type: None,
        ref_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert sync-translate log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn notebooklm_py_handler(
    State(state): State<LogState>,
    Json(req): Json<NotebookLmPyRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/notebooklm-py: query_len={}, notebook_id={}",
        req.query.len(),
        if req.notebook_id.is_empty() {
            "(default)"
        } else {
            &req.notebook_id
        }
    );

    let start = std::time::Instant::now();
    let input_json = serde_json::json!({
        "queryLength": req.query.len(),
        "queryPreview": &req.query[..req.query.char_indices().take_while(|&(i, _)| i < 500).last().map_or(0, |(i, c)| i + c.len_utf8())],
        "notebookId": req.notebook_id,
    })
    .to_string();

    let result = crate::ai::execute_notebooklm_py(&req.query, &req.notebook_id).await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: req.agent_code.clone().unwrap_or_else(|| "ticket-reply".to_string()),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "python3 notebooklm-py (query: {} chars, notebook: {})",
            req.query.len(),
            if req.notebook_id.is_empty() {
                "default"
            } else {
                &req.notebook_id
            }
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.query.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type: None,
        ref_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert notebooklm-py log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn notebooklm_rag_handler(
    State(state): State<LogState>,
    Json(req): Json<NotebookLmRagRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/notebooklm-rag: query_len={}, source_len={}, notebook_id={}",
        req.query.len(),
        req.source_content.len(),
        if req.notebook_id.is_empty() { "(empty)" } else { &req.notebook_id }
    );

    let start = std::time::Instant::now();
    let input_json = serde_json::json!({
        "queryLength": req.query.len(),
        "sourceContentLength": req.source_content.len(),
        "notebookId": req.notebook_id,
    })
    .to_string();

    let result = crate::ai::execute_notebooklm_rag(&req.query, &req.source_content, &req.notebook_id).await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: req.agent_code.clone().unwrap_or_else(|| "notebooklm-rag".to_string()),
        status: if result.is_ok() { "success" } else { "failed" }.to_string(),
        command: Some(format!(
            "notebooklm-rag (query: {} chars, source: {} chars)",
            req.query.len(),
            req.source_content.len()
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.source_content.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type: None,
        ref_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert notebooklm-rag log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn notebooklm_cli_handler(
    State(state): State<LogState>,
    Json(mut req): Json<NotebookLmCliRequest>,
) -> JsonResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/notebooklm-cli: action={}",
        req.action
    );

    let start = std::time::Instant::now();

    // add-source: 如果 contentOrPath 是原始内容（非文件路径/URL），写入临时文件
    let mut temp_file_path: Option<std::path::PathBuf> = None;
    if req.action == "add-source" {
        if let Some(content) = &req.content_or_path {
            let is_url = content.starts_with("http://") || content.starts_with("https://");
            let is_file = !is_url && std::path::Path::new(content).exists();
            if !is_url && !is_file {
                // 原始内容 → 写入临时文件（用标题命名，NotebookLM 以文件名作为源标题）
                let ext = req.source_type.as_deref().unwrap_or("txt");
                let temp_dir = std::env::temp_dir().join("fd-bridge-sources");
                let _ = std::fs::create_dir_all(&temp_dir);
                let base_name = req.title.as_deref().unwrap_or("source");
                // 如果标题已有扩展名则直接使用，否则追加
                let file_name = if base_name.contains('.') {
                    base_name.to_string()
                } else {
                    format!("{}.{}", base_name, ext)
                };
                let file_path = temp_dir.join(&file_name);
                match std::fs::write(&file_path, content.as_bytes()) {
                    Ok(_) => {
                        rlog_info!(
                            "[fd-bridge] add-source: wrote {} bytes to temp file {:?}",
                            content.len(),
                            file_path
                        );
                        req.content_or_path = Some(file_path.to_string_lossy().to_string());
                        temp_file_path = Some(file_path);
                    }
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(BridgeResponse {
                                success: false,
                                data: None,
                                error: Some(format!("Failed to write temp file: {}", e)),
                            }),
                        );
                    }
                }
            }
        }
    }

    // 根据 action 构建 CLI 参数
    let args_result = build_notebooklm_cli_args(&req);
    let args = match args_result {
        Ok(a) => a,
        Err(e) => {
            // 清理临时文件
            if let Some(ref path) = temp_file_path {
                let _ = std::fs::remove_file(path);
            }
            return (
                StatusCode::BAD_REQUEST,
                Json(BridgeResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                }),
            );
        }
    };

    // 执行 CLI（超时根据 action 不同）
    let timeout_secs = match req.action.as_str() {
        "add-source" => 120,
        "source-fulltext" => 60,
        _ => 30,
    };

    let result = crate::ai::execute_notebooklm_cli(args, timeout_secs).await;

    // 清理临时文件
    if let Some(ref path) = temp_file_path {
        if let Err(e) = std::fs::remove_file(path) {
            rlog_warn!("[fd-bridge] Failed to clean up temp file {:?}: {}", path, e);
        }
    }
    let duration = start.elapsed().as_millis() as i64;

    // 记录执行日志
    let entry = ExecLogEntry {
        id: None,
        agent_code: "notebooklm-cli".to_string(),
        status: if result.is_ok() { "success" } else { "failed" }.to_string(),
        command: Some(format!("notebooklm {}", req.action)),
        input_params: Some(serde_json::json!({
            "action": req.action,
            "notebookId": req.notebook_id,
            "sourceId": req.source_id,
        }).to_string()),
        prompt_full: None,
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type: Some("knowledge".to_string()),
        ref_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert notebooklm-cli log: {}", e);
    }

    match result {
        Ok(output) => {
            // 尝试解析为 JSON，如果失败则包装为字符串
            let json_value = serde_json::from_str::<serde_json::Value>(&output)
                .unwrap_or_else(|_| serde_json::Value::String(output));
            (
                StatusCode::OK,
                Json(BridgeResponse {
                    success: true,
                    data: Some(json_value),
                    error: None,
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(BridgeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

pub async fn antigravity_handler(
    State(state): State<LogState>,
    Json(req): Json<AntiGravityRequest>,
) -> StringResult {
    rlog_info!(
        "[fd-bridge] POST /bridge/antigravity: prompt_len={}, model={}",
        req.prompt.len(),
        req.model,
    );

    let start = std::time::Instant::now();

    let ref_type = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ref_id = req
        .metadata
        .as_ref()
        .and_then(|m| m.get("refId"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });

    let input_json = serde_json::json!({
        "metadata": req.metadata,
        "promptLength": req.prompt.len(),
        "promptPreview": &req.prompt[..req.prompt.char_indices().take_while(|&(i, _)| i < 500).last().map_or(0, |(i, c)| i + c.len_utf8())],
        "model": req.model,
        "temperature": req.temperature,
    })
    .to_string();

    let result = AntiGravityClient::chat(
        &req.prompt,
        &req.model,
        req.system_prompt.as_deref(),
        req.temperature,
    )
    .await;

    let duration = start.elapsed().as_millis() as i64;

    let entry = ExecLogEntry {
        id: None,
        agent_code: req
            .agent_code
            .clone()
            .unwrap_or_else(|| "antigravity-tools".to_string()),
        status: if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        command: Some(format!(
            "antigravity (model: {}, prompt: {} chars)",
            req.model,
            req.prompt.len()
        )),
        input_params: Some(input_json),
        prompt_full: Some(req.prompt.clone()),
        stdout: result.as_ref().ok().cloned(),
        stderr: None,
        error_msg: result.as_ref().err().cloned(),
        duration_ms: Some(duration),
        ref_type,
        ref_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = state.log_store.insert(&entry) {
        rlog_error!("[ExecLog] Failed to insert antigravity log: {}", e);
    }

    match result {
        Ok(output) => (StatusCode::OK, Json(ok_response(output))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

/// 根据 action 构建 notebooklm CLI 参数
pub fn build_notebooklm_cli_args(req: &NotebookLmCliRequest) -> Result<Vec<String>, String> {
    match req.action.as_str() {
        "list-notebooks" => {
            Ok(vec!["list".to_string(), "--json".to_string()])
        }
        "list-sources" => {
            let notebook_id = req.notebook_id.as_deref()
                .ok_or("notebookId is required for list-sources")?;
            Ok(vec![
                "source".to_string(), "list".to_string(),
                "-n".to_string(), notebook_id.to_string(),
                "--json".to_string(),
            ])
        }
        "add-source" => {
            let notebook_id = req.notebook_id.as_deref()
                .ok_or("notebookId is required for add-source")?;
            let content = req.content_or_path.as_deref()
                .ok_or("contentOrPath is required for add-source")?;
            let mut args = vec![
                "source".to_string(), "add".to_string(),
                content.to_string(),
                "-n".to_string(), notebook_id.to_string(),
            ];
            if let Some(title) = &req.title {
                args.push("--title".to_string());
                args.push(title.clone());
            }
            args.push("--json".to_string());
            Ok(args)
        }
        "delete-source" => {
            let notebook_id = req.notebook_id.as_deref()
                .ok_or("notebookId is required for delete-source")?;
            let source_id = req.source_id.as_deref()
                .ok_or("sourceId is required for delete-source")?;
            Ok(vec![
                "source".to_string(), "delete".to_string(),
                source_id.to_string(),
                "-n".to_string(), notebook_id.to_string(),
                "-y".to_string(),
            ])
        }
        "source-fulltext" => {
            let notebook_id = req.notebook_id.as_deref()
                .ok_or("notebookId is required for source-fulltext")?;
            let source_id = req.source_id.as_deref()
                .ok_or("sourceId is required for source-fulltext")?;
            Ok(vec![
                "source".to_string(), "fulltext".to_string(),
                source_id.to_string(),
                "-n".to_string(), notebook_id.to_string(),
                "--json".to_string(),
            ])
        }
        _ => Err(format!("Unknown action: {}", req.action)),
    }
}
