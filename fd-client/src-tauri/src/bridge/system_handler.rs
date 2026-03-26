//! System HTTP handlers.
//!
//! Health check and capability detection endpoints.

use axum::extract::{Json, Query};
use std::process::{Command, Stdio};
use std::io::Write;
use tokio::time::{timeout, Duration};

use super::types::*;

pub async fn health_handler() -> &'static str {
    "fd-bridge OK"
}

/// Detect whether a single capability (CLI tool) is available.
async fn detect_capability(code: &str, command: &str, args: &[&str]) -> CapabilityInfo {
    let code_owned = code.to_string();
    let command_owned = command.to_string();
    let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();

    let detect_timeout = Duration::from_secs(5);

    let result = timeout(
        detect_timeout,
        tokio::task::spawn_blocking(move || {
            Command::new(&command_owned)
                .args(&args_owned)
                .output()
        }),
    )
    .await;

    match result {
        Err(_) => CapabilityInfo {
            code: code_owned,
            available: false,
            version: None,
            error: Some("detection timed out after 5s".to_string()),
        },
        Ok(join_result) => match join_result {
            Err(e) => CapabilityInfo {
                code: code_owned,
                available: false,
                version: None,
                error: Some(format!("task join error: {}", e)),
            },
            Ok(Ok(output)) => {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    CapabilityInfo {
                        code: code_owned,
                        available: true,
                        version: if version.is_empty() {
                            None
                        } else {
                            Some(version)
                        },
                        error: None,
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    CapabilityInfo {
                        code: code_owned,
                        available: false,
                        version: None,
                        error: Some(if stderr.is_empty() {
                            format!("exited with status {}", output.status)
                        } else {
                            stderr
                        }),
                    }
                }
            }
            Ok(Err(e)) => CapabilityInfo {
                code: code_owned,
                available: false,
                version: None,
                error: Some(e.to_string()),
            },
        },
    }
}

/// Detect antigravity-tools by checking its HTTP API endpoint.
async fn detect_antigravity() -> CapabilityInfo {
    let detect_timeout = Duration::from_secs(5);
    let result = timeout(detect_timeout, async {
        let client = reqwest::Client::new();
        client
            .get("http://127.0.0.1:8045/v1/models")
            .send()
            .await
    })
    .await;

    match result {
        Err(_) => CapabilityInfo {
            code: "antigravity-tools".to_string(),
            available: false,
            version: None,
            error: Some("detection timed out after 5s".to_string()),
        },
        Ok(Err(e)) => CapabilityInfo {
            code: "antigravity-tools".to_string(),
            available: false,
            version: None,
            error: Some(format!("connection failed: {}", e)),
        },
        Ok(Ok(resp)) => {
            if resp.status().is_success() {
                // Try to extract model count as version info
                let version = match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        let count = json
                            .get("data")
                            .and_then(|d| d.as_array())
                            .map(|arr| arr.len())
                            .unwrap_or(0);
                        Some(format!("{} models available", count))
                    }
                    Err(_) => Some("service available".to_string()),
                };
                CapabilityInfo {
                    code: "antigravity-tools".to_string(),
                    available: true,
                    version,
                    error: None,
                }
            } else {
                CapabilityInfo {
                    code: "antigravity-tools".to_string(),
                    available: false,
                    version: None,
                    error: Some(format!("API returned status {}", resp.status())),
                }
            }
        }
    }
}

pub async fn capabilities_detect_handler() -> Json<CapabilitiesResponse> {
    eprintln!("[fd-bridge] GET /bridge/capabilities/detect");

    let (gemini, claude, notebooklm, antigravity) = tokio::join!(
        detect_capability("gemini-cli", "gemini", &["--version"]),
        detect_capability("claude-cli", "claude", &["--version"]),
        detect_capability(
            "notebooklm-py",
            "python3",
            &["-c", "import notebooklm; print(notebooklm.__version__)"]
        ),
        detect_antigravity(),
    );

    Json(CapabilitiesResponse {
        capabilities: vec![gemini, claude, notebooklm, antigravity],
    })
}

// ========== Skill Detection ==========

const SKILL_DETECT_PROMPT: &str = r#"请列出你的skills，以纯 JSON 数组返回，格式: [{"name":"技能名","description":"简短描述","command":"示例调用命令"}]。command 字段写一个最简单的示例命令（如 gemini "翻译这段话" 或 claude -p "写一段代码"）。最多列出 10 个核心技能。只返回 JSON 数组，不要任何其他文字、代码块标记或解释。"#;

