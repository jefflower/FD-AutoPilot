use crate::models::Ticket;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tokio::time::{timeout, Duration};

/// 日志抽象 trait，让核心 AI 函数不依赖 Tauri AppHandle
pub trait GeminiLogger: Send + Sync {
    fn log(&self, msg: &str);
}

/// Tauri 环境下的日志实现（IPC + stderr）
#[cfg(feature = "tauri-app")]
pub struct TauriLogger<'a> {
    pub app: &'a tauri::AppHandle,
}

#[cfg(feature = "tauri-app")]
impl GeminiLogger for TauriLogger<'_> {
    fn log(&self, msg: &str) {
        rlog_info!("[AI] {}", msg);
        use tauri::Emitter;
        let _ = self.app.emit("log", msg.to_string());
    }
}

/// HTTP Bridge 环境下的日志实现（仅 stderr）
pub struct StderrLogger;

impl GeminiLogger for StderrLogger {
    fn log(&self, msg: &str) {
        rlog_info!("[AI] {}", msg);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResult {
    #[serde(alias = "title")]
    pub subject: Option<String>,
    #[serde(alias = "description_text")]
    pub description: Option<String>,
    pub conversations: Vec<ConversationTranslation>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationTranslation {
    #[serde(deserialize_with = "deserialize_id")]
    pub id: u64,
    #[serde(alias = "bodyText")]
    pub body_text: String,
}

fn deserialize_id<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        String(String),
        Number(u64),
    }

    match StringOrNumber::deserialize(deserializer)? {
        StringOrNumber::String(s) => s.parse::<u64>().map_err(serde::de::Error::custom),
        StringOrNumber::Number(n) => Ok(n),
    }
}

/// Extract JSON object from a string by finding the first '{' and last '}'.
/// Used to strip markdown fences and surrounding text from AI output.
pub fn extract_json_object(raw: &str) -> Result<&str, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| format!("Failed to find JSON start '{{' in output: {}", raw))?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| format!("Failed to find JSON end '}}' in output: {}", raw))?;
    Ok(&raw[start..=end])
}

/// Map a short language code to a full language name.
pub fn lang_code_to_name(code: &str) -> &str {
    match code {
        "cn" | "zh-CN" => "Simplified Chinese",
        "en" => "English",
        "jp" => "Japanese",
        _ => code,
    }
}

pub struct GeminiClient;

impl GeminiClient {
    pub async fn translate_ticket(
        logger: &dyn GeminiLogger,
        ticket: &Ticket,
        target_lang: &str,
        system_prompt: Option<&str>,
    ) -> Result<Ticket, String> {
        logger.log(&format!(
            "🤖 Translating ticket #{} to {}...",
            ticket.id, target_lang
        ));

        let lang_name = lang_code_to_name(target_lang);
        let mut prompt = match system_prompt {
            Some(sp) if !sp.trim().is_empty() => {
                let mut p = sp.replace("${TARGET_LANG}", lang_name);
                p.push_str("\n\n");
                p
            }
            _ => {
                // 默认 systemPrompt（简化版：直接翻译 JSON）
                format!(
                    "You are a professional customer service translator.\n\
                    Translate the following JSON into {}.\n\
                    Translate ONLY text fields: subject, description, and each conversation's bodyText.\n\
                    Keep all non-text fields unchanged (id, userId, createdAt, incoming, private).\n\
                    Return the EXACT same JSON structure with translated text.\n\
                    Your response MUST be a single valid JSON object. No markdown fences, no explanations.\n\n",
                    lang_name
                )
            }
        };

        // 构建输入 JSON：如果 ticket.content 是有效 JSON 且含 subject，直接使用；否则从字段构建
        let content_json = if let Some(ref content) = ticket.content {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                if val.get("subject").is_some() {
                    content.clone()
                } else {
                    build_ticket_json(ticket)
                }
            } else {
                build_ticket_json(ticket)
            }
        } else {
            build_ticket_json(ticket)
        };

        prompt.push_str(&content_json);

