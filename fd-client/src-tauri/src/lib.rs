mod api;
mod models;
mod storage;
mod settings;
mod ai;
mod mq_consumer;

use ai::GeminiClient;

use api::FreshdeskClient;
use storage::Storage;
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
async fn sync_tickets(app: AppHandle, api_key: String, output_dir: String, full_sync: bool, _sync_start_date: String) -> Result<String, String> {
    log(&app, "🔧 Initializing...");
    let client = FreshdeskClient::new("simsonn.freshdesk.com", &api_key);
    let storage = Storage::new(&output_dir);
    
    if full_sync {
        // Full sync: fetch ALL tickets with immediate save
        log(&app, "🔄 Full sync - fetching and saving tickets immediately");
        let _ = app.emit("progress", serde_json::json!({"phase": "fetching", "current": 0, "total": 100}));
        
        let saved = client.fetch_and_save_all_tickets(&app, &storage, &client).await?;
        
        log(&app, &format!("✅ Full sync complete! Saved {} tickets.", saved));
        let _ = app.emit("progress", serde_json::json!({"phase": "complete", "current": 100, "total": 100}));
        
        Ok(format!("Synced {} tickets", saved))
    } else {
        // Incremental sync
        let last_sync = storage.get_last_updated_at();
        log(&app, &format!("📥 Incremental sync. Last: {:?}", last_sync));
        let _ = app.emit("progress", serde_json::json!({"phase": "fetching", "current": 25, "total": 100}));
        
        let tickets = match client.list_tickets_since(last_sync.as_deref(), &app).await {
            Ok(t) => {
                log(&app, &format!("   ✓ {} new/updated tickets", t.len()));
                t
            }
            Err(e) => {
                log(&app, &format!("   ❌ {}", e));
                return Err(e);
            }
        };

        let count = tickets.len();
        if count == 0 {
            log(&app, "✅ No tickets to process.");
            let _ = app.emit("progress", serde_json::json!({"phase": "complete", "current": 100, "total": 100}));
            return Ok("No tickets".to_string());
        }

        log(&app, &format!("⚙️ Processing {} tickets...", count));
        let mut max_updated_at: Option<String> = None;
        let mut processed = 0;
        let mut saved = 0;

        for mut ticket in tickets {
            processed += 1;
            
            let progress_pct = 50 + (processed as f32 / count as f32 * 50.0) as i32;
            let _ = app.emit("progress", serde_json::json!({
                "phase": "processing", 
                "current": progress_pct, 
                "total": 100,
                "ticketId": ticket.id,
                "processed": processed,
                "totalTickets": count
            }));
            
            if processed % 100 == 0 || processed == count {
                log(&app, &format!("⏳ {}/{} ({}%)", processed, count, progress_pct));
            }
            
            if let Ok(convs) = client.list_conversations(ticket.id).await {
                ticket.conversations = convs;
            }
            
            if processed % 20 == 0 {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }

            if max_updated_at.is_none() || ticket.updated_at.as_ref() > max_updated_at.as_ref() {
                max_updated_at = ticket.updated_at.clone();
            }

            if storage.save_ticket(&ticket, None).is_ok() {
                saved += 1;
            }
        }
        
        if let Some(updated_at) = max_updated_at {
            let _ = storage.update_last_sync_time(&updated_at);
        }
        
        log(&app, &format!("✅ Saved {}/{} tickets.", saved, count));
        let _ = app.emit("progress", serde_json::json!({"phase": "complete", "current": 100, "total": 100}));
        
        Ok(format!("Synced {} tickets", saved))
    }
}

#[tauri::command]
fn list_local_tickets(output_dir: String, lang: Option<String>) -> Vec<models::Ticket> {
    let storage = Storage::new(&output_dir);
    storage.list_tickets(lang.as_deref())
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
    api_key: String, 
    output_dir: String, 
    sync_start_date: String,
    mq_host: String,
    mq_port: u16,
    mq_username: String,
    mq_password: String,
    translation_lang: String,
) -> Result<(), String> {
    println!("[Rust] save_settings_cmd: host={}, port={}, user={}, pass_len={}", 
        mq_host, mq_port, mq_username, mq_password.len());
    
    // 加载现有设置以保留MQ消费者配置
    let existing = settings::load_settings(&app);
    
    let s = Settings { 
        api_key, 
        output_dir, 
        sync_start_date,
        mq_host,
        mq_port,
        mq_username,
        mq_password,
        // 保留现有的MQ消费者配置
        mq_consumer_enabled: existing.mq_consumer_enabled,
        mq_batch_size: existing.mq_batch_size,
        translation_lang: translation_lang,
    };
    settings::save_settings(&app, &s)
}

