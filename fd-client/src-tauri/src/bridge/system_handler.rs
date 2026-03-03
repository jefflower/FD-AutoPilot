//! System HTTP handlers.
//!
//! Health check and capability detection endpoints.

use axum::extract::Json;
use std::process::Command;
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

pub async fn capabilities_detect_handler() -> Json<CapabilitiesResponse> {
    eprintln!("[fd-bridge] GET /bridge/capabilities/detect");

    let (gemini, claude, notebooklm) = tokio::join!(
        detect_capability("gemini-cli", "gemini", &["--version"]),
        detect_capability("claude-cli", "claude", &["--version"]),
        detect_capability(
            "notebooklm-py",
            "python3",
            &["-c", "import notebooklm; print(notebooklm.__version__)"]
        ),
    );

    Json(CapabilitiesResponse {
        capabilities: vec![gemini, claude, notebooklm],
    })
}