        // Call gemini CLI
        let output = Command::new("gemini")
            .arg(&prompt)
            .output()
            .map_err(|e| format!("Failed to execute gemini: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Gemini CLI error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let clean_json = extract_json_object(&stdout)?;

        let translated_data: TranslationResult =
            serde_json::from_str(clean_json).map_err(|e| {
                format!(
                    "Failed to parse translation JSON: {}. Extracted: {}",
                    e, clean_json
                )
            })?;

        // 结果映射
        let mut new_ticket = ticket.clone();
        if let Some(ref s) = translated_data.subject {
            if !s.trim().is_empty() {
                new_ticket.subject = Some(s.clone());
            }
        }

        new_ticket.description_text = match translated_data.description {
            Some(ref s) if !s.trim().is_empty() => Some(s.clone()),
            _ => ticket.description_text.clone(),
        };

        if !new_ticket.conversations.is_empty() {
            for conv in new_ticket.conversations.iter_mut() {
                if let Some(trans_conv) = translated_data
                    .conversations
                    .iter()
                    .find(|tc| tc.id == conv.id)
                {
                    conv.body_text = trans_conv.body_text.clone();
                }
            }
        }

        logger.log(&format!(
            "✅ Translation to {} complete. Result: Title({} chars), Desc({} chars), Conversations({} items)",
            target_lang,
            new_ticket.subject.as_ref().map(|s| s.len()).unwrap_or(0),
            new_ticket.description_text.as_ref().map(|s| s.len()).unwrap_or(0),
            new_ticket.conversations.len()
        ));
        Ok(new_ticket)
    }

    /// Generic gemini CLI execution: takes a fully constructed prompt and a list of models (priority ordered).
    /// Tries each model in order; returns raw stdout on the first success.
    pub async fn execute_gemini(
        logger: &dyn GeminiLogger,
        prompt: &str,
        models: &[String],
    ) -> Result<String, String> {
        let models_to_try: Vec<&str> = if models.is_empty() {
            vec![""]
        } else {
            models.iter().map(|s| s.as_str()).collect()
        };

        logger.log(
            &format!(
                "🤖 Executing gemini CLI with {} model(s): [{}]",
                models_to_try.len(),
                models_to_try.join(", ")
            ),
        );

        let mut last_error = String::new();

        let gemini_timeout = Duration::from_secs(300);

        for (i, model) in models_to_try.iter().enumerate() {
            logger.log(
                &format!(
                    "  Trying model: {} ({}/{})",
                    if model.is_empty() { "default" } else { model },
                    i + 1,
                    models_to_try.len()
                ),
            );

            let mut cmd = Command::new("gemini");
            if !model.is_empty() {
                cmd.arg("--model").arg(model);
            }
            cmd.arg(prompt);

            let result = timeout(gemini_timeout, tokio::task::spawn_blocking(move || {
                cmd.output()
            }))
            .await;

            match result {
                Err(_) => {
                    let model_name = if model.is_empty() { "default" } else { model };
                    logger.log(
                        &format!("  ⏱ Model {} timed out after 120s", model_name),
                    );
                    last_error = format!("Model {} timed out after 120s", model_name);
                    // Continue to next model
                }
                Ok(join_result) => {
                    match join_result {
                        Err(e) => {
                            return Err(format!("Task join error: {}", e));
                        }
                        Ok(Ok(output)) if output.status.success() => {
                            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            logger.log(
                                &format!(
                                    "  ✅ Success with model: {}, output: {} chars",
                                    if model.is_empty() { "default" } else { model },
                                    stdout.len()
                                ),
                            );
                            return Ok(stdout);
                        }
                        Ok(Ok(output)) => {
                            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                            logger.log(
                                &format!(
                                    "  ❌ Model {} failed: {}",
                                    if model.is_empty() { "default" } else { model },
                                    stderr
                                ),
                            );
                            last_error = stderr;
                            // Continue to next model
                        }
                        Ok(Err(e)) => {
                            return Err(format!("Failed to execute gemini: {}", e));
                        }
                    }
                }
            }
        }

        Err(format!("All models failed. Last error: {}", last_error))
    }

    /// Sync-translate a reply: given both language versions and a direction,
    /// translate one side to match the other using Gemini CLI.
    pub async fn sync_translate_reply(
        logger: &dyn GeminiLogger,
        source_text: &str,
        reference_text: &str,
        direction: &str,
        target_lang: &str,
    ) -> Result<String, String> {
        let lang_name = lang_code_to_name(target_lang);

        let (from_label, to_label, translate_from, translate_to) = match direction {
            "zh_to_target" => ("Chinese", lang_name, source_text, reference_text),
            "target_to_zh" => (lang_name, "Chinese", source_text, reference_text),
            _ => return Err(format!("Unknown direction: {}", direction)),
        };

        logger.log(
            &format!("🔄 Sync translating reply: {} → {}...", from_label, to_label),
        );

        let prompt = format!(
            "You are a professional customer support translator.\n\
            \n\
            Below are two versions of a customer support reply:\n\
            \n\
            --- VERSION A ({}) ---\n\
            {}\n\
            \n\
            --- VERSION B ({}) ---\n\
            {}\n\
            \n\
            TASK: Translate VERSION A from {} into {}.\n\
            Use VERSION B as reference for context and tone, but produce a fresh translation of VERSION A.\n\
            \n\
            CRITICAL RULES:\n\
            1. Output ONLY the translated text. No explanations, no labels, no markdown.\n\
            2. Maintain the same tone, formatting, and paragraph structure as VERSION A.\n\
            3. The output must be entirely in {}.",
            from_label, translate_from,
            to_label, translate_to,
            from_label, to_label,
            to_label
        );

        let output = Command::new("gemini")
            .arg(&prompt)
            .output()
            .map_err(|e| format!("Failed to execute gemini: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Gemini CLI error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        logger.log(
            &format!("✅ Sync translation complete ({} → {}), result: {} chars", from_label, to_label, stdout.len()),
        );

        Ok(stdout)
    }
}

pub struct ClaudeClient;

impl ClaudeClient {
    /// Generic claude CLI execution: takes a prompt string and returns raw stdout.
    /// Uses timeout + spawn_blocking pattern consistent with GeminiClient::execute_gemini.
    pub async fn execute_claude(
        logger: &dyn GeminiLogger,
        prompt: &str,
    ) -> Result<String, String> {
        logger.log(
            &format!(
                "🤖 Executing claude CLI: prompt length={}",
                prompt.len()
            ),
        );

        let claude_timeout = Duration::from_secs(600);

        let prompt_owned = prompt.to_string();
        let result = timeout(claude_timeout, tokio::task::spawn_blocking(move || {
            Command::new("claude")
                .arg("-p")
                .arg(&prompt_owned)
                .arg("--output-format")
                .arg("text")
                // 清除 CLAUDECODE 环境变量，避免嵌套会话检测
                .env_remove("CLAUDECODE")
                .output()
        }))
        .await;

        match result {
            Err(_) => {
                logger.log("  ⏱ Claude CLI timed out after 600s");
                Err("Claude CLI timed out after 600s".to_string())
            }
            Ok(join_result) => {
                match join_result {
                    Err(e) => {
                        Err(format!("Task join error: {}", e))
                    }
                    Ok(Ok(output)) if output.status.success() => {
                        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        logger.log(
                            &format!(
                                "  ✅ Claude CLI success, output: {} chars",
                                stdout.len()
                            ),
                        );
                        Ok(stdout)
                    }
                    Ok(Ok(output)) => {
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                        let exit_code = output.status.code().unwrap_or(-1);
                        let err_detail = if !stderr.is_empty() {
                            stderr.clone()
                        } else if !stdout.is_empty() {
                            format!("(stdout) {}", stdout.chars().take(500).collect::<String>())
                        } else {
                            format!("exit code {}", exit_code)
                        };
                        logger.log(
                            &format!("  ❌ Claude CLI failed (exit={}): {}", exit_code, err_detail),
                        );
                        Err(format!("Claude CLI error: {}", err_detail))
                    }
                    Ok(Err(e)) => {
                        Err(format!("Failed to execute claude: {}", e))
                    }
                }
            }
        }
    }
}

/// 从 Ticket 结构体构建翻译输入 JSON（兜底，用于旧格式 content 或 content 为空时）
fn build_ticket_json(ticket: &Ticket) -> String {
    let conversations: Vec<serde_json::Value> = ticket
        .conversations
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "bodyText": c.body_text,
                "userId": c.user_id,
                "createdAt": c.created_at,
                "incoming": c.incoming,
                "private": c.private,
            })
        })
        .collect();

    serde_json::json!({
        "subject": ticket.subject.as_deref().unwrap_or(""),
        "description": ticket.description_text.as_deref().unwrap_or(""),
        "conversations": conversations,
    })
    .to_string()
}