/// Detect skills of a given AI CLI tool by prompting it.
pub async fn skills_detect_handler(
    Query(params): Query<SkillsQueryParams>,
) -> Json<SkillsResponse> {
    let cap = params.cap.clone();
    eprintln!("[fd-bridge] GET /bridge/capabilities/skills?cap={}", cap);

    // antigravity-tools: predefined skills (no need to prompt AI)
    if cap == "antigravity-tools" {
        return Json(SkillsResponse {
            skills: vec![
                SkillInfo {
                    name: "chat".to_string(),
                    description: "OpenAI compatible chat completions API".to_string(),
                    command: Some("POST /bridge/antigravity".to_string()),
                },
                SkillInfo {
                    name: "models".to_string(),
                    description: "List available models".to_string(),
                    command: Some("GET /v1/models".to_string()),
                },
            ],
            error: None,
        });
    }

    let command = match cap.as_str() {
        "gemini-cli" => "gemini",
        "claude-cli" => "claude",
        _ => {
            return Json(SkillsResponse {
                skills: vec![],
                error: Some(format!("unknown capability: {}", cap)),
            });
        }
    };

    let command_owned = command.to_string();
    let cap_clone = cap.clone();
    let skill_timeout = Duration::from_secs(60);

    let result = timeout(
        skill_timeout,
        tokio::task::spawn_blocking(move || {
            match cap_clone.as_str() {
                // claude-cli: 使用 -p 参数传递 prompt（Claude Code 不接受 stdin 输入）
                "claude-cli" => {
                    Command::new(&command_owned)
                        .arg("-p")
                        .arg(SKILL_DETECT_PROMPT)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .output()
                }
                // gemini-cli 等: 通过 stdin 传入 prompt
                _ => {
                    let mut child = Command::new(&command_owned)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()?;

                    if let Some(mut stdin) = child.stdin.take() {
                        stdin.write_all(SKILL_DETECT_PROMPT.as_bytes())?;
                        // 关闭 stdin 表示输入结束
                    }

                    child.wait_with_output()
                }
            }
        }),
    )
    .await;

    match result {
        Err(_) => Json(SkillsResponse {
            skills: vec![],
            error: Some(format!("{} skill detection timed out after 30s", cap)),
        }),
        Ok(join_result) => match join_result {
            Err(e) => Json(SkillsResponse {
                skills: vec![],
                error: Some(format!("task join error: {}", e)),
            }),
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

                // 尝试从输出中提取 JSON 数组（AI 可能包裹在 ```json ... ``` 中）
                let json_str = extract_json_array(&stdout);

                match serde_json::from_str::<Vec<SkillInfo>>(&json_str) {
                    Ok(skills) => Json(SkillsResponse {
                        skills,
                        error: None,
                    }),
                    Err(e) => Json(SkillsResponse {
                        skills: vec![],
                        error: Some(format!(
                            "failed to parse skills JSON: {}. Raw output: {}",
                            e,
                            &stdout[..stdout.len().min(500)]
                        )),
                    }),
                }
            }
            Ok(Err(e)) => Json(SkillsResponse {
                skills: vec![],
                error: Some(format!("{} not found or failed to start: {}", cap, e)),
            }),
        },
    }
}

// ========== Model Detection ==========

const MODEL_DETECT_PROMPT: &str = r#"请列出你当前可以使用的所有 AI 模型名称，以纯 JSON 字符串数组返回，格式: ["model-name-1", "model-name-2"]。只返回 JSON 数组，不要任何其他文字、代码块标记或解释。"#;

/// Detect available models of a given AI CLI tool by prompting it.
pub async fn models_detect_handler(
    Query(params): Query<ModelsQueryParams>,
) -> Json<ModelsResponse> {
    let cap = params.cap.clone();
    eprintln!("[fd-bridge] GET /bridge/capabilities/models?cap={}", cap);

    // antigravity-tools: fetch models via HTTP API directly
    if cap == "antigravity-tools" {
        return match crate::antigravity::AntiGravityClient::list_models().await {
            Ok(models) => Json(ModelsResponse {
                models,
                error: None,
            }),
            Err(e) => Json(ModelsResponse {
                models: vec![],
                error: Some(e),
            }),
        };
    }

    let command = match cap.as_str() {
        "gemini-cli" => "gemini",
        "claude-cli" => "claude",
        _ => {
            return Json(ModelsResponse {
                models: vec![],
                error: Some(format!("unknown capability: {}", cap)),
            });
        }
    };

    let command_owned = command.to_string();
    let cap_clone = cap.clone();
    let model_timeout = Duration::from_secs(60);

    let result = timeout(
        model_timeout,
        tokio::task::spawn_blocking(move || {
            match cap_clone.as_str() {
                // claude-cli: 使用 -p 参数传递 prompt（Claude Code 不接受 stdin 输入）
                "claude-cli" => {
                    Command::new(&command_owned)
                        .arg("-p")
                        .arg(MODEL_DETECT_PROMPT)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .output()
                }
                // gemini-cli 等: 通过 stdin 传入 prompt
                _ => {
                    let mut child = Command::new(&command_owned)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()?;

                    if let Some(mut stdin) = child.stdin.take() {
                        stdin.write_all(MODEL_DETECT_PROMPT.as_bytes())?;
                        // 关闭 stdin 表示输入结束
                    }

                    child.wait_with_output()
                }
            }
        }),
    )
    .await;

    match result {
        Err(_) => Json(ModelsResponse {
            models: vec![],
            error: Some(format!("{} model detection timed out after 60s", cap)),
        }),
        Ok(join_result) => match join_result {
            Err(e) => Json(ModelsResponse {
                models: vec![],
                error: Some(format!("task join error: {}", e)),
            }),
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

                // 尝试从输出中提取 JSON 数组（AI 可能包裹在 ```json ... ``` 中）
                let json_str = extract_json_array(&stdout);

                match serde_json::from_str::<Vec<String>>(&json_str) {
                    Ok(models) => Json(ModelsResponse {
                        models,
                        error: None,
                    }),
                    Err(e) => Json(ModelsResponse {
                        models: vec![],
                        error: Some(format!(
                            "failed to parse models JSON: {}. Raw output: {}",
                            e,
                            &stdout[..stdout.len().min(500)]
                        )),
                    }),
                }
            }
            Ok(Err(e)) => Json(ModelsResponse {
                models: vec![],
                error: Some(format!("{} not found or failed to start: {}", cap, e)),
            }),
        },
    }
}

