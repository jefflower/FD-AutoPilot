//! Bridge HTTP server module.
//!
//! Provides the HTTP server that exposes Agent execution, capability detection,
//! execution logs, and (in Tauri mode) Shadow Agent SSE endpoints.
//!
//! ## Module structure
//!
//! - `types`          -- All request/response DTOs
//! - `agent_handler`  -- Gemini CLI, NotebookLM-py, translate handlers
//! - `system_handler` -- Health check, capability detection
//! - `exec_log_handler` -- Execution log CRUD
//! - `shadow_handler` -- Shadow Agent SSE (Tauri-only)

pub mod types;
pub mod agent_handler;
pub mod system_handler;
pub mod exec_log_handler;
pub mod rust_log_handler;
pub mod shadow_handler;

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tokio::time::Duration;
use tower_http::cors::{Any, CorsLayer};

use crate::execution_log::ExecLogStore;

// ========== Shared State ==========

/// Non-Tauri shared state: holds the ExecLogStore.
#[derive(Clone)]
pub struct LogState {
    pub log_store: Arc<ExecLogStore>,
}

// ========== Server Startup Helpers ==========

/// Initialize ExecLogStore, panicking on failure (called at startup).
pub fn init_log_store() -> Arc<ExecLogStore> {
    match ExecLogStore::open() {
        Ok(store) => Arc::new(store),
        Err(e) => {
            eprintln!(
                "[ExecLog] FATAL: Failed to initialize log store: {}. Server cannot start without log store.",
                e
            );
            panic!("[ExecLog] Cannot create execution log store: {}", e);
        }
    }
}

/// Spawn a background task that runs cleanup every hour.
fn spawn_cleanup_task(log_store: Arc<ExecLogStore>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match log_store.cleanup() {
                Ok(count) if count > 0 => {
                    eprintln!("[ExecLog] Cleaned up {} expired logs", count)
                }
                Err(e) => eprintln!("[ExecLog] Cleanup error: {}", e),
                _ => {}
            }
        }
    });
}

/// Build the standalone Router (no Shadow Agent support).
fn build_router(log_store: Arc<ExecLogStore>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = LogState { log_store };

    Router::new()
        .route("/bridge/health", get(system_handler::health_handler))
        .route("/bridge/translate", post(agent_handler::translate_handler))
        .route("/bridge/gemini", post(agent_handler::gemini_handler))
        .route("/bridge/claude", post(agent_handler::claude_handler))
        .route(
            "/bridge/sync-translate",
            post(agent_handler::sync_translate_handler),
        )
        .route(
            "/bridge/notebooklm-py",
            post(agent_handler::notebooklm_py_handler),
        )
        .route(
            "/bridge/notebooklm-rag",
            post(agent_handler::notebooklm_rag_handler),
        )
        .route(
            "/bridge/notebooklm-cli",
            post(agent_handler::notebooklm_cli_handler),
        )
        .route(
            "/bridge/antigravity",
            post(agent_handler::antigravity_handler),
        )
        .route(
            "/bridge/capabilities/detect",
            get(system_handler::capabilities_detect_handler),
        )
        .route(
            "/bridge/capabilities/skills",
            get(system_handler::skills_detect_handler),
        )
        .route(
            "/bridge/capabilities/models",
            get(system_handler::models_detect_handler),
        )
        // Exec Log endpoints
        .route("/bridge/exec-logs", get(exec_log_handler::list_exec_logs))
        .route(
            "/bridge/exec-logs/config",
            get(exec_log_handler::get_exec_log_config)
                .put(exec_log_handler::set_exec_log_config),
        )
        .route(
            "/bridge/exec-logs/cleanup",
            post(exec_log_handler::cleanup_exec_logs),
        )
        .route(
            "/bridge/exec-logs/{id}",
            get(exec_log_handler::get_exec_log_detail),
        )
        // Rust runtime logs (stateless, uses global RustLogCollector)
        .route("/bridge/rust-logs", get(rust_log_handler::list_rust_logs))
        .route(
            "/bridge/rust-logs/clear",
            post(rust_log_handler::clear_rust_logs),
        )
        .with_state(state)
        .layer(cors)
}

// ========== Public Server Entry Points ==========

/// Standalone mode: blocking HTTP server start (for fd-bridge binary, no Shadow support).
pub async fn run_standalone() {
    let log_store = init_log_store();
    spawn_cleanup_task(log_store.clone());

    let router = build_router(log_store);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
    rlog_info!("[fd-bridge] Standalone HTTP server listening on http://{}", addr);
    rlog_info!("[fd-bridge] Note: Shadow Window agents require Tauri desktop mode (npm run tauri dev)");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect(&format!("[fd-bridge] Failed to bind port {}", addr));
    axum::serve(listener, router)
        .await
        .expect("[fd-bridge] Server error");
}

/// Background mode (no AppHandle): CLI Agent endpoints only.
pub fn start_bridge_server() {
    tokio::spawn(async move {
        let log_store = init_log_store();
        spawn_cleanup_task(log_store.clone());

        let router = build_router(log_store);
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
        rlog_info!("[fd-bridge] HTTP server listening on http://{}", addr);

        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router).await {
                    rlog_error!("[fd-bridge] Server error: {}", e);
                }
            }
            Err(e) => {
                rlog_error!("[fd-bridge] Failed to bind port {}: {}", addr, e);
            }
        }
    });
}

/// Background mode (with AppHandle): CLI + Shadow Agent full endpoints.
/// Accepts a pre-created `Arc<ExecLogStore>` so the same store is shared
/// between the Bridge HTTP server and Tauri IPC commands.
/// Note: Tauri setup hook has no Tokio runtime, so we spawn an independent thread+runtime.
#[cfg(feature = "tauri-app")]
pub fn start_bridge_server_with_app(app_handle: tauri::AppHandle, log_store: Arc<ExecLogStore>) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new()
            .expect("[fd-bridge] Failed to create Tokio runtime");
        rt.block_on(async move {
            spawn_cleanup_task(log_store.clone());

            let router =
                shadow_handler::inner::build_router_with_shadow(app_handle, log_store);
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 9987));
            rlog_info!(
                "[fd-bridge] HTTP server (with Shadow Agent) listening on http://{}",
                addr
            );

            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    if let Err(e) = axum::serve(listener, router).await {
                        rlog_error!("[fd-bridge] Server error: {}", e);
                    }
                }
                Err(e) => {
                    rlog_error!("[fd-bridge] Failed to bind port {}: {}", addr, e);
                }
            }
        });
    });
}