/// NotebookLM-py Python 库调用：通过本地 python3 执行 notebooklm-py 的 async API。
/// 输入: query (查询问题), notebook_id (可选，NotebookLM notebook ID)
/// 输出: NotebookLM 的回复文本
pub async fn execute_notebooklm_py(
    query: &str,
    notebook_id: &str,
) -> Result<String, String> {
    rlog_info!("[NotebookLmPy] Executing query, length={}, notebook_id={}", query.len(), if notebook_id.is_empty() { "(default)" } else { notebook_id });

    // 内嵌 Python 脚本：使用 notebooklm-py 的 async API
    let python_script = format!(
        r#"
import asyncio
import json
import sys

async def main():
    try:
        from notebooklm import NotebookLMClient
        async with await NotebookLMClient.from_storage() as client:
            notebook_id = {notebook_id_repr}
            response = await client.chat.ask(notebook_id, {query_repr})
            # 输出 JSON 格式结果
            reply_text = response.answer if hasattr(response, 'answer') else str(response)
            result = {{"success": True, "reply": reply_text}}
            print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        result = {{"success": False, "error": str(e)}}
        print(json.dumps(result, ensure_ascii=False))

asyncio.run(main())
"#,
        notebook_id_repr = serde_json::to_string(notebook_id).unwrap_or_else(|_| "\"\"".to_string()),
        query_repr = serde_json::to_string(query).unwrap_or_else(|_| "\"\"".to_string()),
    );

    let python_timeout = Duration::from_secs(300);
    let script_clone = python_script.clone();
    let output = timeout(python_timeout, tokio::task::spawn_blocking(move || {
        Command::new("python3")
            .arg("-c")
            .arg(&script_clone)
            .output()
    }))
    .await
    .map_err(|_| "notebooklm-py execution timed out after 120s".to_string())?
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Failed to execute python3: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python3 error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    rlog_info!("[NotebookLmPy] Raw output: {} chars", stdout.len());

    // 解析 JSON 结果
    let result: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse notebooklm-py output: {}. Raw: {}", e, stdout))?;

    if result["success"].as_bool() == Some(true) {
        let reply = result["reply"].as_str().unwrap_or("").to_string();
        rlog_info!("[NotebookLmPy] Success, reply length={}", reply.len());
        Ok(reply)
    } else {
        let error = result["error"].as_str().unwrap_or("Unknown error").to_string();
        rlog_error!("[NotebookLmPy] Error: {}", error);
        Err(format!("notebooklm-py error: {}", error))
    }
}

