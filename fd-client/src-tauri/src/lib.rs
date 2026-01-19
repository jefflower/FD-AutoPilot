mod api;
mod models;
mod storage;
mod settings;
mod ai;

use ai::GeminiClient;

use api::FreshdeskClient;
use storage::Storage;
use settings::Settings;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc;

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

            if max_updated_at.is_none() || ticket.updated_at > max_updated_at.clone().unwrap() {
                max_updated_at = Some(ticket.updated_at.clone());
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
fn save_settings_cmd(app: AppHandle, api_key: String, output_dir: String, sync_start_date: String) -> Result<(), String> {
    let s = Settings { api_key, output_dir, sync_start_date };
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
    let translated = GeminiClient::translate_ticket(&app, &original, &target_lang)?;
    
    // 3. Save translated ticket with language code
    storage.save_ticket(&translated, Some(&target_lang))?;
    
    Ok(translated)
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
                    "[{}] {}: {}\n",
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
                    ticket.created_at,
                    ticket.updated_at,
                    ticket.description_text.unwrap_or_default(),
                    conv_text,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    writer.flush().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            sync_tickets, 
            list_local_tickets,
            select_folder,
            save_settings_cmd,
            load_settings_cmd,
            sync_statuses_cmd,
            translate_ticket_cmd,
            load_ticket_cmd,
            export_to_csv_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
