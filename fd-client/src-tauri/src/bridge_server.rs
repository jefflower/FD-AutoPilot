use axum::{
    extract::Json,
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::ai::{GeminiClient, StderrLogger};
use crate::models::Ticket;

// ========== Request DTOs ==========

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateRequest {
    ticket: Ticket,
    target_lang: String,
    system_prompt: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    prompt: String,
    #[serde(default)]
    models: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncTranslateRequest {
    source_text: String,
    reference_text: String,
    direction: String,
    target_lang: String,
}

// ========== Response DTO ==========

#[derive(Serialize)]
struct BridgeResponse<T: Serialize> {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ========== CLI Agent Handlers ==========

async fn health_handler() -> &'static str {
    "fd-bridge OK"
}

async fn translate_handler(
    Json(req): Json<TranslateRequest>,
) -> (StatusCode, Json<BridgeResponse<Ticket>>) {
    let logger = StderrLogger;
    match GeminiClient::translate_ticket(
        &logger,
        &req.ticket,
        &req.target_lang,
        req.system_prompt.as_deref(),
    )
    .await
    {
        Ok(ticket) => (
            StatusCode::OK,
            Json(BridgeResponse {
                success: true,
                data: Some(ticket),
                error: None,
            }),
        ),
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

async fn gemini_handler(
    Json(req): Json<GeminiRequest>,
) -> (StatusCode, Json<BridgeResponse<String>>) {
    let logger = StderrLogger;
    match GeminiClient::execute_gemini(&logger, &req.prompt, &req.models).await {
        Ok(output) => (
            StatusCode::OK,
            Json(BridgeResponse {
                success: true,
                data: Some(output),
                error: None,
            }),
        ),
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

async fn sync_translate_handler(
    Json(req): Json<SyncTranslateRequest>,
) -> (StatusCode, Json<BridgeResponse<String>>) {
    let logger = StderrLogger;
    match GeminiClient::sync_translate_reply(
        &logger,
        &req.source_text,
        &req.reference_text,
        &req.direction,
        &req.target_lang,
    )
    .await
    {
        Ok(output) => (
            StatusCode::OK,
            Json(BridgeResponse {
                success: true,
                data: Some(output),
                error: None,
            }),
        ),
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

// ========== Shadow Agent SSE Handler (Tauri-only) ==========

#[cfg(feature = "tauri-app")]
mod shadow_handlers {
    use super::*;
    use crate::shadow_agent::engine::{NotebookAgent, ReplyRequest, ShadowEvent};
    use axum::{
        extract::State,
        response::sse::{Event, KeepAlive, Sse},
    };
    use std::sync::Arc;
    use tokio::sync::mpsc;
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    /// Axum 共享状态：持有 Tauri AppHandle
    #[derive(Clone)]
    pub struct AppState {
        pub app_handle: tauri::AppHandle,
    }

    /// SSE 端点：/bridge/agents/reply
    /// 接收 ReplyRequest，启动 NotebookLM Shadow Agent，流式返回结果
    pub async fn reply_sse_handler(
        State(state): State<AppState>,
        Json(req): Json<ReplyRequest>,
    ) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
        eprintln!("[fd-bridge] POST /bridge/agents/reply: notebook_id={}, messages={}, notebook_url={:?}",
            req.notebook_id, req.messages.len(), req.notebook_url);

        let (tx, rx) = mpsc::channel::<ShadowEvent>(32);

        let agent = Arc::new(NotebookAgent::new(state.app_handle.clone(), &req));

        // 在后台执行编排流程
        tokio::spawn(async move {
            eprintln!("[fd-bridge] Shadow Agent task spawned");
            agent.execute(req, tx).await;
            eprintln!("[fd-bridge] Shadow Agent task completed");
        });

        let mut event_count: u64 = 0;
        let stream = ReceiverStream::new(rx).map(move |event| {
            event_count += 1;
            let json = serde_json::to_string(&event).unwrap_or_default();
            let event_type = match &event {
                ShadowEvent::Streaming { text } => {
                    if event_count <= 3 || event_count % 10 == 0 {
                        eprintln!("[fd-bridge] SSE #{}: streaming, text_len={}", event_count, text.len());
                    }
                    "streaming"
                },
                ShadowEvent::Complete { text } => {
                    eprintln!("[fd-bridge] SSE #{}: COMPLETE, text_len={}", event_count, text.len());
                    "complete"
                },
                ShadowEvent::Error { message } => {
                    eprintln!("[fd-bridge] SSE #{}: ERROR: {}", event_count, message);
                    "error"
                },
                ShadowEvent::Log { message } => {
                    eprintln!("[fd-bridge] SSE #{}: log: {}", event_count, message);
                    "log"
                },
            };
            Ok(Event::default().event(event_type).data(json))
        });

        Sse::new(stream).keep_alive(KeepAlive::default())
    }

    /// 构建包含 Shadow Agent 端点的 Router
    pub fn build_router_with_shadow(app_handle: tauri::AppHandle) -> Router {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let state = AppState { app_handle };

        Router::new()
            .route("/bridge/health", get(health_handler))
            .route("/bridge/translate", post(translate_handler))
            .route("/bridge/gemini", post(gemini_handler))
            .route("/bridge/sync-translate", post(sync_translate_handler))
            // Shadow Agent SSE 端点
            .route("/bridge/agents/reply", post(reply_sse_handler))
            .with_state(state)
            .layer(cors)
    }
}

// ========== Server startup ==========

fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/bridge/health", get(health_handler))
        .route("/bridge/translate", post(translate_handler))
        .route("/bridge/gemini", post(gemini_handler))
        .route("/bridge/sync-translate", post(sync_translate_handler))
        .layer(cors)
}

/// 独立运行模式：阻塞式启动 HTTP 服务器（用于 fd-bridge 二进制，无 Shadow 支持）
pub async fn run_standalone() {
    let router = build_router();
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
    eprintln!("[fd-bridge] Standalone HTTP server listening on http://{}", addr);
    eprintln!("[fd-bridge] Note: Shadow Window agents require Tauri desktop mode (npm run tauri dev)");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect(&format!("[fd-bridge] Failed to bind port {}", addr));
    axum::serve(listener, router)
        .await
        .expect("[fd-bridge] Server error");
}

/// 后台运行模式（无 AppHandle）：仅 CLI Agent 端点
pub fn start_bridge_server() {
    tokio::spawn(async move {
        let router = build_router();
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
        eprintln!("[fd-bridge] HTTP server listening on http://{}", addr);

        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[fd-bridge] Server error: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[fd-bridge] Failed to bind port {}: {}", addr, e);
            }
        }
    });
}

/// 后台运行模式（有 AppHandle）：CLI + Shadow Agent 全部端点
/// 注意：Tauri setup hook 中没有 Tokio runtime，需要创建独立线程+runtime
#[cfg(feature = "tauri-app")]
pub fn start_bridge_server_with_app(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("[fd-bridge] Failed to create Tokio runtime");
        rt.block_on(async move {
            let router = shadow_handlers::build_router_with_shadow(app_handle);
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
            eprintln!("[fd-bridge] HTTP server (with Shadow Agent) listening on http://{}", addr);

            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    if let Err(e) = axum::serve(listener, router).await {
                        eprintln!("[fd-bridge] Server error: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("[fd-bridge] Failed to bind port {}: {}", addr, e);
                }
            }
        });
    });
}
