//! NotebookLM Shadow Agent — Rust 编排引擎
//!
//! 将 NotebookLM Shadow Window 的编排逻辑从前端 JS 迁移到 Rust，
//! 通过 Tauri AppHandle 直接操作 WebView，支持通过 HTTP SSE 流式输出结果。
//!
//! 编排流程：
//! 1. 打开（或复用）Shadow Window（notebooklm.google.com）
//! 2. 注入清理历史脚本（forceClear）
//! 3. 注入发送消息脚本
//! 4. 注入 observer 脚本（DOM 监控）
//! 5. 定期注入 relay 脚本，收集结果
//! 6. 通过 SSE channel 推送流式结果
//!
//! 仅在 `tauri-app` feature 下编译。

#[cfg(feature = "tauri-app")]
pub mod engine {
    use serde::{Deserialize, Serialize};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::{AppHandle, Listener, Manager};
    use tokio::sync::mpsc;

    /// SSE 事件类型
    #[derive(Debug, Clone, Serialize)]
    #[serde(tag = "type")]
    pub enum ShadowEvent {
        #[serde(rename = "streaming")]
        Streaming { text: String },
        #[serde(rename = "complete")]
        Complete { text: String },
        #[serde(rename = "error")]
        Error { message: String },
        #[serde(rename = "log")]
        Log { message: String },
    }

    /// Shadow Agent 请求参数
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ReplyRequest {
        pub notebook_id: String,
        pub notebook_url: Option<String>,
        pub messages: Vec<String>,
        #[serde(default)]
        pub selectors: Option<serde_json::Value>,
        #[serde(default)]
        pub timeouts: Option<TimeoutConfig>,
        #[serde(default)]
        pub clear_config: Option<ClearConfig>,
    }

