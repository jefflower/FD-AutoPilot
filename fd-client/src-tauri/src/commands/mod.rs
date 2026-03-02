//! Tauri command modules.
//!
//! All Tauri `#[tauri::command]` functions are organized here by domain.
//!
//! - `ai_commands`     -- Gemini CLI, NotebookLM-py, sync-translate
//! - `system_commands` -- File picker, text file saving
//! - `shadow_commands` -- Generic shadow window + NotebookLM compatibility

pub mod ai_commands;
pub mod system_commands;
pub mod shadow_commands;

// Re-export all commands for convenient registration in lib.rs
pub use ai_commands::*;
pub use system_commands::*;
pub use shadow_commands::*;
