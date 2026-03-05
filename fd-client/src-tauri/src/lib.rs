// rust_log 必须在其他模块之前声明，宏才能在后续模块中使用
#[macro_use]
pub mod rust_log;
pub mod models;
pub mod ai;
pub mod antigravity;
pub mod bridge;
pub mod shadow_agent;
pub mod execution_log;
#[cfg(feature = "tauri-app")]
pub mod server_config;

// Backward-compatibility shim: bin/bridge.rs imports `bridge_server::run_standalone`.
// TODO: Remove this module once bin/bridge.rs is migrated to use `crate::bridge` directly.
pub mod bridge_server {
    pub use crate::bridge::run_standalone;
    pub use crate::bridge::start_bridge_server;
    #[cfg(feature = "tauri-app")]
    pub use crate::bridge::start_bridge_server_with_app;
}

// =========== Tauri commands (only compiled in desktop mode) ===========
#[cfg(feature = "tauri-app")]
pub mod commands;

// =========== Tauri entry point ===========

#[cfg(feature = "tauri-app")]
pub fn run() {
    use commands::*;
    use tauri::Manager;

    // 创建全局共享的 ExecLogStore，Bridge HTTP 和 Tauri IPC 命令共用同一实例
    let log_store = bridge::init_log_store();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(log_store.clone())
        .setup(move |app| {
            // Start bridge server with Shadow Agent support,共享同一 log_store
            bridge::start_bridge_server_with_app(app.handle().clone(), log_store.clone());

            // 生产模式：导航主窗口到配置的远程服务器 URL
            // 开发模式（debug）使用 devUrl (localhost:5173) + Vite 代理，不导航
            if !cfg!(debug_assertions) {
                let server_url = server_config::read_server_url(app.handle());
                eprintln!("[fd-client] 生产模式，导航到: {}", server_url);
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(url) = server_url.parse::<tauri::Url>() {
                        let _ = window.navigate(url);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // AI translation
            translate_ticket_direct_cmd,
            execute_gemini_cmd,
            execute_claude_cmd,
            execute_notebooklm_py_cmd,
            sync_translate_reply_cmd,
            // File system
            select_folder,
            save_text_file_cmd,
            // Rust runtime logs
            get_rust_logs,
            clear_rust_logs,
            // Generic Shadow Window commands
            open_shadow_window,
            execute_shadow_js,
            toggle_shadow_window,
            get_shadow_window_visibility,
            close_shadow_window,
            // NotebookLM compatibility layer commands
            open_notebook_window,
            execute_notebook_js,
            get_shadow_result,
            forward_shadow_event,
            toggle_notebook_window,
            get_notebook_window_visibility,
            // Server URL config
            server_config::get_server_url,
            server_config::set_server_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