// ========== Capability Diagnostic Test ==========

/// Run a single diagnostic check: execute a command and return pass/fail + output.
async fn run_check(name: &str, command: &str, args: &[&str]) -> super::types::CapTestCheck {
    let name_owned = name.to_string();
    let cmd = command.to_string();
    let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();

    let check_timeout = Duration::from_secs(10);

    let result = timeout(
        check_timeout,
        tokio::task::spawn_blocking(move || {
            Command::new(&cmd).args(&args_owned).output()
        }),
    )
    .await;

    match result {
        Err(_) => super::types::CapTestCheck {
            name: name_owned,
            passed: false,
            detail: "超时 (10s)".to_string(),
        },
        Ok(Err(e)) => super::types::CapTestCheck {
            name: name_owned,
            passed: false,
            detail: format!("任务错误: {}", e),
        },
        Ok(Ok(Ok(output))) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                super::types::CapTestCheck {
                    name: name_owned,
                    passed: true,
                    detail: if stdout.is_empty() { "(无输出)".to_string() } else { stdout },
                }
            } else {
                let msg = if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { format!("退出码 {}", output.status) };
                super::types::CapTestCheck {
                    name: name_owned,
                    passed: false,
                    detail: msg,
                }
            }
        }
        Ok(Ok(Err(e))) => super::types::CapTestCheck {
            name: name_owned,
            passed: false,
            detail: format!("{}", e),
        },
    }
}

/// Diagnostic test handler for capabilities.
/// Currently only supports `notebooklm-py`.
pub async fn capability_test_handler(
    Query(params): Query<super::types::CapTestQueryParams>,
) -> Json<super::types::CapTestResponse> {
    let cap = params.cap;
    eprintln!("[fd-bridge] GET /bridge/capabilities/test?cap={}", cap);

    if cap != "notebooklm-py" {
        return Json(super::types::CapTestResponse {
            checks: vec![],
            summary: "不支持".to_string(),
            error: Some(format!("暂不支持 {} 的诊断测试", cap)),
        });
    }

    // Run all checks concurrently
    let (python_which, python_version, notebooklm_import, notebooklm_cli_which, path_env) = tokio::join!(
        run_check("python3 路径", "which", &["-a", "python3"]),
        run_check("python3 版本", "python3", &["--version"]),
        run_check("notebooklm 包", "python3", &["-c", "import notebooklm; print(notebooklm.__version__)"]),
        run_check("notebooklm CLI", "which", &["-a", "notebooklm"]),
        // Get PATH via a shell so env var is expanded
        run_check("PATH 环境变量", "sh", &["-c", "echo $PATH"]),
    );

    let checks = vec![python_which, python_version, notebooklm_import, notebooklm_cli_which, path_env];
    let passed = checks.iter().filter(|c| c.passed).count();
    let total = checks.len();
    let summary = format!("{}/{} 项通过", passed, total);

    // Generate actionable error message
    let error = if !checks[2].passed {
        Some("notebooklm 包未安装，请执行: pip install notebooklm".to_string())
    } else if !checks[0].passed {
        Some("python3 未找到，请确认已安装 Python 3".to_string())
    } else {
        None
    };

    Json(super::types::CapTestResponse {
        checks,
        summary,
        error,
    })
}

/// Extract a JSON array from AI output that may contain markdown code fences.
fn extract_json_array(text: &str) -> String {
    let trimmed = text.trim();

    // 直接是 JSON 数组
    if trimmed.starts_with('[') {
        return trimmed.to_string();
    }

    // 从 ```json ... ``` 或 ``` ... ``` 中提取
    if let Some(start) = trimmed.find("```") {
        let after_fence = &trimmed[start + 3..];
        // 跳过语言标记行
        let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
        let content = &after_fence[content_start..];
        if let Some(end) = content.find("```") {
            let inner = content[..end].trim();
            if inner.starts_with('[') {
                return inner.to_string();
            }
        }
    }

    // 尝试找到第一个 [ 和最后一个 ] 之间的内容
    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if start < end {
            return trimmed[start..=end].to_string();
        }
    }

    trimmed.to_string()
}