#[tauri::command]
fn load_settings_cmd(app: AppHandle) -> Settings {
    settings::load_settings(&app)
}

#[tauri::command]
fn sync_statuses_cmd(output_dir: String) -> Result<(usize, usize), String> {
    let storage = Storage::new(&output_dir);
    storage.sync_all_statuses()
}

#[tauri::command]
async fn translate_ticket_cmd(app: AppHandle, output_dir: String, ticket_id: u64, target_lang: String) -> Result<models::Ticket, String> {
    let storage = Storage::new(&output_dir);
    
    // 1. Try to list ticket from API first to get latest data? 
    // Or just load local ticket using load_ticket logic (default to original)
    // For now, let's assume we load original from disk
    let original = match storage.load_ticket(ticket_id, None)? {
        Some(t) => t,
        None => return Err(format!("Ticket #{} not found locally", ticket_id)),
    };
    
    // 2. Call AI module
    let translated = GeminiClient::translate_ticket(&app, &original, &target_lang).await?;
    
    // 3. Save translated ticket with language code
    storage.save_ticket(&translated, Some(&target_lang))?;
    
    Ok(translated)
}

#[tauri::command]
async fn translate_ticket_direct_cmd(app: AppHandle, ticket: models::Ticket, target_lang: String) -> Result<models::Ticket, String> {
    GeminiClient::translate_ticket(&app, &ticket, &target_lang).await
}


#[tauri::command]
fn load_ticket_cmd(output_dir: String, ticket_id: u64, lang: Option<String>) -> Result<Option<models::Ticket>, String> {
    let storage = Storage::new(&output_dir);
    storage.load_ticket(ticket_id, lang.as_deref())
}

