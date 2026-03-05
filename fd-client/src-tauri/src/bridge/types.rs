//! Bridge HTTP API request/response types.
//!
//! All DTOs shared across bridge handlers live here.

use serde::{Deserialize, Serialize};

use crate::execution_log::{ExecLogConfig, ExecLogEntry, ExecLogPage};
use crate::models::Ticket;

// ========== Generic Response Wrapper ==========

#[derive(Serialize)]
pub struct BridgeResponse<T: Serialize> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Helper: build a success response.
pub fn ok_response<T: Serialize>(data: T) -> BridgeResponse<T> {
    BridgeResponse {
        success: true,
        data: Some(data),
        error: None,
    }
}

/// Helper: build an error response.
pub fn err_response<T: Serialize>(msg: String) -> BridgeResponse<T> {
    BridgeResponse {
        success: false,
        data: None,
        error: Some(msg),
    }
}

// ========== Agent Request DTOs ==========

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub ticket: Ticket,
    pub target_lang: String,
    pub system_prompt: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiRequest {
    pub prompt: String,
    #[serde(default)]
    pub models: Vec<String>,
    /// Agent code for execution log attribution (default: "gemini-cli").
    #[serde(default)]
    pub agent_code: Option<String>,
    /// Structured metadata (ticketId, subject, targetLang, etc.) for readable logs.
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRequest {
    pub prompt: String,
    /// Agent code for execution log attribution (default: "claude-cli").
    #[serde(default)]
    pub agent_code: Option<String>,
    /// Structured metadata for readable logs.
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTranslateRequest {
    pub source_text: String,
    pub reference_text: String,
    pub direction: String,
    pub target_lang: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmPyRequest {
    pub query: String,
    #[serde(default)]
    pub notebook_id: String,
    /// Agent code for execution log attribution (default: "ticket-reply").
    #[serde(default)]
    pub agent_code: Option<String>,
}

// ========== Exec Log Query Params ==========

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogQueryParams {
    pub agent_code: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogConfigQueryParams {
    pub agent_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRequest {
    pub agent_code: Option<String>,
    pub retention_days: Option<i32>,
}

// ========== Capability Detection ==========

#[derive(Serialize, Clone)]
pub struct CapabilityInfo {
    pub code: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    pub capabilities: Vec<CapabilityInfo>,
}

// ========== Skill Detection ==========

#[derive(Deserialize)]
pub struct SkillsQueryParams {
    pub cap: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub command: Option<String>,
}

#[derive(Serialize)]
pub struct SkillsResponse {
    pub skills: Vec<SkillInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ========== Model Detection ==========

#[derive(Deserialize)]
pub struct ModelsQueryParams {
    pub cap: String,
}

#[derive(Serialize)]
pub struct ModelsResponse {
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ========== NotebookLM CLI Request ==========

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmCliRequest {
    /// Action: "list-notebooks", "list-sources", "add-source", "delete-source", "source-fulltext"
    pub action: String,
    /// NotebookLM notebook UUID (required for most actions)
    #[serde(default)]
    pub notebook_id: Option<String>,
    /// Source UUID (required for delete-source, source-fulltext)
    #[serde(default)]
    pub source_id: Option<String>,
    /// File path, URL, or text content (required for add-source)
    #[serde(default)]
    pub content_or_path: Option<String>,
    /// Source type hint: "pdf", "url", "text", etc.
    #[serde(default)]
    pub source_type: Option<String>,
    /// Optional title for add-source
    #[serde(default)]
    pub title: Option<String>,
}

// ========== Type aliases for handler return types ==========

/// Convenience type aliases to reduce boilerplate in handler signatures.
pub type HandlerResult<T> = (axum::http::StatusCode, axum::Json<BridgeResponse<T>>);
pub type TicketResult = HandlerResult<Ticket>;
pub type StringResult = HandlerResult<String>;
pub type UnitResult = HandlerResult<()>;
pub type U32Result = HandlerResult<u32>;
pub type LogPageResult = HandlerResult<ExecLogPage>;
pub type LogEntryResult = HandlerResult<ExecLogEntry>;
pub type LogConfigResult = HandlerResult<Vec<ExecLogConfig>>;
pub type JsonResult = HandlerResult<serde_json::Value>;
