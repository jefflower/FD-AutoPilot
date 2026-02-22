mod models;
mod ai;

use ai::GeminiClient;

use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WebviewUrl};
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc;

// =========== AI 翻译命令 ===========

#[tauri::command]
async fn translate_ticket_direct_cmd(app: AppHandle, ticket: models::Ticket, target_lang: String, system_prompt: Option<String>) -> Result<models::Ticket, String> {
    GeminiClient::translate_ticket(&app, &ticket, &target_lang, system_prompt.as_deref()).await
}

#[tauri::command]
async fn execute_gemini_cmd(app: AppHandle, prompt: String, models: Vec<String>) -> Result<String, String> {
    GeminiClient::execute_gemini(&app, &prompt, &models).await
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

// =========== 文件系统命令 ===========

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
async fn save_text_file_cmd(save_path: String, content: String) -> Result<(), String> {
    std::fs::write(&save_path, content.as_bytes()).map_err(|e| e.to_string())
}

// =========== 通用 Shadow Window 命令 ===========

/// 通用 Shadow Window 的 IPC 桥接初始化脚本（所有 shadow window 共享）
const SHADOW_INIT_SCRIPT: &str = r#"
    (function() {
        console.log('[Shadow] initialization script running...');
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

/// 打开（或复用）一个通用 Shadow Window
#[tauri::command]
async fn open_shadow_window(app: AppHandle, label: String, url: String) -> Result<(), String> {
    println!("[Rust] open_shadow_window called with label: {}, url: {}", label, url);

    // 如果窗口已存在，只需根据 URL 决定是否重新加载
    if let Some(window) = app.get_webview_window(&label) {
        println!("[Rust] Shadow window '{}' already exists, checking URL...", label);
        let current_url = window.url().map_err(|e| e.to_string())?;
        if current_url.as_str() != url {
            println!("[Rust] URL mismatch, navigating to new URL: {}", url);
            window.navigate(url.parse().unwrap()).map_err(|e| e.to_string())?;
        } else {
            println!("[Rust] URL already matches, reusing existing window");
        }
        return Ok(());
    }

    // 创建新窗口（默认隐藏）
    println!("[Rust] Creating new shadow window '{}' with URL: {}", label, url);
    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(url.parse().unwrap()),
    )
        .title(format!("Shadow: {}", label))
        .inner_size(1280.0, 1000.0)
        .visible(false)
        .initialization_script(SHADOW_INIT_SCRIPT);

    let _window = builder.build().map_err(|e| {
        println!("[Rust] Failed to build shadow window '{}': {}", label, e);
        e.to_string()
    })?;

    println!("[Rust] Shadow window '{}' created successfully", label);
    Ok(())
}

/// 在指定 Shadow Window 中执行 JS 脚本
#[tauri::command]
async fn execute_shadow_js(app: AppHandle, label: String, script: String) -> Result<(), String> {
    println!("[Rust] execute_shadow_js called, label={}, script_len={}", label, script.len());
    if let Some(window) = app.get_webview_window(&label) {
        println!("[Rust] Found shadow window '{}', executing script...", label);
        window.eval(&script).map_err(|e| {
            println!("[Rust] Script eval failed on '{}': {}", label, e);
            e.to_string()
        })?;
        println!("[Rust] Script executed successfully on '{}'", label);
        Ok(())
    } else {
        println!("[Rust] ERROR: Shadow window '{}' not found!", label);
        Err(format!("Shadow window '{}' not found", label))
    }
}

/// 切换指定 Shadow Window 的可见性
#[tauri::command]
async fn toggle_shadow_window(app: AppHandle, label: String, visible: bool) -> Result<(), String> {
    println!("[Rust] toggle_shadow_window called, label={}, visible={}", label, visible);
    if let Some(window) = app.get_webview_window(&label) {
        if visible {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    } else if visible {
        Err(format!("Shadow window '{}' not found, cannot show", label))
    } else {
        // 窗口不存在且要隐藏，直接返回成功
        Ok(())
    }
}

/// 获取指定 Shadow Window 的可见性状态
#[tauri::command]
async fn get_shadow_window_visibility(app: AppHandle, label: String) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.is_visible().map_err(|e| e.to_string())
    } else {
        Ok(false)
    }
}

/// 关闭并销毁指定 Shadow Window（释放资源）
#[tauri::command]
async fn close_shadow_window(app: AppHandle, label: String) -> Result<(), String> {
    println!("[Rust] close_shadow_window called, label={}", label);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
        println!("[Rust] Shadow window '{}' closed", label);
        Ok(())
    } else {
        println!("[Rust] Shadow window '{}' not found, nothing to close", label);
        Ok(()) // 不存在也不报错，幂等操作
    }
}

// =========== NotebookLM 兼容层命令（委托给通用版本） ===========

#[tauri::command]
async fn open_notebook_window(app: AppHandle, notebook_id: String, notebook_url: Option<String>) -> Result<(), String> {
    println!("[Rust] open_notebook_window called with notebook_id: {}, notebook_url: {:?}", notebook_id, notebook_url);
    let url = match notebook_url {
        Some(ref u) if !u.is_empty() => u.clone(),
        _ => format!("https://notebooklm.google.com/notebook/{}", notebook_id),
    };
    open_shadow_window(app, "notebook_shadow".to_string(), url).await
}

#[tauri::command]
async fn forward_shadow_event(app: AppHandle, event: String, payload: String) -> Result<(), String> {
    println!("[Rust] forward_shadow_event: event={}, payload_len={}", event, payload.len());
    app.emit(&event, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn execute_notebook_js(app: AppHandle, script: String) -> Result<(), String> {
    execute_shadow_js(app, "notebook_shadow".to_string(), script).await
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
    get_shadow_window_visibility(app, "notebook_shadow".to_string()).await
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

// =========== Tauri 入口 ===========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // AI 翻译
            translate_ticket_direct_cmd,
            execute_gemini_cmd,
            sync_translate_reply_cmd,
            // 文件系统
            select_folder,
            save_text_file_cmd,
            // 通用 Shadow Window 命令
            open_shadow_window,
            execute_shadow_js,
            toggle_shadow_window,
            get_shadow_window_visibility,
            close_shadow_window,
            // NotebookLM 兼容层命令
            open_notebook_window,
            execute_notebook_js,
            get_shadow_result,
            forward_shadow_event,
            toggle_notebook_window,
            get_notebook_window_visibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
