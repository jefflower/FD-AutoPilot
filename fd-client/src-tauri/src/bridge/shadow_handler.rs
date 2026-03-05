//! Shadow Agent SSE HTTP handler (Tauri-only).
//!
//! Provides the `/bridge/agents/reply` SSE endpoint that orchestrates the
//! NotebookLM Shadow Window via Tauri's AppHandle.

#[cfg(feature = "tauri-app")]
pub mod inner {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use axum::extract::{Json, Path, Query, State};
    use axum::response::sse::{Event, KeepAlive, Sse};
    use axum::routing::{get, post};
    use axum::Router;
    use tokio::sync::mpsc;
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;
    use tower_http::cors::{Any, CorsLayer};

    use crate::execution_log::{ExecLogConfig, ExecLogEntry};
    use crate::shadow_agent::engine::{NotebookAgent, ReplyRequest, ShadowEvent};

    use crate::bridge::types::*;
    use crate::bridge::{agent_handler, exec_log_handler, system_handler, LogState};
    use crate::execution_log::ExecLogStore;

    /// Axum shared state for shadow-enabled router: holds Tauri AppHandle + ExecLogStore.
    #[derive(Clone)]
    pub struct AppState {
        pub app_handle: tauri::AppHandle,
        pub log_store: Arc<ExecLogStore>,
    }

    /// Convert AppState to LogState for handlers that only need log_store.
    impl From<AppState> for LogState {
        fn from(s: AppState) -> Self {
            LogState {
                log_store: s.log_store,
            }
        }
    }

    /// SSE endpoint: /bridge/agents/reply
    /// Receives ReplyRequest, starts NotebookLM Shadow Agent, streams results via SSE.
    pub async fn reply_sse_handler(
        State(state): State<AppState>,
        Json(req): Json<ReplyRequest>,
    ) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
        eprintln!(
            "[fd-bridge] POST /bridge/agents/reply: notebook_id={}, messages={}, notebook_url={:?}",
            req.notebook_id,
            req.messages.len(),
            req.notebook_url
        );

        let (tx, rx) = mpsc::channel::<ShadowEvent>(32);

        let agent = Arc::new(NotebookAgent::new(state.app_handle.clone(), &req));

        let log_store = state.log_store.clone();
        let start = std::time::Instant::now();
        let input_json = serde_json::json!({
            "notebookId": req.notebook_id,
            "messageCount": req.messages.len(),
            "notebookUrl": req.notebook_url,
        })
        .to_string();
        let notebook_id = req.notebook_id.clone();

        // Track whether any error event was sent during execution
        let has_error = Arc::new(AtomicBool::new(false));
        let has_error_for_spawn = has_error.clone();
        let error_msg_holder: Arc<std::sync::Mutex<Option<String>>> =
            Arc::new(std::sync::Mutex::new(None));
        let error_msg_for_spawn = error_msg_holder.clone();

        tokio::spawn(async move {
            eprintln!("[fd-bridge] Shadow Agent task spawned");

            // Use an intermediate channel to intercept events and detect errors
            let (inner_tx, mut inner_rx) = mpsc::channel::<ShadowEvent>(32);
            let tx_clone = tx.clone();
            let error_flag = has_error_for_spawn.clone();
            let error_msg_capture = error_msg_for_spawn.clone();

            // Forwarder task: relay events from inner channel to SSE channel, tracking errors
            let forwarder = tokio::spawn(async move {
                while let Some(event) = inner_rx.recv().await {
                    if let ShadowEvent::Error { ref message } = event {
                        error_flag.store(true, Ordering::SeqCst);
                        if let Ok(mut guard) = error_msg_capture.lock() {
                            *guard = Some(message.clone());
                        }
                    }
                    if tx_clone.send(event).await.is_err() {
                        break; // SSE client disconnected
                    }
                }
            });

            agent.execute(req, inner_tx).await;
            eprintln!("[fd-bridge] Shadow Agent task completed");

            // Wait for forwarder to finish relaying buffered events
            let _ = forwarder.await;

            let duration = start.elapsed().as_millis() as i64;
            let errored = has_error_for_spawn.load(Ordering::SeqCst);
            let error_message = error_msg_for_spawn.lock().ok().and_then(|g| g.clone());
            let entry = ExecLogEntry {
                id: None,
                agent_code: "ticket-reply".to_string(),
                status: if errored { "error" } else { "success" }.to_string(),
                command: Some(format!(
                    "shadow-agent reply (notebook: {})",
                    notebook_id
                )),
                input_params: Some(input_json),
                stdout: None,
                stderr: None,
                error_msg: error_message,
                duration_ms: Some(duration),
                ref_type: None,
                ref_id: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            if let Err(e) = log_store.insert(&entry) {
                eprintln!("[ExecLog] Failed to insert shadow-agent log: {}", e);
            }
        });

        let mut event_count: u64 = 0;
        let stream = ReceiverStream::new(rx).map(move |event| {
            event_count += 1;
            let json = serde_json::to_string(&event).unwrap_or_default();
            let event_type = match &event {
                ShadowEvent::Streaming { text } => {
                    if event_count <= 3 || event_count % 10 == 0 {
                        eprintln!(
                            "[fd-bridge] SSE #{}: streaming, text_len={}",
                            event_count,
                            text.len()
                        );
                    }
                    "streaming"
                }
                ShadowEvent::Complete { text } => {
                    eprintln!(
                        "[fd-bridge] SSE #{}: COMPLETE, text_len={}",
                        event_count,
                        text.len()
                    );
                    "complete"
                }
                ShadowEvent::Error { message } => {
                    eprintln!("[fd-bridge] SSE #{}: ERROR: {}", event_count, message);
                    "error"
                }
                ShadowEvent::Log { message } => {
                    eprintln!("[fd-bridge] SSE #{}: log: {}", event_count, message);
                    "log"
                }
            };
            Ok(Event::default().event(event_type).data(json))
        });

        Sse::new(stream).keep_alive(KeepAlive::default())
    }