    #[derive(Debug, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct TimeoutConfig {
        pub page_load_ms: Option<u64>,
        pub clear_max_ms: Option<u64>,
        pub ack_timeout_ms: Option<u64>,
        pub no_response_timeout_ms: Option<u64>,
        pub silence_timeout_ms: Option<u64>,
        pub relay_interval_ms: Option<u64>,
        pub inter_message_delay_ms: Option<u64>,
        pub finished_confirm_ms: Option<u64>,
    }

    #[derive(Debug, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ClearConfig {
        pub enabled: Option<bool>,
        pub max_retries: Option<u32>,
        pub wait_after_delete_ms: Option<u64>,
    }

    /// 默认选择器（NotebookLM 页面 DOM 结构）
    fn default_selectors() -> serde_json::Value {
        serde_json::json!({
            "INPUT": "textarea.query-box-input",
            "CHAT_PAIR": ".chat-message-pair",
            "CHAT_PAIR_ALT": "[role=\"log\"] .message-content",
            "BOT_REPLY": ".to-user-container .message-text-content",
            "BOT_REPLY_FALLBACK_1": ".model-response-text",
            "BOT_REPLY_FALLBACK_2": ".response-container",
            "COPY_BUTTON": ".xap-copy-to-clipboard",
            "SEND_BUTTON": "button.submit-button:not([disabled])",
            "MENU_BUTTON": "button[aria-label=\"对话选项\"]",
            "CONFIRM_DELETE": "button.yes-button"
        })
    }

    /// Shadow Window 初始化脚本（与 lib.rs 中一致）
    const SHADOW_INIT_SCRIPT: &str = r#"
        (function() {
            console.log('[Shadow] initialization script running...');
            window.__TAURI_SHADOW__ = true;
            function waitForTauri(callback) {
                if (window.__TAURI_INTERNALS__) {
                    window.__TAURI__ = {
                        core: {
                            invoke: function(cmd, args) {
                                return window.__TAURI_INTERNALS__.invoke(cmd, args);
                            }
                        }
                    };
                    console.log('[Shadow] IPC bridge ready');
                    callback();
                } else {
                    setTimeout(() => waitForTauri(callback), 100);
                }
            }
            waitForTauri(function() {
                console.log('[Shadow] state fully initialized');
            });
        })();
    "#;

    /// 短 session id 用于日志（取最后 6 位）
    fn short_sid(sid: &str) -> &str {
        &sid[sid.len().saturating_sub(6)..]
    }

    /// 解析事件 payload（处理双重 JSON 转义）
    fn parse_event_payload(raw: &str) -> Option<serde_json::Value> {
        // 尝试直接解析
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
            return Some(v);
        }
        // 尝试去除外层引号后解析（双重转义场景）
        if let Some(inner) = raw.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            if let Ok(unescaped) = serde_json::from_str::<String>(&format!("\"{}\"", inner)) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&unescaped) {
                    return Some(v);
                }
            }
        }
        None
    }

    /// NotebookLM Shadow Agent 编排引擎
    pub struct NotebookAgent {
        app: AppHandle,
        session_id: String,
        selectors: serde_json::Value,
        timeouts: TimeoutConfig,
        clear_config: ClearConfig,
    }

    impl NotebookAgent {
        pub fn new(app: AppHandle, req: &ReplyRequest) -> Self {
            let session_id = format!(
                "session_{}_{}",
                chrono::Utc::now().timestamp_millis(),
                &uuid::Uuid::new_v4().to_string()[..8]
            );

            let mut selectors = default_selectors();
            if let Some(custom) = &req.selectors {
                if let (Some(base), Some(custom)) = (selectors.as_object_mut(), custom.as_object()) {
                    for (k, v) in custom {
                        base.insert(k.clone(), v.clone());
                    }
                }
            }

            let timeouts = req.timeouts.clone().unwrap_or(TimeoutConfig {
                page_load_ms: None,
                clear_max_ms: None,
                ack_timeout_ms: None,
                no_response_timeout_ms: None,
                silence_timeout_ms: None,
                relay_interval_ms: None,
                inter_message_delay_ms: None,
                finished_confirm_ms: None,
            });

            let clear_config = req.clear_config.clone().unwrap_or(ClearConfig {
                enabled: None,
                max_retries: None,
                wait_after_delete_ms: None,
            });

            eprintln!("[ShadowAgent:{}] Created new agent for notebook: {}", short_sid(&session_id), req.notebook_id);

            Self {
                app,
                session_id,
                selectors,
                timeouts,
                clear_config,
            }
        }

        /// 执行完整编排流程，通过 tx 发送 SSE 事件
        pub async fn execute(
            self: Arc<Self>,
            req: ReplyRequest,
            tx: mpsc::Sender<ShadowEvent>,
        ) {
            let sid = short_sid(&self.session_id);
            eprintln!("[ShadowAgent:{}] ========== Execute START ==========", sid);
            eprintln!("[ShadowAgent:{}] notebook_id={}, messages={}, notebook_url={:?}",
                sid, req.notebook_id, req.messages.len(), req.notebook_url);

            // Step 1: 打开 Shadow Window
            self.log(&tx, &format!("Step 1/4: Opening shadow window for notebook: {}", req.notebook_id)).await;
            if let Err(e) = self.open_shadow_window(&req.notebook_id, req.notebook_url.as_deref()).await {
                eprintln!("[ShadowAgent:{}] FATAL: Failed to open shadow window: {}", sid, e);
                let _ = tx.send(ShadowEvent::Error { message: format!("Failed to open shadow window: {}", e) }).await;
                return;
            }
            eprintln!("[ShadowAgent:{}] Shadow window opened successfully", sid);

            // 等待页面加载
            let page_load_ms = self.timeouts.page_load_ms.unwrap_or(3000);
            eprintln!("[ShadowAgent:{}] Waiting {}ms for page load...", sid, page_load_ms);
            tokio::time::sleep(Duration::from_millis(page_load_ms)).await;

            // Step 2: 清理历史
            self.log(&tx, "Step 2/4: Clearing history...").await;
            if let Err(e) = self.clear_history().await {
                eprintln!("[ShadowAgent:{}] FATAL: Clear history failed: {}", sid, e);
                let _ = tx.send(ShadowEvent::Error { message: format!("Clear history failed: {}", e) }).await;
                return;
            }
            eprintln!("[ShadowAgent:{}] History cleared", sid);

            let messages = &req.messages;
            if messages.is_empty() {
                eprintln!("[ShadowAgent:{}] ERROR: No messages to send", sid);
                let _ = tx.send(ShadowEvent::Error { message: "No messages to send".into() }).await;
                return;
            }

            // Step 3: 多轮消息发送
            if messages.len() > 1 {
                self.log(&tx, &format!("Step 3/4: Sending {} intermediate messages...", messages.len() - 1)).await;
                // 前 N-1 条：发送 + 简化等待
                for (i, msg) in messages[..messages.len() - 1].iter().enumerate() {
                    eprintln!("[ShadowAgent:{}] Sending intermediate message {}/{}, length={}",
                        sid, i + 1, messages.len() - 1, msg.len());
                    self.log(&tx, &format!("Sending intermediate message {}/{}", i + 1, messages.len() - 1)).await;

                    let pair_count_before = self.get_chat_pair_count().await;
                    eprintln!("[ShadowAgent:{}] Current pair count before send: {}", sid, pair_count_before);

                    if let Err(e) = self.inject_send_script(msg).await {
                        eprintln!("[ShadowAgent:{}] FATAL: Send failed: {}", sid, e);
                        let _ = tx.send(ShadowEvent::Error { message: format!("Send failed: {}", e) }).await;
                        return;
                    }

                    let ack_timeout = self.timeouts.ack_timeout_ms.unwrap_or(30000);
                    eprintln!("[ShadowAgent:{}] Waiting for ack (expecting {} pairs, timeout {}ms)...",
                        sid, pair_count_before + 1, ack_timeout);
                    let acked = self.wait_for_ack(pair_count_before + 1, ack_timeout).await;
                    if !acked {
                        eprintln!("[ShadowAgent:{}] WARNING: Intermediate message {} ack timeout", sid, i + 1);
                        self.log(&tx, &format!("Intermediate message {} ack timeout, continuing...", i + 1)).await;
                    } else {
                        eprintln!("[ShadowAgent:{}] Intermediate message {} acked", sid, i + 1);
                    }

                    let delay = self.timeouts.inter_message_delay_ms.unwrap_or(1000);
                    eprintln!("[ShadowAgent:{}] Inter-message delay: {}ms", sid, delay);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }

            // Step 4: 发送最后一条 + observer + relay
            let last_msg = &messages[messages.len() - 1];
            self.log(&tx, &format!("Step 4/4: Sending final message, length={}", last_msg.len())).await;
            eprintln!("[ShadowAgent:{}] Sending final message, length={}", sid, last_msg.len());

            if let Err(e) = self.inject_send_script(last_msg).await {
                eprintln!("[ShadowAgent:{}] FATAL: Final send failed: {}", sid, e);
                let _ = tx.send(ShadowEvent::Error { message: format!("Send failed: {}", e) }).await;
                return;
            }

            // 初始 streaming 事件
            let _ = tx.send(ShadowEvent::Streaming { text: String::new() }).await;

            // observer + relay 循环
            eprintln!("[ShadowAgent:{}] Starting observe_and_relay loop...", sid);
            self.observe_and_relay(&tx).await;

            eprintln!("[ShadowAgent:{}] ========== Execute END ==========", sid);
            self.log(&tx, &format!("[{}] Session complete", sid)).await;
        }

        // ========== 内部方法 ==========

        async fn log(&self, tx: &mpsc::Sender<ShadowEvent>, msg: &str) {
            eprintln!("[ShadowAgent:{}] LOG: {}", short_sid(&self.session_id), msg);
            let _ = tx.send(ShadowEvent::Log { message: msg.to_string() }).await;
        }

        async fn eval_js(&self, script: &str) -> Result<(), String> {
            if let Some(window) = self.app.get_webview_window("notebook_shadow") {
                window.eval(script).map_err(|e| e.to_string())
            } else {
                Err("Shadow window not found".to_string())
            }
        }

        async fn open_shadow_window(&self, notebook_id: &str, notebook_url: Option<&str>) -> Result<(), String> {
            let sid = short_sid(&self.session_id);
            let url = match notebook_url {
                Some(u) if !u.is_empty() => u.to_string(),
                _ => format!("https://notebooklm.google.com/notebook/{}", notebook_id),
            };
            let label = "notebook_shadow";

            eprintln!("[ShadowAgent:{}] open_shadow_window: label={}, url={}", sid, label, url);

            if let Some(window) = self.app.get_webview_window(label) {
                let current_url = window.url().map_err(|e| e.to_string())?;
                eprintln!("[ShadowAgent:{}] Window exists, current_url={}", sid, current_url.as_str());
                if current_url.as_str() != url {
                    eprintln!("[ShadowAgent:{}] URL mismatch, navigating to: {}", sid, url);
                    window.navigate(url.parse().unwrap()).map_err(|e| e.to_string())?;
                } else {
                    eprintln!("[ShadowAgent:{}] URL matches, reusing window", sid);
                }
                return Ok(());
            }

            eprintln!("[ShadowAgent:{}] Creating new shadow window...", sid);
            use tauri::{WebviewWindowBuilder, WebviewUrl};
            let _window = WebviewWindowBuilder::new(
                &self.app,
                label,
                WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Shadow: notebook_shadow".to_string())
            .inner_size(1280.0, 1000.0)
            .visible(false)
            .initialization_script(SHADOW_INIT_SCRIPT)
            .build()
            .map_err(|e| e.to_string())?;

            eprintln!("[ShadowAgent:{}] Shadow window created", sid);
            Ok(())
        }

        async fn clear_history(&self) -> Result<(), String> {
            let sid = short_sid(&self.session_id);
            let clear_enabled = self.clear_config.enabled.unwrap_or(true);
            let max_retries = self.clear_config.max_retries.unwrap_or(3);
            let wait_after_delete_ms = self.clear_config.wait_after_delete_ms.unwrap_or(2500);
            let clear_max_ms = self.timeouts.clear_max_ms.unwrap_or(15000);
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();
            let full_sid = &self.session_id;

            eprintln!("[ShadowAgent:{}] clear_history: enabled={}, max_retries={}, clear_max_ms={}",
                sid, clear_enabled, max_retries, clear_max_ms);

            // 重置状态脚本（所有情况都需要）
            let reset_script = format!(r#"
                (function() {{
                    window.__SHADOW_SESSION_ID = "{}";
                    window.__SHADOW_SESSION_ACTIVE = false;
                    window.__SHADOW_LAST_TEXT = "";
                    window.__SHADOW_LAST_BOT_IDLE = false;
                    window.__SHADOW_BOT_RESPONDED = false;
                    window.__SHADOW_HEARTBEAT = 0;
                    window.__SHADOW_LATEST_RESULT = null;
                    if (window.__SHADOW_POLL_INTERVAL) {{
                        clearInterval(window.__SHADOW_POLL_INTERVAL);
                        window.__SHADOW_POLL_INTERVAL = null;
                    }}
                    {}
                }})();
            "#, full_sid, if !clear_enabled { "window.__SHADOW_CLEAR_DONE = true;" } else { "window.__SHADOW_CLEAR_DONE = false;" });

            self.eval_js(&reset_script).await?;
            eprintln!("[ShadowAgent:{}] State reset done", sid);

            if !clear_enabled {
                eprintln!("[ShadowAgent:{}] Clear disabled, skipping", sid);
                return Ok(());
            }

            // 完整清理脚本
            let clear_script = format!(r#"
                (async function() {{
                    const SEL = {selectors};
                    const MAX_RETRIES = {max_retries};
                    const WAIT_AFTER_DELETE_MS = {wait_after_delete};

                    async function forceClear() {{
                        await new Promise(r => setTimeout(r, 1500));
                        for (let i = 0; i < MAX_RETRIES; i++) {{
                            const pairs = document.querySelectorAll(SEL.CHAT_PAIR + ', ' + SEL.CHAT_PAIR_ALT);
                            if (pairs.length === 0) return true;

                            const menuBtn = document.querySelector(SEL.MENU_BUTTON) ||
                                Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('more_vert'));
                            if (!menuBtn) {{ await new Promise(r => setTimeout(r, 1000)); continue; }}

                            menuBtn.click();
                            await new Promise(r => setTimeout(r, 800));

                            const delItem = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')).find(el =>
                                el.innerText.includes('删除对话记录') || el.innerText.includes('Delete') || el.innerText.includes('清除')
                            );

                            if (delItem) {{
                                delItem.click();
                                await new Promise(r => setTimeout(r, 1000));
                                const confirm = document.querySelector(SEL.CONFIRM_DELETE) ||
                                    Array.from(document.querySelectorAll('button')).find(el =>
                                        (el.innerText.includes('删除') || el.innerText.includes('Delete')) && el.classList.contains('mat-mdc-button-base')
                                    );
                                if (confirm) {{
                                    confirm.click();
                                    await new Promise(r => setTimeout(r, WAIT_AFTER_DELETE_MS));
                                    if (document.querySelectorAll(SEL.CHAT_PAIR).length === 0) return true;
                                }}
                            }} else {{
                                document.body.click();
                            }}
                            await new Promise(r => setTimeout(r, 1000));
                        }}
                        return false;
                    }}

                    await forceClear();
                    window.__SHADOW_CLEAR_DONE = true;
                }})();
            "#, selectors = selectors_json, max_retries = max_retries, wait_after_delete = wait_after_delete_ms);

            self.eval_js(&clear_script).await?;
            eprintln!("[ShadowAgent:{}] Clear script injected, polling for completion...", sid);

            // 轮询等待清理完成
            let start = std::time::Instant::now();
            let max_wait = Duration::from_millis(clear_max_ms);
            let mut poll_count = 0;
            while start.elapsed() < max_wait {
                poll_count += 1;

                let check_script = r#"
                    (function() {
                        var done = !!window.__SHADOW_CLEAR_DONE;
                        if (window.__TAURI__ && window.__TAURI__.core) {
                            window.__TAURI__.core.invoke('forward_shadow_event', {
                                event: 'shadow-clear-status',
                                payload: JSON.stringify({ done: done })
                            }).catch(function(){});
                        } else if (window.__TAURI_INTERNALS__) {
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
                                event: 'shadow-clear-status',
                                payload: JSON.stringify({ done: done })
                            }).catch(function(){});
                        }
                    })();
                "#;

                // FIX: 先注册监听器，再注入脚本（避免竞态）
                let (done_tx, mut done_rx) = mpsc::channel::<bool>(1);
                let unlisten = {
                    let done_tx = done_tx.clone();
                    self.app.listen("shadow-clear-status", move |event| {
                        if let Some(parsed) = parse_event_payload(event.payload()) {
                            if parsed.get("done").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let _ = done_tx.try_send(true);
                            }
                        }
                    })
                };

                self.eval_js(check_script).await.ok();

                tokio::select! {
                    result = done_rx.recv() => {
                        self.app.unlisten(unlisten);
                        if result == Some(true) {
                            eprintln!("[ShadowAgent:{}] Clear completed after {}ms ({} polls)",
                                sid, start.elapsed().as_millis(), poll_count);
                            return Ok(());
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        self.app.unlisten(unlisten);
                    }
                }
            }

            // 超时后继续（清理可能未完成，但不阻塞流程）
            eprintln!("[ShadowAgent:{}] WARNING: Clear timeout after {}ms ({} polls), proceeding anyway",
                sid, clear_max_ms, poll_count);
            Ok(())
        }

        async fn inject_send_script(&self, text: &str) -> Result<(), String> {
            let sid = short_sid(&self.session_id);
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();
            let text_json = serde_json::to_string(text).unwrap();

            eprintln!("[ShadowAgent:{}] inject_send_script: text_length={}", sid, text.len());

            let script = format!(r#"
                (async function() {{
                    const SEL = {selectors};
                    let input = null;
                    for (let retry = 0; retry < 10; retry++) {{
                        input = document.querySelector(SEL.INPUT);
                        if (input) break;
                        await new Promise(r => setTimeout(r, 1000));
                    }}
                    if (!input) {{ window.__SHADOW_SEND_FAILED = true; return; }}

                    try {{
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        nativeSetter.call(input, {text});
                    }} catch(e) {{
                        input.value = {text};
                    }}
                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    input.dispatchEvent(new KeyboardEvent('keydown', {{ bubbles: true, key: 'a' }}));
                    input.dispatchEvent(new KeyboardEvent('keyup', {{ bubbles: true, key: 'a' }}));
                    await new Promise(r => setTimeout(r, 800));

                    let sendBtn = null;
                    for (let retry = 0; retry < 10; retry++) {{
                        sendBtn = document.querySelector(SEL.SEND_BUTTON) ||
                            Array.from(document.querySelectorAll('button')).find(b =>
                                (b.innerHTML.includes('arrow_forward') || b.innerHTML.includes('send')) && !b.disabled
                            );
                        if (sendBtn) break;
                        await new Promise(r => setTimeout(r, 500));
                    }}

                    if (sendBtn) {{
                        sendBtn.click();
                        window.__SHADOW_SESSION_ACTIVE = true;
                        window.__SHADOW_SEND_FAILED = false;
                    }} else {{
                        window.__SHADOW_SEND_FAILED = true;
                    }}
                }})();
            "#, selectors = selectors_json, text = text_json);

            self.eval_js(&script).await?;
            eprintln!("[ShadowAgent:{}] Send script injected", sid);
            Ok(())
        }

        async fn get_chat_pair_count(&self) -> u32 {
            let sid = short_sid(&self.session_id);
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();

            // FIX: 先注册监听器，再注入脚本
            let (count_tx, mut count_rx) = mpsc::channel::<u32>(1);
            let unlisten = {
                self.app.listen("shadow-pair-count", move |event| {
                    if let Some(parsed) = parse_event_payload(event.payload()) {
                        if let Some(count) = parsed.get("count").and_then(|v| v.as_u64()) {
                            let _ = count_tx.try_send(count as u32);
                        }
                    }
                })
            };

            let script = format!(r#"
                (function() {{
                    const SEL = {};
                    var count = document.querySelectorAll(SEL.CHAT_PAIR).length;
                    if (window.__TAURI__ && window.__TAURI__.core) {{
                        window.__TAURI__.core.invoke('forward_shadow_event', {{
                            event: 'shadow-pair-count',
                            payload: JSON.stringify({{ count: count }})
                        }}).catch(function(){{}});
                    }} else if (window.__TAURI_INTERNALS__) {{
                        window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                            event: 'shadow-pair-count',
                            payload: JSON.stringify({{ count: count }})
                        }}).catch(function(){{}});
                    }}
                }})();
            "#, selectors_json);

            self.eval_js(&script).await.ok();

            let result = tokio::select! {
                r = count_rx.recv() => r.unwrap_or(0),
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    eprintln!("[ShadowAgent:{}] get_chat_pair_count: timeout, defaulting to 0", sid);
                    0
                },
            };

            self.app.unlisten(unlisten);
            eprintln!("[ShadowAgent:{}] get_chat_pair_count: result={}", sid, result);
            result
        }

        async fn wait_for_ack(&self, expected_pair_count: u32, timeout_ms: u64) -> bool {
            let sid = short_sid(&self.session_id);
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();
            let start = std::time::Instant::now();
            let timeout = Duration::from_millis(timeout_ms);
            let mut poll_count = 0;

            eprintln!("[ShadowAgent:{}] wait_for_ack: expected_pairs={}, timeout={}ms", sid, expected_pair_count, timeout_ms);

            while start.elapsed() < timeout {
                poll_count += 1;

                let script = format!(r#"
                    (function() {{
                        const SEL = {selectors};
                        const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
                        const pairCount = pairs.length;
                        const inp = document.querySelector(SEL.INPUT);
                        const inputReady = inp && !inp.disabled;
                        const inputCleared = inp && inp.value.trim().length === 0;
                        let botFinished = false;
                        if (pairCount >= {expected}) {{
                            const lastPair = pairs[pairCount - 1];
                            const hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);
                            botFinished = hasCopyBtn || (inputReady && inputCleared);
                        }}
                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            window.__TAURI__.core.invoke('forward_shadow_event', {{
                                event: 'shadow-ack-check',
                                payload: JSON.stringify({{ pairCount: pairCount, botFinished: botFinished }})
                            }}).catch(function(){{}});
                        }} else if (window.__TAURI_INTERNALS__) {{
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                                event: 'shadow-ack-check',
                                payload: JSON.stringify({{ pairCount: pairCount, botFinished: botFinished }})
                            }}).catch(function(){{}});
                        }}
                    }})();
                "#, selectors = selectors_json, expected = expected_pair_count);

                // FIX: 先注册监听器，再注入脚本
                let (ack_tx, mut ack_rx) = mpsc::channel::<bool>(1);
                let expected = expected_pair_count;
                let unlisten = {
                    self.app.listen("shadow-ack-check", move |event| {
                        if let Some(parsed) = parse_event_payload(event.payload()) {
                            let pair_count = parsed.get("pairCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                            let bot_finished = parsed.get("botFinished").and_then(|v| v.as_bool()).unwrap_or(false);
                            if pair_count >= expected && bot_finished {
                                let _ = ack_tx.try_send(true);
                            }
                        }
                    })
                };

                self.eval_js(&script).await.ok();

                let result = tokio::select! {
                    r = ack_rx.recv() => r.unwrap_or(false),
                    _ = tokio::time::sleep(Duration::from_millis(500)) => false,
                };

                self.app.unlisten(unlisten);

                if result {
                    eprintln!("[ShadowAgent:{}] wait_for_ack: SUCCESS after {}ms ({} polls)",
                        sid, start.elapsed().as_millis(), poll_count);
                    return true;
                }
            }

            eprintln!("[ShadowAgent:{}] wait_for_ack: TIMEOUT after {}ms ({} polls)",
                sid, timeout_ms, poll_count);
            false
        }

        async fn observe_and_relay(&self, tx: &mpsc::Sender<ShadowEvent>) {
            let sid = short_sid(&self.session_id);
            let relay_interval = self.timeouts.relay_interval_ms.unwrap_or(500);
            let no_response_timeout = self.timeouts.no_response_timeout_ms.unwrap_or(60000);
            let silence_timeout = self.timeouts.silence_timeout_ms.unwrap_or(30000);
            let finished_confirm_ms = self.timeouts.finished_confirm_ms.unwrap_or(3000);
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();

            let no_response_cycles = (no_response_timeout / relay_interval).max(1);
            let silence_cycles = (silence_timeout / relay_interval).max(1);
            let max_total_cycles: u64 = 240;

            eprintln!("[ShadowAgent:{}] observe_and_relay: relay_interval={}ms, no_response_timeout={}ms ({}cyc), silence_timeout={}ms ({}cyc), max_cycles={}",
                sid, relay_interval, no_response_timeout, no_response_cycles, silence_timeout, silence_cycles, max_total_cycles);

            // 注入 observer 脚本
            let observer_script = format!(r#"
                (function() {{
                    const SEL = {selectors};
                    if (window.__SHADOW_POLL_INTERVAL) {{
                        clearInterval(window.__SHADOW_POLL_INTERVAL);
                        window.__SHADOW_POLL_INTERVAL = null;
                    }}
                    window.__SHADOW_LAST_TEXT = "";
                    window.__SHADOW_LAST_BOT_IDLE = false;
                    window.__SHADOW_BOT_RESPONDED = false;
                    window.__SHADOW_HEARTBEAT = 0;
                    window.__SHADOW_LATEST_RESULT = null;

                    window.__SHADOW_POLL_INTERVAL = setInterval(() => {{
                        if (!window.__SHADOW_SESSION_ACTIVE) return;
                        window.__SHADOW_HEARTBEAT = (window.__SHADOW_HEARTBEAT || 0) + 1;
                        try {{
                            const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
                            const pairCount = pairs.length;
                            if (pairCount === 0) {{
                                if (window.__SHADOW_HEARTBEAT % 10 === 0) {{
                                    window.__SHADOW_LATEST_RESULT = JSON.stringify({{
                                        heartbeatOnly: true, heartbeat: window.__SHADOW_HEARTBEAT, pairCount: 0
                                    }});
                                }}
                                return;
                            }}

                            const lastPair = pairs[pairCount - 1];
                            var botMsgEl = lastPair.querySelector(SEL.BOT_REPLY) ||
                                lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_1) ||
                                lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_2);
                            var text;
                            if (botMsgEl) {{
                                text = (botMsgEl.innerText || botMsgEl.textContent || '').trim();
                            }} else {{
                                text = (lastPair.innerText || lastPair.textContent || '').trim();
                            }}

                            const inp = document.querySelector(SEL.INPUT);
                            const botIdle = inp && !inp.disabled;
                            if (!botIdle) window.__SHADOW_BOT_RESPONDED = true;
                            const hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);

                            function isJsonBalanced(str) {{
                                let open = 0, close = 0;
                                for (let ch of str) {{ if (ch === '[') open++; if (ch === ']') close++; }}
                                return open > 0 && open === close;
                            }}
                            const balanced = isJsonBalanced(text);
                            const isFinished = window.__SHADOW_BOT_RESPONDED && (hasCopyBtn || (balanced && botIdle));

                            if (text !== window.__SHADOW_LAST_TEXT || botIdle !== window.__SHADOW_LAST_BOT_IDLE) {{
                                window.__SHADOW_LAST_TEXT = text;
                                window.__SHADOW_LAST_BOT_IDLE = botIdle;
                                window.__SHADOW_LATEST_RESULT = JSON.stringify({{
                                    text: text, finished: isFinished, valid: balanced,
                                    botIdle: !!botIdle, botResponded: !!window.__SHADOW_BOT_RESPONDED,
                                    heartbeat: window.__SHADOW_HEARTBEAT, pairCount: pairCount
                                }});
                            }}
                        }} catch(e) {{
                            window.__SHADOW_LATEST_RESULT = JSON.stringify({{
                                error: (e.message || String(e)), heartbeat: window.__SHADOW_HEARTBEAT
                            }});
                        }}
                    }}, {relay_interval});
                }})();
            "#, selectors = selectors_json, relay_interval = relay_interval);

            if let Err(e) = self.eval_js(&observer_script).await {
                eprintln!("[ShadowAgent:{}] FATAL: Failed to inject observer: {}", sid, e);
                let _ = tx.send(ShadowEvent::Error { message: format!("Observer injection failed: {}", e) }).await;
                return;
            }
            eprintln!("[ShadowAgent:{}] Observer injected", sid);

            // 检查发送失败
            tokio::time::sleep(Duration::from_secs(1)).await;
            {
                // FIX: 先注册监听器
                let (fail_tx, mut fail_rx) = mpsc::channel::<bool>(1);
                let unlisten = {
                    self.app.listen("shadow-send-check", move |event| {
                        if let Some(parsed) = parse_event_payload(event.payload()) {
                            if parsed.get("failed").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let _ = fail_tx.try_send(true);
                            } else {
                                let _ = fail_tx.try_send(false);
                            }
                        }
                    })
                };

                let check = r#"
                    (function() {
                        if (window.__TAURI__ && window.__TAURI__.core) {
                            window.__TAURI__.core.invoke('forward_shadow_event', {
                                event: 'shadow-send-check',
                                payload: JSON.stringify({ failed: !!window.__SHADOW_SEND_FAILED })
                            }).catch(function(){});
                        } else if (window.__TAURI_INTERNALS__) {
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
                                event: 'shadow-send-check',
                                payload: JSON.stringify({ failed: !!window.__SHADOW_SEND_FAILED })
                            }).catch(function(){});
                        }
                    })();
                "#;
                self.eval_js(check).await.ok();

                let failed = tokio::select! {
                    r = fail_rx.recv() => r.unwrap_or(false),
                    _ = tokio::time::sleep(Duration::from_secs(2)) => false,
                };
                self.app.unlisten(unlisten);

                if failed {
                    eprintln!("[ShadowAgent:{}] FATAL: Send failed (button not found)", sid);
                    let _ = tx.send(ShadowEvent::Error {
                        message: "发送失败：未找到发送按钮，请检查 NotebookLM 页面状态".into()
                    }).await;
                    return;
                }
                eprintln!("[ShadowAgent:{}] Send check passed", sid);
            }

            // relay 脚本
            let relay_script = r#"
                (function() {
                    try {
                        var r = window.__SHADOW_LATEST_RESULT;
                        var h = window.__SHADOW_HEARTBEAT || 0;
                        var active = !!window.__SHADOW_SESSION_ACTIVE;
                        var payload;
                        if (r) {
                            payload = r;
                            window.__SHADOW_LATEST_RESULT = null;
                        } else {
                            payload = JSON.stringify({ heartbeatOnly: true, heartbeat: h, active: active });
                        }
                        if (window.__TAURI__ && window.__TAURI__.core) {
                            window.__TAURI__.core.invoke('forward_shadow_event', {
                                event: 'shadow-result', payload: payload
                            }).catch(function() {});
                        } else if (window.__TAURI_INTERNALS__) {
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
                                event: 'shadow-result', payload: payload
                            }).catch(function() {});
                        }
                    } catch(e) {}
                })();
            "#;

            // FIX: 使用持久监听器（注册一次，循环内读取），避免循环内 listen/unlisten 的竞态
            let (result_tx, mut result_rx) = mpsc::channel::<String>(16);
            let persistent_unlisten = {
                let result_tx = result_tx.clone();
                self.app.listen("shadow-result", move |event| {
                    let _ = result_tx.try_send(event.payload().to_string());
                })
            };
            drop(result_tx); // 关掉多余的 sender，保留监听器内的那个

            let mut last_yielded_text = String::new();
            let mut text_change_count: u64 = 0;
            let mut idle_count: u64 = 0;
            let mut finished_seen_at: Option<std::time::Instant> = None;
            let mut relay_fail_count: u32 = 0;

            eprintln!("[ShadowAgent:{}] Starting relay loop...", sid);

            while idle_count < max_total_cycles {
                // 注入 relay 脚本
                if let Err(e) = self.eval_js(relay_script).await {
                    relay_fail_count += 1;
                    eprintln!("[ShadowAgent:{}] Relay injection failed ({}/10): {}", sid, relay_fail_count, e);
                    if relay_fail_count > 10 {
                        eprintln!("[ShadowAgent:{}] FATAL: Too many relay failures, aborting", sid);
                        let _ = tx.send(ShadowEvent::Error {
                            message: "Too many relay failures, aborting".into()
                        }).await;
                        break;
                    }
                } else {
                    relay_fail_count = 0;
                }

                // 等待事件到达
                tokio::time::sleep(Duration::from_millis(relay_interval)).await;

                // 从持久监听器的 channel 中排空所有已到达的事件（取最新的一个）
                let mut latest_raw: Option<String> = None;
                while let Ok(raw) = result_rx.try_recv() {
                    latest_raw = Some(raw);
                }

                if let Some(raw) = latest_raw {
                    // payload 可能是双重 JSON 转义
                    let payload_str = if raw.starts_with('"') {
                        serde_json::from_str::<String>(&raw).unwrap_or(raw)
                    } else {
                        raw
                    };

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload_str) {
                        if parsed.get("heartbeatOnly").and_then(|v| v.as_bool()).unwrap_or(false) {
                            idle_count += 1;
                            if idle_count % 20 == 0 {
                                let hb = parsed.get("heartbeat").and_then(|v| v.as_u64()).unwrap_or(0);
                                eprintln!("[ShadowAgent:{}] Heartbeat: h={}, idle={}, active={}",
                                    sid, hb, idle_count, parsed.get("active").and_then(|v| v.as_bool()).unwrap_or(false));
                            }
                            // FIX: 不再 continue，让底部的超时检查始终执行
                        } else if parsed.get("error").is_some() {
                            let err_msg = parsed.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                            eprintln!("[ShadowAgent:{}] Observer error: {}", sid, err_msg);
                            idle_count += 1;
                        } else {
                            let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let finished = parsed.get("finished").and_then(|v| v.as_bool()).unwrap_or(false);

                            if !text.is_empty() && text != last_yielded_text {
                                text_change_count += 1;
                                let text_preview = if text.len() > 80 { format!("{}...", &text[..80]) } else { text.clone() };
                                eprintln!("[ShadowAgent:{}] Text changed #{}: len={}, finished={}, preview=\"{}\"",
                                    sid, text_change_count, text.len(), finished, text_preview);
                                last_yielded_text = text.clone();
                                idle_count = 0;
                                finished_seen_at = None;

                                let trust_finished = text_change_count >= 2 && finished;
                                if trust_finished {
                                    eprintln!("[ShadowAgent:{}] COMPLETE: text_changes={}, len={}",
                                        sid, text_change_count, text.len());
                                    let _ = tx.send(ShadowEvent::Complete { text }).await;
                                    break;
                                } else {
                                    let _ = tx.send(ShadowEvent::Streaming { text }).await;
                                }
                            } else if finished && !last_yielded_text.is_empty() && finished_seen_at.is_none() && text_change_count >= 2 {
                                finished_seen_at = Some(std::time::Instant::now());
                                eprintln!("[ShadowAgent:{}] Finished signal received, starting {}ms confirmation...",
                                    sid, finished_confirm_ms);
                            } else {
                                idle_count += 1;
                            }
                        }
                    } else {
                        eprintln!("[ShadowAgent:{}] Failed to parse relay payload: {}", sid,
                            if payload_str.len() > 100 { format!("{}...", &payload_str[..100]) } else { payload_str });
                        idle_count += 1;
                    }
                } else {
                    idle_count += 1;
                }

                // 确认超时
                if let Some(seen_at) = finished_seen_at {
                    if seen_at.elapsed() >= Duration::from_millis(finished_confirm_ms) {
                        eprintln!("[ShadowAgent:{}] COMPLETE (confirmed after delay): len={}",
                            sid, last_yielded_text.len());
                        let _ = tx.send(ShadowEvent::Complete { text: last_yielded_text.clone() }).await;
                        break;
                    }
                }

                // 无响应超时
                if last_yielded_text.is_empty() && text_change_count == 0 && idle_count > no_response_cycles {
                    eprintln!("[ShadowAgent:{}] ERROR: No response in {}ms ({}cyc)",
                        sid, no_response_timeout, idle_count);
                    let _ = tx.send(ShadowEvent::Error {
                        message: format!("No response in {}ms", no_response_timeout),
                    }).await;
                    break;
                }

                // 沉默超时
                // 区分"思考状态文本"（短、NotebookLM loading 提示）和"实际回复文本"（>100字符）
                // 短文本（思考中）沉默超时后继续等待，长文本沉默超时则认定完成
                let is_substantial = last_yielded_text.len() > 100;
                if !last_yielded_text.is_empty() && idle_count > silence_cycles {
                    if is_substantial {
                        eprintln!("[ShadowAgent:{}] COMPLETE (silence timeout {}ms): len={}",
                            sid, silence_timeout, last_yielded_text.len());
                        let _ = tx.send(ShadowEvent::Complete { text: last_yielded_text.clone() }).await;
                        break;
                    } else if idle_count > silence_cycles * 3 {
                        // 短文本等待 3 倍沉默超时（90s）仍无变化，视为无有效回复
                        eprintln!("[ShadowAgent:{}] ERROR: Only received thinking text after extended wait ({}ms): len={}, text=\"{}\"",
                            sid, silence_timeout * 3, last_yielded_text.len(), last_yielded_text);
                        let _ = tx.send(ShadowEvent::Error {
                            message: format!("NotebookLM 仅输出思考状态文本，未生成有效回复（等待 {}ms）", silence_timeout * 3),
                        }).await;
                        break;
                    }
                }
            }

            // 清理
            self.app.unlisten(persistent_unlisten);
            self.eval_js("if(window.__SHADOW_POLL_INTERVAL){clearInterval(window.__SHADOW_POLL_INTERVAL);window.__SHADOW_POLL_INTERVAL=null;}").await.ok();
            eprintln!("[ShadowAgent:{}] Relay loop ended, observer cleaned up", sid);
        }
    }
}
