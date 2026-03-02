//! System/filesystem Tauri commands.
//!
//! File picker, text file saving, etc.

use std::sync::mpsc;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();

    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    match rx.recv() {
        Ok(Some(path)) => Ok(path.to_string()),
        Ok(None) => Err("No folder selected".to_string()),
        Err(_) => Err("Dialog error".to_string()),
    }
}

#[tauri::command]
pub async fn save_text_file_cmd(save_path: String, content: String) -> Result<(), String> {
    std::fs::write(&save_path, content.as_bytes()).map_err(|e| e.to_string())
}
