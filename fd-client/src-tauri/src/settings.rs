use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct Settings {
    pub api_key: String,
    pub output_dir: String,
    pub sync_start_date: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            api_key: String::new(),
            output_dir: "data".to_string(),
            sync_start_date: "2025-01".to_string(),
        }
    }
}

fn get_db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("settings.db")
}

fn init_db(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_db(&conn).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('api_key', ?1)",
        [&settings.api_key],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('output_dir', ?1)",
        [&settings.output_dir],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_start_date', ?1)",
        [&settings.sync_start_date],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let db_path = get_db_path(app);

    if !db_path.exists() {
        return Settings::default();
    }

    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return Settings::default(),
    };

    let mut settings = Settings::default();

    if let Ok(api_key) = conn.query_row(
        "SELECT value FROM settings WHERE key = 'api_key'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        settings.api_key = api_key;
    }

    if let Ok(output_dir) = conn.query_row(
        "SELECT value FROM settings WHERE key = 'output_dir'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        settings.output_dir = output_dir;
    }

    if let Ok(sync_start_date) = conn.query_row(
        "SELECT value FROM settings WHERE key = 'sync_start_date'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        settings.sync_start_date = sync_start_date;
    }

    settings
}
