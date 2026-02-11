mod models;
mod settings;
mod ai;
mod mq_consumer;

use ai::GeminiClient;

use settings::Settings;
use mq_consumer::{MqConsumer, MqConfig, MqConsumerState};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WebviewUrl, State};
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::sync::Mutex as TokioMutex;

fn log(app: &AppHandle, msg: &str) {
    let _ = app.emit("log", msg.to_string());
}

#[tauri::command]
async fn select_folder(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    
    app.dialog()
        .file()
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });
    
    match rx.recv() {
        Ok(Some(path)) => Ok(path.to_string()),
        Ok(None) => Err("No folder selected".to_string()),
        Err(_) => Err("Dialog error".to_string()),
    }
}

#[tauri::command]
fn save_settings_cmd(
    app: AppHandle,
    mq_host: String,
    mq_port: u16,
    mq_username: String,
    mq_password: String,
    translation_lang: String,
    mq_queue_translation: String,
    mq_queue_reply: String,
    mq_queue_audit: String,
    mq_queue_dlq: String,
) -> Result<(), String> {
    let existing = settings::load_settings(&app);

    let s = Settings {
        mq_host,
        mq_port,
        mq_username,
        mq_password,
        mq_consumer_enabled: existing.mq_consumer_enabled,
        mq_batch_size: existing.mq_batch_size,
        translation_lang,
        mq_queue_translation,
        mq_queue_reply,
        mq_queue_audit,
        mq_queue_dlq,
    };
    settings::save_settings(&app, &s)
}

#[tauri::command]
fn load_settings_cmd(app: AppHandle) -> Settings {
    settings::load_settings(&app)
}

#[tauri::command]
async fn translate_ticket_direct_cmd(app: AppHandle, ticket: models::Ticket, target_lang: String) -> Result<models::Ticket, String> {
    GeminiClient::translate_ticket(&app, &ticket, &target_lang).await
}


#[tauri::command]
async fn sync_translate_reply_cmd(
    app: AppHandle,
    source_text: String,
    reference_text: String,
    direction: String,
    target_lang: String,
) -> Result<String, String> {
    GeminiClient::sync_translate_reply(&app, &source_text, &reference_text, &direction, &target_lang).await
}