    // ========== Wrapper handlers: AppState -> LogState delegation ==========

    async fn translate_handler_shadow(
        State(state): State<AppState>,
        body: Json<TranslateRequest>,
    ) -> TicketResult {
        agent_handler::translate_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn gemini_handler_shadow(
        State(state): State<AppState>,
        body: Json<GeminiRequest>,
    ) -> StringResult {
        agent_handler::gemini_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn claude_handler_shadow(
        State(state): State<AppState>,
        body: Json<ClaudeRequest>,
    ) -> StringResult {
        agent_handler::claude_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn sync_translate_handler_shadow(
        State(state): State<AppState>,
        body: Json<SyncTranslateRequest>,
    ) -> StringResult {
        agent_handler::sync_translate_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn notebooklm_py_handler_shadow(
        State(state): State<AppState>,
        body: Json<NotebookLmPyRequest>,
    ) -> StringResult {
        agent_handler::notebooklm_py_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn notebooklm_cli_handler_shadow(
        State(state): State<AppState>,
        body: Json<NotebookLmCliRequest>,
    ) -> JsonResult {
        agent_handler::notebooklm_cli_handler(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn list_exec_logs_shadow(
        State(state): State<AppState>,
        query: Query<ExecLogQueryParams>,
    ) -> LogPageResult {
        exec_log_handler::list_exec_logs(
            State(LogState {
                log_store: state.log_store,
            }),
            query,
        )
        .await
    }

    async fn get_exec_log_detail_shadow(
        State(state): State<AppState>,
        path: Path<i64>,
    ) -> LogEntryResult {
        exec_log_handler::get_exec_log_detail(
            State(LogState {
                log_store: state.log_store,
            }),
            path,
        )
        .await
    }

    async fn get_exec_log_config_shadow(
        State(state): State<AppState>,
        query: Query<ExecLogConfigQueryParams>,
    ) -> LogConfigResult {
        exec_log_handler::get_exec_log_config(
            State(LogState {
                log_store: state.log_store,
            }),
            query,
        )
        .await
    }

    async fn set_exec_log_config_shadow(
        State(state): State<AppState>,
        body: Json<ExecLogConfig>,
    ) -> UnitResult {
        exec_log_handler::set_exec_log_config(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    async fn cleanup_exec_logs_shadow(
        State(state): State<AppState>,
        body: Option<Json<CleanupRequest>>,
    ) -> U32Result {
        exec_log_handler::cleanup_exec_logs(
            State(LogState {
                log_store: state.log_store,
            }),
            body,
        )
        .await
    }

    /// Build Router with Shadow Agent endpoints (Tauri desktop mode).
    pub fn build_router_with_shadow(
        app_handle: tauri::AppHandle,
        log_store: Arc<ExecLogStore>,
    ) -> Router {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let state = AppState {
            app_handle,
            log_store,
        };

        Router::new()
            .route("/bridge/health", get(system_handler::health_handler))
            .route("/bridge/translate", post(translate_handler_shadow))
            .route("/bridge/gemini", post(gemini_handler_shadow))
            .route("/bridge/claude", post(claude_handler_shadow))
            .route(
                "/bridge/sync-translate",
                post(sync_translate_handler_shadow),
            )
            .route("/bridge/notebooklm-py", post(notebooklm_py_handler_shadow))
            .route("/bridge/notebooklm-cli", post(notebooklm_cli_handler_shadow))
            .route(
                "/bridge/capabilities/detect",
                get(system_handler::capabilities_detect_handler),
            )
            .route(
                "/bridge/capabilities/skills",
                get(system_handler::skills_detect_handler),
            )
            // Shadow Agent SSE endpoint
            .route("/bridge/agents/reply", post(reply_sse_handler))
            // Exec Log endpoints
            .route("/bridge/exec-logs", get(list_exec_logs_shadow))
            .route(
                "/bridge/exec-logs/config",
                get(get_exec_log_config_shadow).put(set_exec_log_config_shadow),
            )
            .route(
                "/bridge/exec-logs/cleanup",
                post(cleanup_exec_logs_shadow),
            )
            .route(
                "/bridge/exec-logs/{id}",
                get(get_exec_log_detail_shadow),
            )
            // Rust runtime logs (stateless, uses global RustLogCollector)
            .route(
                "/bridge/rust-logs",
                get(crate::bridge::rust_log_handler::list_rust_logs),
            )
            .route(
                "/bridge/rust-logs/clear",
                post(crate::bridge::rust_log_handler::clear_rust_logs),
            )
            .with_state(state)
            .layer(cors)
    }
}
