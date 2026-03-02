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
            let selectors_json = serde_json::to_string(&self.selectors).unwrap();
            let full_sid = &self.session_id;

            eprintln!("[ShadowAgent:{}] clear_history: enabled={}", sid, clear_enabled);

            if !clear_enabled {
                // 仅重置状态
                let reset_script = format!(r#"
                    (function() {{
                        window.__SHADOW_SESSION_ID = "{}";
                        window.__SHADOW_SESSION_ACTIVE = false;
                        window.__SHADOW_SEND_FAILED = false;
                    }})();
                "#, full_sid);
                self.eval_js(&reset_script).await?;
                eprintln!("[ShadowAgent:{}] Clear disabled, state reset only", sid);
                return Ok(());
            }

            // 策略：直接刷新页面（比菜单点击清理更可靠）
            // 先检查是否有对话历史
            let has_history = {
                let (tx, mut rx) = mpsc::channel::<bool>(1);
                let unlisten = {
                    let tx = tx.clone();
                    self.app.listen("shadow-has-history", move |event| {
                        if let Some(parsed) = parse_event_payload(event.payload()) {
                            let has = parsed.get("hasHistory").and_then(|v| v.as_bool()).unwrap_or(false);
                            let _ = tx.try_send(has);
                        }
                    })
                };
                drop(tx);

                let check = format!(r#"
                    (function() {{
                        var SEL = {selectors};
                        var pairs = document.querySelectorAll(SEL.CHAT_PAIR);
                        var altPairs = document.querySelectorAll(SEL.CHAT_PAIR_ALT || 'NOOP');
                        var has = (pairs.length > 0) || (altPairs.length > 0);
                        var payload = JSON.stringify({{ hasHistory: has, pairs: pairs.length, altPairs: altPairs.length }});
                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            window.__TAURI__.core.invoke('forward_shadow_event', {{
                                event: 'shadow-has-history', payload: payload
                            }}).catch(function(){{}});
                        }} else if (window.__TAURI_INTERNALS__) {{
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                                event: 'shadow-has-history', payload: payload
                            }}).catch(function(){{}});
                        }}
                    }})();
                "#, selectors = selectors_json);

                self.eval_js(&check).await.ok();
                let result = tokio::select! {
                    r = rx.recv() => r.unwrap_or(false),
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {
                        eprintln!("[ShadowAgent:{}] History check timeout, assuming has history", sid);
                        true
                    },
                };
                self.app.unlisten(unlisten);
                result
            };

            if has_history {
                eprintln!("[ShadowAgent:{}] Has history, reloading page to clear...", sid);
                // 刷新页面（最可靠的清理方式）
                self.eval_js("window.location.reload();").await.ok();
                // 等待页面重新加载
                tokio::time::sleep(Duration::from_millis(4000)).await;

                // 等待页面就绪（input 出现）
                let _page_load_timeout = self.timeouts.page_load_ms.unwrap_or(3000);
                let mut ready = false;
                for i in 0..20 {
                    let (tx, mut rx) = mpsc::channel::<bool>(1);
                    let unlisten = {
                        let tx = tx.clone();
                        self.app.listen("shadow-page-ready", move |event| {
                            if let Some(parsed) = parse_event_payload(event.payload()) {
                                let r = parsed.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
                                let _ = tx.try_send(r);
                            }
                        })
                    };
                    drop(tx);

                    let ready_check = format!(r#"
                        (function() {{
                            var SEL = {selectors};
                            var inp = document.querySelector(SEL.INPUT);
                            var r = !!inp;
                            var payload = JSON.stringify({{ ready: r }});
                            if (window.__TAURI__ && window.__TAURI__.core) {{
                                window.__TAURI__.core.invoke('forward_shadow_event', {{
                                    event: 'shadow-page-ready', payload: payload
                                }}).catch(function(){{}});
                            }} else if (window.__TAURI_INTERNALS__) {{
                                window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                                    event: 'shadow-page-ready', payload: payload
                                }}).catch(function(){{}});
                            }}
                        }})();
                    "#, selectors = selectors_json);

                    self.eval_js(&ready_check).await.ok();
                    let result = tokio::select! {
                        r = rx.recv() => r.unwrap_or(false),
                        _ = tokio::time::sleep(Duration::from_millis(500)) => false,
                    };
                    self.app.unlisten(unlisten);

                    if result {
                        eprintln!("[ShadowAgent:{}] Page ready after reload (poll #{})", sid, i + 1);
                        ready = true;
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }

                if !ready {
                    eprintln!("[ShadowAgent:{}] WARNING: Page not ready after reload, proceeding anyway", sid);
                }

                // 刷新后需要重新初始化 IPC bridge
                self.eval_js(SHADOW_INIT_SCRIPT).await.ok();
                tokio::time::sleep(Duration::from_millis(1000)).await;
            } else {
                eprintln!("[ShadowAgent:{}] No history, page is clean", sid);
            }

            // 设置会话状态
            let state_script = format!(r#"
                (function() {{
                    window.__SHADOW_SESSION_ID = "{}";
                    window.__SHADOW_SESSION_ACTIVE = false;
                    window.__SHADOW_SEND_FAILED = false;
                    window.__SHADOW_POLL_COUNT = 0;
                }})();
            "#, full_sid);
            self.eval_js(&state_script).await?;
            eprintln!("[ShadowAgent:{}] History cleared, state reset", sid);
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

                    // 聚焦输入框
                    input.focus();
                    await new Promise(r => setTimeout(r, 200));

                    // 设置文本值
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

                    // 记录发送前的对话对数量
                    var pairsBefore = document.querySelectorAll(SEL.CHAT_PAIR).length;
                    window.__SHADOW_PAIRS_BEFORE_SEND = pairsBefore;

                    // 方式 1: 尝试点击发送按钮
                    let sendBtn = null;
                    for (let retry = 0; retry < 5; retry++) {{
                        sendBtn = document.querySelector(SEL.SEND_BUTTON) ||
                            Array.from(document.querySelectorAll('button')).find(b =>
                                (b.innerHTML.includes('arrow_forward') || b.innerHTML.includes('send')) && !b.disabled
                            );
                        if (sendBtn) break;
                        await new Promise(r => setTimeout(r, 500));
                    }}

                    if (sendBtn) {{
                        sendBtn.click();
                    }}

                    // 方式 2: 同时用 Enter 键触发（Angular 应用更可靠）
                    await new Promise(r => setTimeout(r, 300));
                    input.dispatchEvent(new KeyboardEvent('keydown', {{
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                        bubbles: true, cancelable: true
                    }}));
                    input.dispatchEvent(new KeyboardEvent('keypress', {{
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                        bubbles: true, cancelable: true
                    }}));
                    input.dispatchEvent(new KeyboardEvent('keyup', {{
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                        bubbles: true, cancelable: true
                    }}));

                    window.__SHADOW_SESSION_ACTIVE = true;
                    window.__SHADOW_SEND_FAILED = false;

                    // 等待并验证消息是否真正发送（输入框被清空 + 新对话对出现）
                    await new Promise(r => setTimeout(r, 2000));
                    var pairsAfter = document.querySelectorAll(SEL.CHAT_PAIR).length;
                    var inputCleared = input.value.trim().length === 0;
                    var inputDisabled = input.disabled;
                    window.__SHADOW_SEND_VERIFY = {{
                        pairsBefore: pairsBefore,
                        pairsAfter: pairsAfter,
                        inputCleared: inputCleared,
                        inputDisabled: inputDisabled,
                        sent: (pairsAfter > pairsBefore) || inputCleared || inputDisabled
                    }};
                    if (!window.__SHADOW_SEND_VERIFY.sent) {{
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

        /// 直接轮询 DOM 状态（无 observer setInterval，每次循环直接读 DOM + IPC 回传）
        /// 与 wait_for_ack / get_chat_pair_count 完全一致的可靠模式
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

            eprintln!("[ShadowAgent:{}] observe_and_relay (direct-poll mode): interval={}ms, no_resp={}ms, silence={}ms, max={}cyc",
                sid, relay_interval, no_response_timeout, silence_timeout, max_total_cycles);

            // 检查发送失败
            tokio::time::sleep(Duration::from_secs(1)).await;
            {
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
                        var failed = !!window.__SHADOW_SEND_FAILED;
                        var verify = window.__SHADOW_SEND_VERIFY || {};
                        var payload = JSON.stringify({
                            failed: failed,
                            pairsBefore: verify.pairsBefore,
                            pairsAfter: verify.pairsAfter,
                            inputCleared: verify.inputCleared,
                            inputDisabled: verify.inputDisabled,
                            sent: verify.sent
                        });
                        if (window.__TAURI__ && window.__TAURI__.core) {
                            window.__TAURI__.core.invoke('forward_shadow_event', {
                                event: 'shadow-send-check',
                                payload: payload
                            }).catch(function(){});
                        } else if (window.__TAURI_INTERNALS__) {
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
                                event: 'shadow-send-check',
                                payload: payload
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

                // 输出发送验证详情
                eprintln!("[ShadowAgent:{}] Send check result: failed={}", sid, failed);

                // 额外的验证检查：注入脚本读取 __SHADOW_SEND_VERIFY
                {
                    let (verify_tx, mut verify_rx) = mpsc::channel::<String>(1);
                    let unlisten_v = {
                        self.app.listen("shadow-send-verify", move |event| {
                            let _ = verify_tx.try_send(event.payload().to_string());
                        })
                    };
                    let verify_check = r#"
                        (function() {
                            var v = window.__SHADOW_SEND_VERIFY || {};
                            var payload = JSON.stringify(v);
                            if (window.__TAURI__ && window.__TAURI__.core) {
                                window.__TAURI__.core.invoke('forward_shadow_event', {
                                    event: 'shadow-send-verify', payload: payload
                                }).catch(function(){});
                            } else if (window.__TAURI_INTERNALS__) {
                                window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
                                    event: 'shadow-send-verify', payload: payload
                                }).catch(function(){});
                            }
                        })();
                    "#;
                    self.eval_js(verify_check).await.ok();
                    let verify_result = tokio::select! {
                        r = verify_rx.recv() => r,
                        _ = tokio::time::sleep(Duration::from_secs(2)) => None,
                    };
                    self.app.unlisten(unlisten_v);

                    if let Some(raw) = verify_result {
                        let payload_str = if raw.starts_with('"') {
                            serde_json::from_str::<String>(&raw).unwrap_or(raw)
                        } else { raw };
                        eprintln!("[ShadowAgent:{}] Send verify: {}", sid, payload_str);
                    }
                }

                if failed {
                    eprintln!("[ShadowAgent:{}] FATAL: Send failed (button not found or message not sent)", sid);
                    let _ = tx.send(ShadowEvent::Error {
                        message: "发送失败：消息未成功发送，请检查 NotebookLM 页面状态".into()
                    }).await;
                    return;
                }
                eprintln!("[ShadowAgent:{}] Send check passed", sid);
            }

            // 直接轮询脚本：每次注入 → 直接读 DOM → IPC 回传（不依赖 setInterval observer）
            // 诊断计数器（前 10 轮附加 DOM 结构信息，之后精简）
            let poll_script = format!(r#"
                (function() {{
                    try {{
                        var SEL = {selectors};
                        window.__SHADOW_POLL_COUNT = (window.__SHADOW_POLL_COUNT || 0) + 1;
                        var pollNum = window.__SHADOW_POLL_COUNT;

                        // 主选择器 + ALT 选择器 fallback
                        var pairs = document.querySelectorAll(SEL.CHAT_PAIR);
                        var altPairs = SEL.CHAT_PAIR_ALT ? document.querySelectorAll(SEL.CHAT_PAIR_ALT) : [];
                        var pairCount = pairs.length;
                        var altCount = altPairs.length;
                        var result;

                        if (pairCount === 0 && altCount === 0) {{
                            // 诊断：页面上到底有什么
                            var diag = '';
                            if (pollNum <= 5) {{
                                var logEl = document.querySelector('[role="log"]');
                                diag = logEl ? ('logChildren=' + logEl.children.length) : 'noLogRole';
                                var allMsgEls = document.querySelectorAll('.message-text-content, .model-response-text, .response-container');
                                diag += ',msgEls=' + allMsgEls.length;
                            }}
                            result = JSON.stringify({{ heartbeatOnly: true, pairCount: 0, altCount: altCount, diag: diag }});
                        }} else {{
                            // 优先使用主选择器，fallback 到 ALT
                            var usedPairs = pairCount > 0 ? pairs : altPairs;
                            var usedCount = pairCount > 0 ? pairCount : altCount;
                            var lastPair = usedPairs[usedCount - 1];
                            var selectorUsed = 'pair';

                            var botMsgEl = lastPair.querySelector(SEL.BOT_REPLY);
                            if (!botMsgEl) {{ botMsgEl = lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_1); selectorUsed = 'fb1'; }}
                            if (!botMsgEl) {{ botMsgEl = lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_2); selectorUsed = 'fb2'; }}

                            var text;
                            if (botMsgEl) {{
                                text = (botMsgEl.innerText || botMsgEl.textContent || '').trim();
                            }} else {{
                                text = (lastPair.innerText || lastPair.textContent || '').trim();
                                selectorUsed = 'fullPair';
                            }}

                            var inp = document.querySelector(SEL.INPUT);
                            var botIdle = inp && !inp.disabled;
                            var hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);

                            var open = 0, close = 0;
                            for (var i = 0; i < text.length; i++) {{
                                if (text[i] === '[') open++;
                                if (text[i] === ']') close++;
                            }}
                            var balanced = open > 0 && open === close;
                            var isFinished = hasCopyBtn || (balanced && botIdle);

                            var res = {{
                                text: text,
                                finished: isFinished,
                                valid: balanced,
                                botIdle: !!botIdle,
                                hasCopyBtn: hasCopyBtn,
                                pairCount: pairCount,
                                altCount: altCount,
                                sel: selectorUsed
                            }};

                            // 前 10 轮附加诊断 HTML 片段
                            if (pollNum <= 10) {{
                                var pairHtml = lastPair.outerHTML || '';
                                res.htmlSnippet = pairHtml.substring(0, 500);
                                res.inputDisabled = inp ? inp.disabled : null;
                                res.inputExists = !!inp;
                                // 检查是否有 loading/thinking 指示器
                                var loadingEl = document.querySelector('.loading-indicator, .thinking-indicator, [class*="loading"], [class*="thinking"]');
                                res.hasLoading = !!loadingEl;
                                if (loadingEl) res.loadingText = (loadingEl.innerText || '').substring(0, 100);
                            }}

                            result = JSON.stringify(res);
                        }}

                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            window.__TAURI__.core.invoke('forward_shadow_event', {{
                                event: 'shadow-poll', payload: result
                            }}).catch(function(){{}});
                        }} else if (window.__TAURI_INTERNALS__) {{
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                                event: 'shadow-poll', payload: result
                            }}).catch(function(){{}});
                        }}
                    }} catch(e) {{
                        var errPayload = JSON.stringify({{ error: e.message || String(e) }});
                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            window.__TAURI__.core.invoke('forward_shadow_event', {{
                                event: 'shadow-poll', payload: errPayload
                            }}).catch(function(){{}});
                        }} else if (window.__TAURI_INTERNALS__) {{
                            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {{
                                event: 'shadow-poll', payload: errPayload
                            }}).catch(function(){{}});
                        }}
                    }}
                }})();
            "#, selectors = selectors_json);

            let mut last_yielded_text = String::new();
            let mut text_change_count: u64 = 0;
            let mut idle_count: u64 = 0;
            let mut finished_seen_at: Option<std::time::Instant> = None;
            let mut poll_fail_count: u32 = 0;
            let mut bot_responded = false; // 在 Rust 端跟踪（替代页面内 __SHADOW_BOT_RESPONDED）

            eprintln!("[ShadowAgent:{}] Starting direct-poll loop...", sid);

            while idle_count < max_total_cycles {
                // 1. 注册一次性监听器
                let (result_tx, mut result_rx) = mpsc::channel::<String>(4);
                let unlisten = {
                    let result_tx = result_tx.clone();
                    self.app.listen("shadow-poll", move |event| {
                        let _ = result_tx.try_send(event.payload().to_string());
                    })
                };
                drop(result_tx);

                // 2. 注入直接轮询脚本
                if let Err(e) = self.eval_js(&poll_script).await {
                    poll_fail_count += 1;
                    eprintln!("[ShadowAgent:{}] Poll injection failed ({}/10): {}", sid, poll_fail_count, e);
                    self.app.unlisten(unlisten);
                    if poll_fail_count > 10 {
                        eprintln!("[ShadowAgent:{}] FATAL: Too many poll failures, aborting", sid);
                        let _ = tx.send(ShadowEvent::Error {
                            message: "Too many poll injection failures, aborting".into()
                        }).await;
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(relay_interval)).await;
                    continue;
                } else {
                    poll_fail_count = 0;
                }

                // 3. 等待 IPC 回传（与 wait_for_ack 一致的超时模式）
                let poll_result = tokio::select! {
                    r = result_rx.recv() => r,
                    _ = tokio::time::sleep(Duration::from_millis(relay_interval.max(1000))) => None,
                };

                self.app.unlisten(unlisten);

                // 4. 处理结果
                if let Some(raw) = poll_result {
                    let payload_str = if raw.starts_with('"') {
                        serde_json::from_str::<String>(&raw).unwrap_or(raw)
                    } else {
                        raw
                    };

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload_str) {
                        if parsed.get("heartbeatOnly").and_then(|v| v.as_bool()).unwrap_or(false) {
                            idle_count += 1;
                            let diag = parsed.get("diag").and_then(|v| v.as_str()).unwrap_or("");
                            let alt_count = parsed.get("altCount").and_then(|v| v.as_u64()).unwrap_or(0);
                            if idle_count <= 5 || idle_count % 20 == 0 {
                                eprintln!("[ShadowAgent:{}] Poll heartbeat: idle={}, pairCount=0, altCount={}, diag={}",
                                    sid, idle_count, alt_count, diag);
                            }
                        } else if parsed.get("error").is_some() {
                            let err_msg = parsed.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                            eprintln!("[ShadowAgent:{}] Poll error: {}", sid, err_msg);
                            idle_count += 1;
                        } else {
                            let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let bot_idle = parsed.get("botIdle").and_then(|v| v.as_bool()).unwrap_or(false);
                            let has_copy_btn = parsed.get("hasCopyBtn").and_then(|v| v.as_bool()).unwrap_or(false);
                            let balanced = parsed.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
                            let sel_used = parsed.get("sel").and_then(|v| v.as_str()).unwrap_or("?");
                            let alt_count = parsed.get("altCount").and_then(|v| v.as_u64()).unwrap_or(0);

                            // 前 10 轮输出诊断 HTML
                            if let Some(html) = parsed.get("htmlSnippet").and_then(|v| v.as_str()) {
                                let has_loading = parsed.get("hasLoading").and_then(|v| v.as_bool()).unwrap_or(false);
                                let loading_text = parsed.get("loadingText").and_then(|v| v.as_str()).unwrap_or("");
                                let input_exists = parsed.get("inputExists").and_then(|v| v.as_bool()).unwrap_or(false);
                                let input_disabled = parsed.get("inputDisabled").and_then(|v| v.as_bool());
                                eprintln!("[ShadowAgent:{}] DIAG: sel={}, altCount={}, inputExists={}, inputDisabled={:?}, hasLoading={}, loadingText=\"{}\"",
                                    sid, sel_used, alt_count, input_exists, input_disabled, has_loading, loading_text);
                                eprintln!("[ShadowAgent:{}] DIAG HTML: {}", sid,
                                    if html.len() > 300 { format!("{}...", &html[..300]) } else { html.to_string() });
                            }

                            // 在 Rust 端跟踪 bot_responded（当 botIdle=false 说明 bot 正在响应）
                            if !bot_idle && !text.is_empty() {
                                bot_responded = true;
                            }

                            let finished = bot_responded && (has_copy_btn || (balanced && bot_idle));

                            if !text.is_empty() && text != last_yielded_text {
                                text_change_count += 1;
                                let text_preview = if text.len() > 80 { format!("{}...", &text[..80]) } else { text.clone() };
                                eprintln!("[ShadowAgent:{}] Text #{}: len={}, finished={}, botIdle={}, copyBtn={}, sel={}, alt={}, preview=\"{}\"",
                                    sid, text_change_count, text.len(), finished, bot_idle, has_copy_btn, sel_used, alt_count, text_preview);
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
                                eprintln!("[ShadowAgent:{}] Finished signal, starting {}ms confirmation...",
                                    sid, finished_confirm_ms);
                            } else {
                                idle_count += 1;
                            }
                        }
                    } else {
                        eprintln!("[ShadowAgent:{}] Failed to parse poll payload: {}", sid,
                            if payload_str.len() > 100 { format!("{}...", &payload_str[..100]) } else { payload_str });
                        idle_count += 1;
                    }
                } else {
                    idle_count += 1;
                    if idle_count % 10 == 0 {
                        eprintln!("[ShadowAgent:{}] Poll timeout (no IPC response), idle={}", sid, idle_count);
                    }
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
                let is_substantial = last_yielded_text.len() > 100;
                if !last_yielded_text.is_empty() && idle_count > silence_cycles {
                    if is_substantial {
                        eprintln!("[ShadowAgent:{}] COMPLETE (silence timeout {}ms): len={}",
                            sid, silence_timeout, last_yielded_text.len());
                        let _ = tx.send(ShadowEvent::Complete { text: last_yielded_text.clone() }).await;
                        break;
                    } else if idle_count > silence_cycles * 3 {
                        eprintln!("[ShadowAgent:{}] ERROR: Only thinking text after {}ms: len={}, text=\"{}\"",
                            sid, silence_timeout * 3, last_yielded_text.len(), last_yielded_text);
                        let _ = tx.send(ShadowEvent::Error {
                            message: format!("NotebookLM 仅输出思考状态文本，未生成有效回复（等待 {}ms）", silence_timeout * 3),
                        }).await;
                        break;
                    }
                }
            }

            eprintln!("[ShadowAgent:{}] Poll loop ended", sid);
        }
    }
}