#[tauri::command]
async fn export_to_csv_cmd(
    output_dir: String,
    ticket_ids: Vec<u64>,
    lang: Option<String>,
    save_path: String,
) -> Result<(), String> {
    let storage = Storage::new(&output_dir);
    let mut writer = csv::Writer::from_path(save_path).map_err(|e| e.to_string())?;

    // Headers
    writer
        .write_record(&[
            "ID",
            "Subject",
            "Status",
            "Priority",
            "Created At",
            "Updated At",
            "Description",
            "Conversations",
        ])
        .map_err(|e| e.to_string())?;

    // Data
    for id in ticket_ids {
        let ticket_opt = storage.load_ticket(id, lang.as_deref())?;
        if let Some(ticket) = ticket_opt {
            let mut conv_text = String::new();
            for conv in ticket.conversations {
                conv_text.push_str(&format!(
                    "[{:?}] {}: {}\n",
                    conv.created_at,
                    if conv.incoming { "Customer" } else { "Agent" },
                    conv.body_text
                ));
            }

            writer
                .write_record(&[
                    ticket.id.to_string(),
                    ticket.subject.unwrap_or_default(),
                    ticket.status.to_string(),
                    ticket.priority.to_string(),
                    ticket.created_at.unwrap_or_default(),
                    ticket.updated_at.unwrap_or_default(),
                    ticket.description_text.unwrap_or_default(),
                    conv_text,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    writer.flush().map_err(|e| e.to_string())?;

    Ok(())
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
async fn toggle_notebook_window(app: AppHandle, visible: bool) -> Result<(), String> {
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
    } else {
        Err("Shadow window not found".to_string())
    }
}

// =========== MQ Consumer Commands ===========

/// 翻译 MQ 消费者状态
pub struct MqTranslateState {
    consumer: Arc<TokioMutex<Option<MqConsumer>>>,
    state: MqConsumerState,
}

impl Default for MqTranslateState {
    fn default() -> Self {
        let state = MqConsumerState::default();
        state.batch_size.store(1, Ordering::SeqCst);
        Self {
            consumer: Arc::new(TokioMutex::new(None)),
            state,
        }
    }
}

/// 回复 MQ 消费者状态
pub struct MqReplyState {
    consumer: Arc<TokioMutex<Option<MqConsumer>>>,
    state: MqConsumerState,
}

impl Default for MqReplyState {
    fn default() -> Self {
        let state = MqConsumerState::default();
        state.batch_size.store(1, Ordering::SeqCst);
        Self {
            consumer: Arc::new(TokioMutex::new(None)),
            state,
        }
    }
}

#[tauri::command]
async fn start_mq_consumer(
    app: AppHandle,
    auth_token: String,
    mq_state: State<'_, MqTranslateState>,
) -> Result<String, String> {
    // 检查是否已在运行
    if mq_state.state.is_running.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Consumer already running".to_string());
    }

    // 从设置加载配置
    let mut settings = settings::load_settings(&app);
    let config = MqConfig::from_settings(&settings);
    
    // 设置 batch_size 到状态
    mq_state.state.batch_size.store(settings.mq_batch_size, std::sync::atomic::Ordering::SeqCst);
    
    log(&app, &format!("🐰 Starting MQ consumer, connecting to {}:{}", config.host, config.port));

    // 使用共享状态创建消费者
    let consumer = MqConsumer::new_with_state(config, mq_state.state.clone());
    
    // 保存消费者实例
    {
        let mut lock = mq_state.consumer.lock().await;
        *lock = Some(consumer);
    }
    
    // 保存启动状态到设置
    settings.mq_consumer_enabled = true;
    let _ = settings::save_settings(&app, &settings);

    // 启动消费（在后台任务中）
    let app_clone = app.clone();
    let consumer_arc = mq_state.consumer.clone();
    
    tokio::spawn(async move {
        let lock = consumer_arc.lock().await;
        if let Some(ref consumer) = *lock {
            if let Err(e) = consumer.start_consuming(app_clone.clone(), auth_token, "translate").await {
                GeminiClient::log(&app_clone, &format!("❌ Translation MQ Consumer error: {}", e));
            }
        }
    });

    Ok("MQ Consumer started".to_string())
}

#[tauri::command]
async fn stop_mq_consumer(
    app: AppHandle,
    mq_state: State<'_, MqTranslateState>,
) -> Result<String, String> {
    mq_state.state.is_running.store(false, std::sync::atomic::Ordering::SeqCst);
    
    // 保存停止状态到设置
    let mut settings = settings::load_settings(&app);
    settings.mq_consumer_enabled = false;
    let _ = settings::save_settings(&app, &settings);
    
    log(&app, "🛑 Stopping MQ consumer...");
    Ok("MQ Consumer stopping".to_string())
}

#[tauri::command]
async fn get_mq_consumer_status(
    mq_state: State<'_, MqTranslateState>,
) -> Result<serde_json::Value, String> {
    let is_running = mq_state.state.is_running.load(std::sync::atomic::Ordering::SeqCst);
    let batch_size = mq_state.state.batch_size.load(std::sync::atomic::Ordering::SeqCst);
    let current_task = mq_state.state.current_task.lock().await.clone();
    let translating = mq_state.state.translating_tickets.lock().await.clone();
    let completed = mq_state.state.completed_tickets.lock().await.clone();
    
    Ok(serde_json::json!({
        "isRunning": is_running,
        "batchSize": batch_size,
        "currentTask": current_task,
        "translatingTickets": translating,
        "completedTickets": completed
    }))
}

#[tauri::command]
async fn update_mq_batch_size(
    app: AppHandle,
    batch_size: u32,
    mq_state: State<'_, MqTranslateState>,
) -> Result<(), String> {
    // 更新内存状态
    mq_state.state.batch_size.store(batch_size, std::sync::atomic::Ordering::SeqCst);
    
    // 同步保存到设置
    let mut settings = settings::load_settings(&app);
    settings.mq_batch_size = batch_size;
    settings::save_settings(&app, &settings)?;
    
    log(&app, &format!("⚙️ MQ batch size updated to {}", batch_size));
    Ok(())
}

// =========== Reply MQ Commands ===========

#[tauri::command]
async fn start_reply_mq_consumer(
    app: AppHandle,
    auth_token: String,
    mq_state: State<'_, MqReplyState>,
) -> Result<String, String> {
    if mq_state.state.is_running.load(Ordering::SeqCst) {
        return Err("Reply Consumer already running".to_string());
    }

    let settings = settings::load_settings(&app);
    let config = MqConfig::from_settings(&settings);
    
    mq_state.state.batch_size.store(settings.mq_batch_size, Ordering::SeqCst);
    
    log(&app, &format!("🐰 Starting Reply MQ consumer, connecting to {}:{}", config.host, config.port));

    let consumer = MqConsumer::new_with_state(config, mq_state.state.clone());
    
    {
        let mut lock = mq_state.consumer.lock().await;
        *lock = Some(consumer);
    }
    
    let app_clone = app.clone();
    let consumer_arc = mq_state.consumer.clone();
    
    tokio::spawn(async move {
        let lock = consumer_arc.lock().await;
        if let Some(ref consumer) = *lock {
            if let Err(e) = consumer.start_consuming(app_clone.clone(), auth_token, "reply").await {
                GeminiClient::log(&app_clone, &format!("❌ Reply MQ Consumer error: {}", e));
            }
        }
    });

    Ok("Reply MQ Consumer started".to_string())
}

#[tauri::command]
async fn stop_reply_mq_consumer(
    app: AppHandle,
    mq_state: State<'_, MqReplyState>,
) -> Result<String, String> {
    mq_state.state.is_running.store(false, Ordering::SeqCst);
    log(&app, "🛑 Stopping Reply MQ consumer...");
    Ok("Reply MQ Consumer stopping".to_string())
}

#[tauri::command]
async fn get_reply_mq_consumer_status(
    mq_state: State<'_, MqReplyState>,
) -> Result<serde_json::Value, String> {
    let is_running = mq_state.state.is_running.load(Ordering::SeqCst);
    let batch_size = mq_state.state.batch_size.load(Ordering::SeqCst);
    let current_task = mq_state.state.current_task.lock().await.clone();
    let translating = mq_state.state.translating_tickets.lock().await.clone();
    let completed = mq_state.state.completed_tickets.lock().await.clone();
    
    Ok(serde_json::json!({
        "isRunning": is_running,
        "batchSize": batch_size,
        "currentTask": current_task,
        "translatingTickets": translating, // 虽然变量名是 translating，但在 UI 上会对应“回复中”
        "completedTickets": completed
    }))
}


#[tauri::command]
async fn complete_reply_task(
    ticket_id: i64,
    success: bool,
    mq_state: State<'_, MqReplyState>,
) -> Result<(), String> {
    let mut p_acks = mq_state.state.pending_acks.lock().await;
    if let Some(tx) = p_acks.remove(&ticket_id) {
        let _ = tx.send(success);
        Ok(())
    } else {
        Err(format!("No pending reply task found for ticket #{}", ticket_id))
    }
}

#[tauri::command]
async fn complete_translate_task(
    ticket_id: i64,
    success: bool,
    mq_state: State<'_, MqTranslateState>,
) -> Result<(), String> {
    let mut p_acks = mq_state.state.pending_acks.lock().await;
    if let Some(tx) = p_acks.remove(&ticket_id) {
        let _ = tx.send(success);
        Ok(())
    } else {
        Err(format!("No pending translation task found for ticket #{}", ticket_id))
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(MqTranslateState::default())
        .manage(MqReplyState::default())
        .setup(|app| {
            let settings = settings::load_settings(app.handle());
            let mq_translate_state = app.state::<MqTranslateState>();
            mq_translate_state.state.batch_size.store(settings.mq_batch_size, Ordering::SeqCst);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_tickets, 
            list_local_tickets,
            select_folder,
            save_settings_cmd,
            load_settings_cmd,
            sync_statuses_cmd,
            translate_ticket_cmd,
            translate_ticket_direct_cmd,
            load_ticket_cmd,
            export_to_csv_cmd,
            open_notebook_window,
            execute_notebook_js,
            get_shadow_result,
            forward_shadow_event,
            toggle_notebook_window,
            get_notebook_window_visibility,
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
            complete_translate_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
