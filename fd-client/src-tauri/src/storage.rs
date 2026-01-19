use crate::models::{SyncState, Ticket};
use std::fs;
use std::path::Path;

pub struct Storage {
    data_dir: String,
}

impl Storage {
    pub fn new(output_dir: &str) -> Self {
        let tickets_path = Path::new(output_dir).join("tickets");
        fs::create_dir_all(&tickets_path).unwrap_or_default();
        Storage {
            data_dir: output_dir.to_string(),
        }
    }

    /// Get status name from status code
    fn status_name(status: i32) -> &'static str {
        match status {
            2 => "open",
            3 => "pending",
            4 => "resolved",
            5 => "closed",
            _ => "unknown",
        }
    }

    /// Get filename for a ticket: {id}_{status}_{lang}.json or {id}_{status}.json
    fn ticket_filename(ticket: &Ticket, lang: Option<&str>) -> String {
        match lang {
            Some(l) => format!(
                "{}_{}_{}.json",
                ticket.id,
                Self::status_name(ticket.status),
                l
            ),
            None => format!("{}_{}.json", ticket.id, Self::status_name(ticket.status)),
        }
    }

    /// Save ticket with status and optional language in filename
    pub fn save_ticket(&self, ticket: &Ticket, lang: Option<&str>) -> Result<(), String> {
        let tickets_dir = Path::new(&self.data_dir).join("tickets");

        // Remove any existing files for this ticket ID (different status) ONLY for the same language
        self.remove_old_ticket_files(ticket.id, lang)?;

        // Save with new filename
        let path = tickets_dir.join(Self::ticket_filename(ticket, lang));
        let json = serde_json::to_string_pretty(ticket).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Load a specific ticket by ID and language
    pub fn load_ticket(
        &self,
        ticket_id: u64,
        lang: Option<&str>,
    ) -> Result<Option<Ticket>, String> {
        let tickets_dir = Path::new(&self.data_dir).join("tickets");

        // We don't know the status, so we have to search for the file
        if let Ok(entries) = fs::read_dir(&tickets_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(filename) = path.file_stem().and_then(|s| s.to_str()) {
                    let parts: Vec<&str> = filename.split('_').collect();
                    if parts.len() < 2 {
                        continue;
                    }

                    if parts[0] == ticket_id.to_string() {
                        // Check language match
                        let file_lang = if parts.len() > 2 {
                            Some(parts[2])
                        } else {
                            None
                        };

                        if file_lang == lang {
                            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                            let ticket = serde_json::from_str::<Ticket>(&content)
                                .map_err(|e| e.to_string())?;
                            return Ok(Some(ticket));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    /// Remove any existing files for a ticket ID (different status) for a specific language
    fn remove_old_ticket_files(&self, ticket_id: u64, lang: Option<&str>) -> Result<(), String> {
        let tickets_dir = Path::new(&self.data_dir).join("tickets");

        if let Ok(entries) = fs::read_dir(&tickets_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(filename) = path.file_stem().and_then(|s| s.to_str()) {
                    // Check if filename starts with ticket ID
                    if filename.starts_with(&format!("{}_", ticket_id)) {
                        let parts: Vec<&str> = filename.split('_').collect();

                        let file_lang = if parts.len() > 2 {
                            Some(parts[2])
                        } else {
                            None
                        };

                        // Only remove if language matches
                        if file_lang == lang {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Sync all ticket statuses - rename files to match their internal status
    pub fn sync_all_statuses(&self) -> Result<(usize, usize), String> {
        let tickets_dir = Path::new(&self.data_dir).join("tickets");
        let mut synced = 0;
        let mut total = 0;

        if let Ok(entries) = fs::read_dir(&tickets_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }

                total += 1;

                // Read ticket to get current status
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(ticket) = serde_json::from_str::<Ticket>(&content) {
                        let expected_filename = Self::ticket_filename(&ticket, None);
                        let current_filename =
                            path.file_name().and_then(|s| s.to_str()).unwrap_or("");

                        // If filename doesn't match expected (for original files only), rename
                        let has_lang = current_filename.split('_').count() > 2;
                        if !has_lang && current_filename != expected_filename {
                            let new_path = tickets_dir.join(&expected_filename);
                            if fs::rename(&path, &new_path).is_ok() {
                                synced += 1;
                            }
                        }
                    }
                }
            }
        }

        Ok((synced, total))
    }

    pub fn get_last_updated_at(&self) -> Option<String> {
        let path = Path::new(&self.data_dir).join("sync_state.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(state) = serde_json::from_str::<SyncState>(&content) {
                    return state.last_updated_at;
                }
            }
        }
        None
    }

    pub fn update_last_sync_time(&self, dt: &str) -> Result<(), String> {
        let path = Path::new(&self.data_dir).join("sync_state.json");
        let state = SyncState {
            last_updated_at: Some(dt.to_string()),
        };
        let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_tickets(&self, preferred_lang: Option<&str>) -> Vec<Ticket> {
        let tickets_path = Path::new(&self.data_dir).join("tickets");
        let mut tickets_map = std::collections::HashMap::new();

        if let Ok(entries) = fs::read_dir(tickets_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(filename) = path.file_stem().and_then(|s| s.to_str()) {
                        let parts: Vec<&str> = filename.split('_').collect();
                        if parts.len() < 2 {
                            continue;
                        }

                        if let Ok(id) = parts[0].parse::<u64>() {
                            let file_lang = if parts.len() > 2 {
                                Some(parts[2].to_string())
                            } else {
                                None
                            };

                            // Load ticket content
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(ticket) = serde_json::from_str::<Ticket>(&content) {
                                    let entry =
                                        tickets_map.entry(id).or_insert_with(|| (None, Vec::new()));
                                    if let Some(ref l) = file_lang {
                                        entry.1.push(l.clone());
                                    }
                                    if file_lang.is_none() {
                                        entry.0 = Some(ticket);
                                    } else if file_lang.as_deref() == preferred_lang {
                                        // If we're looking for a specific translation, hold onto it
                                        // but we also want to track that it exists in entry.1
                                        entry.0 = Some(ticket);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut result = Vec::new();
        for (_, (ticket_opt, langs)) in tickets_map {
            if let Some(mut t) = ticket_opt {
                t.available_langs = langs;

                if let Some(pref) = preferred_lang {
                    // If preferred_lang is set, only include if that language is available
                    if t.available_langs.contains(&pref.to_string()) {
                        result.push(t);
                    }
                } else {
                    // Original view: include everything
                    result.push(t);
                }
            }
        }

        result.sort_by(|a, b| b.id.cmp(&a.id));
        result
    }
}