#[tauri::command]
async fn save_text_file_cmd(save_path: String, content: String) -> Result<(), String> {
    std::fs::write(&save_path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_notebook_window(app: AppHandle, notebook_id: String, notebook_url: Option<String>) -> Result<(), String> {
    println!("[Rust] open_notebook_window called with notebook_id: {}, notebook_url: {:?}", notebook_id, notebook_url);
    let window_label = "notebook_shadow";

    let target_url = if let Some(url) = notebook_url {
        if url.is_empty() {
            format!("https://notebooklm.google.com/notebook/{}", notebook_id)
        } else {
            url
        }
    } else {
        format!("https://notebooklm.google.com/notebook/{}", notebook_id)
    };
    
    // 如果窗口已存在，只需根据 URL 决定是否重新加载
    if let Some(window) = app.get_webview_window(window_label) {
        println!("[Rust] Shadow window already exists, checking URL...");
        let current_url = window.url().map_err(|e| e.to_string())?;
        if current_url.as_str() != target_url {
            println!("[Rust] URL mismatch, navigating to new URL: {}", target_url);
            window.navigate(target_url.parse().unwrap()).map_err(|e| e.to_string())?;
        } else {
            println!("[Rust] URL already matches, reusing existing window");
        }
        return Ok(());
    }

    // 创建新窗口（默认隐藏）
    println!("[Rust] Creating new shadow window with URL: {}", target_url);
    let builder = WebviewWindowBuilder::new(&app, window_label, WebviewUrl::External(target_url.parse().unwrap()))
        .title("NotebookLM Shadow")
        .inner_size(1280.0, 1000.0) // 强制桌面尺寸
        .visible(false) // 影子窗口默认隐藏
        .initialization_script(r#"
            (function() {
                console.log('Shadow initialization script running...');
                window.__TAURI_SHADOW__ = true;
                
                // 确保 __TAURI__ API 可用
                // 这会等待 Tauri 内部初始化完成
                function waitForTauri(callback) {
                    if (window.__TAURI_INTERNALS__) {
                        window.__TAURI__ = {
                            core: {
                                invoke: function(cmd, args) {
                                    return window.__TAURI_INTERNALS__.invoke(cmd, args);
                                }
                            }
                        };
                        console.log('Shadow IPC bridge ready');
                        callback();
                    } else {
                        setTimeout(() => waitForTauri(callback), 100);
                    }
                }
                
                waitForTauri(function() {
                    console.log('Shadow state fully initialized');
                });
            })();
        "#);

    let _window = builder.build().map_err(|e| {
        println!("[Rust] Failed to build shadow window: {}", e);
        e.to_string()
    })?;
    
    println!("[Rust] Shadow window created successfully");
    Ok(())
}

#[tauri::command]
async fn forward_shadow_event(app: AppHandle, event: String, payload: String) -> Result<(), String> {
    println!("[Rust] forward_shadow_event: event={}, payload_len={}", event, payload.len());
    app.emit(&event, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn execute_notebook_js(app: AppHandle, script: String) -> Result<(), String> {
    println!("[Rust] execute_notebook_js called, script_len={}", script.len());
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        println!("[Rust] Found shadow window, executing script...");
        window.eval(&script).map_err(|e| {
            println!("[Rust] Script eval failed: {}", e);
            e.to_string()
        })?;
        println!("[Rust] Script executed successfully");
        Ok(())
    } else {
        println!("[Rust] ERROR: Shadow window not found!");
        Err("Shadow window not found".to_string())
    }
}

#[tauri::command]
async fn get_shadow_result(app: AppHandle) -> Result<String, String> {
    println!("[Rust] get_shadow_result called");
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        // 注入脚本：提取内容并通过 invoke 发送回 Rust
        let extract_script = r#"
            (function() {
                try {
                    // AI 回复在 .to-user-container .message-text-content 中
                    const responses = document.querySelectorAll('.to-user-container .message-text-content');
                    const lastResponse = responses[responses.length - 1];
                    const text = lastResponse ? (lastResponse.innerText || lastResponse.textContent || "").trim() : "";
                    
                    // 检测是否完成：存在复制按钮说明生成完毕
                    const isFinished = !!document.querySelector('.chat-message-pair:last-child .xap-copy-to-clipboard');
                    
                    const result = JSON.stringify({ text: text, finished: isFinished });
                    console.log('[Shadow] Extraction done, length:', text.length, 'finished:', isFinished);
                    
                    // 通过 invoke 发送回 Rust
                    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                        window.__TAURI__.core.invoke('forward_shadow_event', { 
                            event: 'shadow-result', 
                            payload: result 
                        }).then(() => {
                            console.log('[Shadow] Result sent via invoke');
                        }).catch(e => {
                            console.error('[Shadow] invoke error:', e);
                        });
                    } else {
                        console.error('[Shadow] __TAURI__.core.invoke not available');
                    }
                } catch (e) {
                    console.error('[Shadow] Extraction error:', e);
                }
            })();
        "#;
        
        window.eval(extract_script).map_err(|e| e.to_string())?;
        
        // 返回占位符，实际结果通过事件传回
        Ok("__PENDING__".to_string())
    } else {
        Err("Shadow window not found".to_string())
    }
}

#[tauri::command]
async fn get_notebook_window_visibility(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        window.is_visible().map_err(|e| e.to_string())
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn toggle_notebook_window(app: AppHandle, visible: bool, notebook_id: Option<String>, notebook_url: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        if visible {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
        // 发送全局事件通知前端所有组件更新按钮状态
        app.emit("notebook-window-visibility-changed", visible).map_err(|e| e.to_string())?;
        Ok(())
    } else if visible {
        // 窗口不存在且需要显示时，先创建窗口
        if let Some(nb_id) = notebook_id {
            open_notebook_window(app.clone(), nb_id, notebook_url).await?;
            // 创建完成后显示窗口
            if let Some(window) = app.get_webview_window("notebook_shadow") {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
                app.emit("notebook-window-visibility-changed", true).map_err(|e| e.to_string())?;
            }
            Ok(())
        } else {
            Err("Cannot create shadow window: notebook_id not provided".to_string())
        }
    } else {
        // 窗口不存在且要隐藏，直接返回成功（本来就没显示）
        Ok(())
    }
}

// =========== NotebookLM Selectors Commands ===========

#[tauri::command]
fn get_notebook_selectors_cmd(app: AppHandle) -> std::collections::HashMap<String, String> {
    settings::get_notebook_selectors(&app)
}

#[tauri::command]
fn save_notebook_selectors_cmd(app: AppHandle, selectors: serde_json::Value) -> Result<(), String> {
    settings::save_notebook_selectors_from_json(&app, &selectors)
}

#[tauri::command]
fn reset_notebook_selectors_cmd(app: AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    settings::reset_notebook_selectors(&app)
}

// =========== MQ Consumer Commands ===========

/// MQ 消费者持有者（翻译和回复共用底层结构，但 Tauri State 需要不同类型）
struct MqConsumerHolder {
    consumer: Arc<TokioMutex<Option<MqConsumer>>>,
    state: MqConsumerState,
}

impl Default for MqConsumerHolder {
    fn default() -> Self {
        let state = MqConsumerState::default();
        state.batch_size.store(1, Ordering::SeqCst);
        Self {
            consumer: Arc::new(TokioMutex::new(None)),
            state,
        }
    }
}

/// 翻译 MQ 消费者状态（Tauri State newtype wrapper）
pub struct MqTranslateState(MqConsumerHolder);
impl Default for MqTranslateState {
    fn default() -> Self { Self(MqConsumerHolder::default()) }
}

/// 回复 MQ 消费者状态（Tauri State newtype wrapper）
pub struct MqReplyState(MqConsumerHolder);
impl Default for MqReplyState {
    fn default() -> Self { Self(MqConsumerHolder::default()) }
}

/// 审核 MQ 消费者状态（Tauri State newtype wrapper）
pub struct MqAuditState(MqConsumerHolder);
impl Default for MqAuditState {
    fn default() -> Self { Self(MqConsumerHolder::default()) }
}

// =========== 通用辅助函数 ===========

async fn start_consumer_inner(
    app: &AppHandle,
    holder: &MqConsumerHolder,
    queue_type: &str,
    auth_token: String,
) -> Result<String, String> {
    if holder.state.is_running.load(Ordering::SeqCst) {
        return Err(format!("{} consumer already running", queue_type));
    }

    let settings = settings::load_settings(app);
    let config = MqConfig::from_settings(&settings);
    holder.state.batch_size.store(settings.mq_batch_size, Ordering::SeqCst);

    log(app, &format!("🐰 Starting {} MQ consumer, connecting to {}:{}", queue_type, config.host, config.port));

    let consumer = MqConsumer::new_with_state(config, holder.state.clone());
    {
        let mut lock = holder.consumer.lock().await;
        *lock = Some(consumer);
    }

    let app_clone = app.clone();
    let consumer_arc = holder.consumer.clone();
    let qt = queue_type.to_string();

    tokio::spawn(async move {
        let lock = consumer_arc.lock().await;
        if let Some(ref consumer) = *lock {
            if let Err(e) = consumer.start_consuming(app_clone.clone(), auth_token, &qt).await {
                GeminiClient::log(&app_clone, &format!("❌ {} MQ Consumer error: {}", qt, e));
            }
        }
    });

    Ok(format!("{} MQ Consumer started", queue_type))
}

async fn stop_consumer_inner(
    app: &AppHandle,
    holder: &MqConsumerHolder,
    queue_type: &str,
) -> Result<String, String> {
    holder.state.is_running.store(false, Ordering::SeqCst);
    log(app, &format!("🛑 Stopping {} MQ consumer...", queue_type));
    Ok(format!("{} MQ Consumer stopping", queue_type))
}

async fn get_consumer_status_inner(
    holder: &MqConsumerHolder,
) -> Result<serde_json::Value, String> {
    let is_running = holder.state.is_running.load(Ordering::SeqCst);
    let batch_size = holder.state.batch_size.load(Ordering::SeqCst);
    let translating = holder.state.translating_tickets.lock().await.clone();
    let completed = holder.state.completed_tickets.lock().await.clone();

    Ok(serde_json::json!({
        "isRunning": is_running,
        "batchSize": batch_size,
        "translatingTickets": translating,
        "completedTickets": completed
    }))
}

async fn complete_task_inner(
    holder: &MqConsumerHolder,
    ticket_id: i64,
    success: bool,
    task_label: &str,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    if let Some(app) = app {
        GeminiClient::log(app, &format!("🎯 [complete_{}_task] ticket #{}, success: {}", task_label, ticket_id, success));
    }

    let mut p_acks = holder.state.pending_acks.lock().await;
    if let Some(tx) = p_acks.remove(&ticket_id) {
        tx.send(success).map_err(|_| format!("Failed to send completion signal for ticket #{}", ticket_id))
    } else {
        Err(format!("No pending {} task found for ticket #{}", task_label, ticket_id))
    }
}

// =========== Tauri 命令（薄包装） ===========

#[tauri::command]
async fn start_mq_consumer(
    app: AppHandle,
    auth_token: String,
    mq_state: State<'_, MqTranslateState>,
) -> Result<String, String> {
    let result = start_consumer_inner(&app, &mq_state.0, "translate", auth_token).await?;
    // 保存启动状态到设置
    let mut s = settings::load_settings(&app);
    s.mq_consumer_enabled = true;
    let _ = settings::save_settings(&app, &s);
    Ok(result)
}

#[tauri::command]
async fn stop_mq_consumer(
    app: AppHandle,
    mq_state: State<'_, MqTranslateState>,
) -> Result<String, String> {
    let result = stop_consumer_inner(&app, &mq_state.0, "translate").await?;
    let mut s = settings::load_settings(&app);
    s.mq_consumer_enabled = false;
    let _ = settings::save_settings(&app, &s);
    Ok(result)
}

#[tauri::command]
async fn get_mq_consumer_status(
    mq_state: State<'_, MqTranslateState>,
) -> Result<serde_json::Value, String> {
    get_consumer_status_inner(&mq_state.0).await
}

#[tauri::command]
async fn update_mq_batch_size(
    app: AppHandle,
    batch_size: u32,
    mq_state: State<'_, MqTranslateState>,
) -> Result<(), String> {
    mq_state.0.state.batch_size.store(batch_size, Ordering::SeqCst);
    let mut s = settings::load_settings(&app);
    s.mq_batch_size = batch_size;
    settings::save_settings(&app, &s)?;
    log(&app, &format!("⚙️ MQ batch size updated to {}", batch_size));
    Ok(())
}

#[tauri::command]
async fn start_reply_mq_consumer(
    app: AppHandle,
    auth_token: String,
    mq_state: State<'_, MqReplyState>,
) -> Result<String, String> {
    start_consumer_inner(&app, &mq_state.0, "reply", auth_token).await
}

#[tauri::command]
async fn stop_reply_mq_consumer(
    app: AppHandle,
    mq_state: State<'_, MqReplyState>,
) -> Result<String, String> {
    stop_consumer_inner(&app, &mq_state.0, "reply").await
}

#[tauri::command]
async fn get_reply_mq_consumer_status(
    mq_state: State<'_, MqReplyState>,
) -> Result<serde_json::Value, String> {
    get_consumer_status_inner(&mq_state.0).await
}

#[tauri::command]
async fn complete_reply_task(
    ticket_id: i64,
    success: bool,
    mq_state: State<'_, MqReplyState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    complete_task_inner(&mq_state.0, ticket_id, success, "reply", Some(&app)).await
}

#[tauri::command]
async fn complete_translate_task(
    ticket_id: i64,
    success: bool,
    mq_state: State<'_, MqTranslateState>,
) -> Result<(), String> {
    complete_task_inner(&mq_state.0, ticket_id, success, "translate", None).await
}

// =========== Audit MQ 消费者命令 ===========

#[tauri::command]
async fn start_audit_mq_consumer(
    app: AppHandle,
    auth_token: String,
    mq_state: State<'_, MqAuditState>,
) -> Result<String, String> {
    start_consumer_inner(&app, &mq_state.0, "audit", auth_token).await
}

#[tauri::command]
async fn stop_audit_mq_consumer(
    app: AppHandle,
    mq_state: State<'_, MqAuditState>,
) -> Result<String, String> {
    stop_consumer_inner(&app, &mq_state.0, "audit").await
}

#[tauri::command]
async fn get_audit_mq_consumer_status(
    mq_state: State<'_, MqAuditState>,
) -> Result<serde_json::Value, String> {
    get_consumer_status_inner(&mq_state.0).await
}

#[tauri::command]
async fn complete_audit_task(
    ticket_id: i64,
    success: bool,
    mq_state: State<'_, MqAuditState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    complete_task_inner(&mq_state.0, ticket_id, success, "audit", Some(&app)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(MqTranslateState::default())
        .manage(MqReplyState::default())
        .manage(MqAuditState::default())
        .setup(|app| {
            let settings = settings::load_settings(app.handle());
            let mq_translate_state = app.state::<MqTranslateState>();
            mq_translate_state.0.state.batch_size.store(settings.mq_batch_size, Ordering::SeqCst);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_folder,
            save_settings_cmd,
            load_settings_cmd,
            translate_ticket_direct_cmd,
            sync_translate_reply_cmd,
            save_text_file_cmd,
            open_notebook_window,
            execute_notebook_js,
            get_shadow_result,
            forward_shadow_event,
            toggle_notebook_window,
            get_notebook_window_visibility,
            // NotebookLM Selectors
            get_notebook_selectors_cmd,
            save_notebook_selectors_cmd,
            reset_notebook_selectors_cmd,
            // MQ 消费者命令
            start_mq_consumer,
            stop_mq_consumer,
            get_mq_consumer_status,
            update_mq_batch_size,
            // Reply MQ
            start_reply_mq_consumer,
            stop_reply_mq_consumer,
            get_reply_mq_consumer_status,
            complete_reply_task,
            complete_translate_task,
            // Audit MQ
            start_audit_mq_consumer,
            stop_audit_mq_consumer,
            get_audit_mq_consumer_status,
            complete_audit_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
