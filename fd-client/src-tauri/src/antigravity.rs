//! AntiGravity Tools client — calls a local OpenAI-compatible API proxy.
//!
//! The proxy runs at `http://127.0.0.1:<port>` (default 8045) and exposes
//! `/v1/models` and `/v1/chat/completions` endpoints.
//!
//! Configuration is read from `~/.antigravity_tools/gui_config.json`:
//!   - `proxy.api_key` (default "sk-antigravity")
//!   - `proxy.port`    (default 8045)

use serde::{Deserialize, Serialize};
use std::time::Duration;

// ========== Configuration ==========

const DEFAULT_PORT: u16 = 8045;
const DEFAULT_API_KEY: &str = "sk-antigravity";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Deserialize, Default)]
struct GuiConfig {
    #[serde(default)]
    proxy: ProxyConfig,
}

#[derive(Deserialize, Default)]
struct ProxyConfig {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    port: Option<u16>,
}

/// Read config from `~/.antigravity_tools/gui_config.json`.
/// Returns (base_url, api_key).
fn read_config() -> (String, String) {
    let config = dirs::home_dir()
        .map(|home| home.join(".antigravity_tools").join("gui_config.json"))
        .and_then(|path| std::fs::read_to_string(&path).ok())
        .and_then(|content| serde_json::from_str::<GuiConfig>(&content).ok())
        .unwrap_or_default();

    let port = config.proxy.port.unwrap_or(DEFAULT_PORT);
    let api_key = config
        .proxy
        .api_key
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| DEFAULT_API_KEY.to_string());

    let base_url = format!("http://127.0.0.1:{}", port);
    (base_url, api_key)
}

// ========== OpenAI API DTOs ==========

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelInfo>,
}

#[derive(Deserialize)]
struct ModelInfo {
    id: String,
}

// ========== Client ==========

pub struct AntiGravityClient;

impl AntiGravityClient {
    /// Detect whether the AntiGravity Tools proxy is reachable.
    /// Returns `Ok(version_info)` on success.
    pub async fn detect() -> Result<String, String> {
        let (base_url, api_key) = read_config();
        let url = format!("{}/v1/models", base_url);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| format!("failed to build HTTP client: {}", e))?;

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("connection failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("API returned status {}", resp.status()));
        }

        let body: ModelsResponse = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse models response: {}", e))?;

        Ok(format!("{} models available", body.data.len()))
    }

    /// List available models from the proxy.
    pub async fn list_models() -> Result<Vec<String>, String> {
        let (base_url, api_key) = read_config();
        let url = format!("{}/v1/models", base_url);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("failed to build HTTP client: {}", e))?;

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("connection failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("API returned status {}", resp.status()));
        }

        let body: ModelsResponse = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse models response: {}", e))?;

        Ok(body.data.into_iter().map(|m| m.id).collect())
    }

    /// Call the chat completions endpoint.
    pub async fn chat(
        prompt: &str,
        model: &str,
        system_prompt: Option<&str>,
        temperature: Option<f32>,
    ) -> Result<String, String> {
        let (base_url, api_key) = read_config();
        let url = format!("{}/v1/chat/completions", base_url);

        rlog_info!(
            "[antigravity] chat request: model={}, prompt_len={}, has_system={}",
            model,
            prompt.len(),
            system_prompt.is_some()
        );

        let mut messages = Vec::new();
        if let Some(sys) = system_prompt {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: sys.to_string(),
            });
        }
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        });

        let chat_req = ChatRequest {
            model: model.to_string(),
            messages,
            temperature,
        };

        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| format!("failed to build HTTP client: {}", e))?;

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&chat_req)
            .send()
            .await
            .map_err(|e| {
                rlog_error!("[antigravity] request failed: {}", e);
                format!("request failed: {}", e)
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            rlog_error!(
                "[antigravity] API error: status={}, body={}",
                status,
                &body[..body.len().min(500)]
            );
            return Err(format!("API returned status {}: {}", status, body));
        }

        let chat_resp: ChatResponse = resp.json().await.map_err(|e| {
            rlog_error!("[antigravity] failed to parse chat response: {}", e);
            format!("failed to parse chat response: {}", e)
        })?;

        let content = chat_resp
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();

        rlog_info!(
            "[antigravity] chat response: {} chars",
            content.len()
        );

        Ok(content)
    }
}