/// NotebookLM RAG 模式执行器：将内容作为临时 source 添加到 Notebook，提问后清理。
///
/// 流程: 写临时文件 → source add → source wait → ask → source delete → 清理临时文件
pub async fn execute_notebooklm_rag(
    query: &str,
    source_content: &str,
    notebook_id: &str,
) -> Result<String, String> {
    rlog_info!(
        "[NotebookLmRag] Starting RAG execution: query_len={}, content_len={}, notebook_id={}",
        query.len(), source_content.len(), notebook_id
    );

    // ① 写临时文件（文件名"待处理问题"，NotebookLM 会用文件名作为 source 标题）
    let temp_dir = std::env::temp_dir().join("fd-rag-sources");
    let _ = std::fs::create_dir_all(&temp_dir);
    let file_name = format!("待处理问题-{}.txt", chrono::Utc::now().format("%Y%m%d%H%M%S%3f"));
    let temp_file = temp_dir.join(&file_name);
    std::fs::write(&temp_file, source_content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    rlog_info!("[NotebookLmRag] Wrote {} bytes to {:?}", source_content.len(), temp_file);

    // 确保清理的 guard（无论后续步骤是否失败）
    let result = execute_notebooklm_rag_inner(query, notebook_id, &temp_file).await;

    // ⑥ 清理临时文件
    if let Err(e) = std::fs::remove_file(&temp_file) {
        rlog_warn!("[NotebookLmRag] Failed to clean up temp file {:?}: {}", temp_file, e);
    }

    result
}

async fn execute_notebooklm_rag_inner(
    query: &str,
    notebook_id: &str,
    temp_file: &std::path::Path,
) -> Result<String, String> {
    let file_path_str = temp_file.to_string_lossy().to_string();

    // ② source add
    let add_args = vec![
        "source".to_string(), "add".to_string(),
        file_path_str,
        "-n".to_string(), notebook_id.to_string(),
        "--json".to_string(),
    ];
    let add_output = execute_notebooklm_cli(add_args, 120).await
        .map_err(|e| format!("source add failed: {}", e))?;

    // 解析 source_id（兼容两种 CLI 输出格式）
    // 格式1: {"source_id": "xxx", ...}
    // 格式2: {"source": {"id": "xxx", ...}}
    let add_json: serde_json::Value = serde_json::from_str(&add_output)
        .map_err(|e| format!("Failed to parse source add output: {}. Raw: {}", e, &add_output[..add_output.len().min(500)]))?;
    let source_id = add_json["source_id"].as_str()
        .or_else(|| add_json["source"]["id"].as_str())
        .ok_or_else(|| format!("source_id not found in add output: {}", &add_output[..add_output.len().min(500)]))?
        .to_string();
    rlog_info!("[NotebookLmRag] Source added: {}", source_id);

    // ③ source wait
    let wait_args = vec![
        "source".to_string(), "wait".to_string(),
        source_id.clone(),
        "-n".to_string(), notebook_id.to_string(),
        "--timeout".to_string(), "120".to_string(),
    ];
    if let Err(e) = execute_notebooklm_cli(wait_args, 150).await {
        // 清理 source 后返回错误
        let _ = delete_source(notebook_id, &source_id).await;
        return Err(format!("source wait failed: {}", e));
    }
    rlog_info!("[NotebookLmRag] Source ready: {}", source_id);

    // ④ ask（指定 source）
    let ask_args = vec![
        "ask".to_string(),
        query.to_string(),
        "-s".to_string(), source_id.clone(),
        "-n".to_string(), notebook_id.to_string(),
        "--new".to_string(),
        "--json".to_string(),
    ];
    let ask_result = execute_notebooklm_cli(ask_args, 300).await;

    // ⑤ 清理 source（无论 ask 是否成功）
    let _ = delete_source(notebook_id, &source_id).await;

    // 解析 ask 结果
    let ask_output = ask_result.map_err(|e| format!("ask failed: {}", e))?;
    let ask_json: serde_json::Value = serde_json::from_str(&ask_output)
        .unwrap_or_else(|_| serde_json::Value::String(ask_output.clone()));

    let answer = ask_json["answer"].as_str()
        .unwrap_or_else(|| ask_json.as_str().unwrap_or(&ask_output));
    rlog_info!("[NotebookLmRag] Got answer: {} chars", answer.len());

    Ok(answer.to_string())
}

/// 辅助：删除 source（best effort，不中断主流程）
async fn delete_source(notebook_id: &str, source_id: &str) -> Result<(), String> {
    let del_args = vec![
        "source".to_string(), "delete".to_string(),
        source_id.to_string(),
        "-n".to_string(), notebook_id.to_string(),
        "-y".to_string(),
    ];
    match execute_notebooklm_cli(del_args, 30).await {
        Ok(_) => {
            rlog_info!("[NotebookLmRag] Source deleted: {}", source_id);
            Ok(())
        }
        Err(e) => {
            rlog_warn!("[NotebookLmRag] Failed to delete source {}: {}", source_id, e);
            Err(e)
        }
    }
}

/// 通用 notebooklm CLI 执行器：调用 `notebooklm` 命令行工具
/// args: 传给 notebooklm 的命令行参数列表
/// timeout_secs: 超时时间（秒）
/// 返回: CLI 的 stdout 输出（通常是 JSON）
pub async fn execute_notebooklm_cli(
    args: Vec<String>,
    timeout_secs: u64,
) -> Result<String, String> {
    rlog_info!(
        "[NotebookLmCli] Executing: notebooklm {}",
        args.join(" ")
    );

    let cli_timeout = Duration::from_secs(timeout_secs);
    let args_clone = args.clone();
    let output = timeout(cli_timeout, tokio::task::spawn_blocking(move || {
        Command::new("notebooklm")
            .args(&args_clone)
            .output()
    }))
    .await
    .map_err(|_| format!("notebooklm CLI timed out after {}s", timeout_secs))?
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Failed to execute notebooklm: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        rlog_error!("[NotebookLmCli] Command failed, stderr: {}", stderr);
        return Err(format!("notebooklm CLI error (exit {}): {}",
            output.status.code().unwrap_or(-1),
            if stderr.is_empty() { &stdout } else { &stderr }));
    }

    rlog_info!("[NotebookLmCli] Success, output: {} chars", stdout.len());
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_json_object ──

    #[test]
    fn extract_json_from_clean_input() {
        let input = r#"{"subject":"Hello","description_text":"World"}"#;
        assert_eq!(extract_json_object(input).unwrap(), input);
    }

    #[test]
    fn extract_json_from_markdown_fenced_output() {
        let input = "Here is the translation:\n```json\n{\"subject\":\"你好\"}\n```\nDone!";
        assert_eq!(
            extract_json_object(input).unwrap(),
            r#"{"subject":"你好"}"#
        );
    }

    #[test]
    fn extract_json_with_nested_braces() {
        let input = r#"prefix {"a":{"b":"c"}} suffix"#;
        assert_eq!(
            extract_json_object(input).unwrap(),
            r#"{"a":{"b":"c"}}"#
        );
    }

    #[test]
    fn extract_json_no_opening_brace() {
        let input = "no json here";
        assert!(extract_json_object(input).is_err());
    }

    #[test]
    fn extract_json_no_closing_brace() {
        let input = "start { but never close";
        // rfind('}') will fail
        assert!(extract_json_object(input).is_err());
    }

    // ── lang_code_to_name ──

    #[test]
    fn lang_code_chinese_variants() {
        assert_eq!(lang_code_to_name("cn"), "Simplified Chinese");
        assert_eq!(lang_code_to_name("zh-CN"), "Simplified Chinese");
    }

    #[test]
    fn lang_code_english() {
        assert_eq!(lang_code_to_name("en"), "English");
    }

    #[test]
    fn lang_code_japanese() {
        assert_eq!(lang_code_to_name("jp"), "Japanese");
    }

    #[test]
    fn lang_code_unknown_passthrough() {
        assert_eq!(lang_code_to_name("ko"), "ko");
        assert_eq!(lang_code_to_name("fr"), "fr");
    }

    // ── TranslationResult deserialization ──

    #[test]
    fn deserialize_translation_result_standard() {
        // 新格式: description + bodyText
        let json = r#"{
            "subject": "翻译后的标题",
            "description": "翻译后的正文",
            "conversations": [
                {"id": 123, "bodyText": "翻译后的对话"}
            ]
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.subject.as_deref(), Some("翻译后的标题"));
        assert_eq!(result.description.as_deref(), Some("翻译后的正文"));
        assert_eq!(result.conversations.len(), 1);
        assert_eq!(result.conversations[0].id, 123);
        assert_eq!(result.conversations[0].body_text, "翻译后的对话");
    }

    #[test]
    fn deserialize_translation_result_with_aliases() {
        // 旧格式: description_text + body_text（验证向后兼容）
        let json = r#"{
            "subject": "Title",
            "description_text": "Content via alias",
            "conversations": [
                {"id": 1, "body_text": "old format"}
            ]
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.subject.as_deref(), Some("Title"));
        assert_eq!(result.description.as_deref(), Some("Content via alias"));
        assert_eq!(result.conversations[0].body_text, "old format");
    }

    #[test]
    fn deserialize_conversation_body_text_camel_case() {
        // bodyText（新格式）通过 alias 反序列化
        let json = r#"{"id": 123, "bodyText": "camel case format"}"#;
        let conv: ConversationTranslation = serde_json::from_str(json).unwrap();
        assert_eq!(conv.id, 123);
        assert_eq!(conv.body_text, "camel case format");
    }

    #[test]
    fn deserialize_conversation_id_as_string() {
        // The deserialize_id function should handle string IDs
        let json = r#"{"id": "456", "body_text": "test"}"#;
        let conv: ConversationTranslation = serde_json::from_str(json).unwrap();
        assert_eq!(conv.id, 456);
    }

    #[test]
    fn deserialize_conversation_id_as_number() {
        let json = r#"{"id": 789, "body_text": "test"}"#;
        let conv: ConversationTranslation = serde_json::from_str(json).unwrap();
        assert_eq!(conv.id, 789);
    }

    #[test]
    fn deserialize_conversation_id_invalid_string() {
        let json = r#"{"id": "not_a_number", "body_text": "test"}"#;
        let result = serde_json::from_str::<ConversationTranslation>(json);
        assert!(result.is_err());
    }

    #[test]
    fn deserialize_translation_result_null_description() {
        let json = r#"{
            "subject": "Title",
            "conversations": []
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert!(result.description.is_none());
    }
}
