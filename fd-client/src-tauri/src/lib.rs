pub mod models;
pub mod ai;
pub mod bridge;
pub mod shadow_agent;
pub mod execution_log;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Start bridge server with Shadow Agent support
            bridge::start_bridge_server_with_app(app.handle().clone());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
