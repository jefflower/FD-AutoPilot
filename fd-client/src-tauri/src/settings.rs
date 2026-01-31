use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct Settings {
    pub api_key: String,
    pub output_dir: String,
    pub sync_start_date: String,
    // RabbitMQ 配置
    pub mq_host: String,
    pub mq_port: u16,
    pub mq_username: String,
    pub mq_password: String,
    // MQ 消费者配置
    pub mq_consumer_enabled: bool, // MQ消费者是否应该自动启动
    pub mq_batch_size: u32,        // 每批翻译任务数量
    pub translation_lang: String,  // 翻译目标语言 (如 "cn", "en")
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            api_key: String::new(),
            output_dir: "data".to_string(),
            sync_start_date: "2025-01".to_string(),
            // MQ 默认配置
            mq_host: "localhost".to_string(),
            mq_port: 5672,
            mq_username: "guest".to_string(),
            mq_password: "guest".to_string(),
            // MQ 消费者默认配置
            mq_consumer_enabled: false,
            mq_batch_size: 5,
            translation_lang: "cn".to_string(),
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

fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .ok()
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_db(&conn).map_err(|e| e.to_string())?;

    save_setting(&conn, "api_key", &settings.api_key)?;
    save_setting(&conn, "output_dir", &settings.output_dir)?;
    save_setting(&conn, "sync_start_date", &settings.sync_start_date)?;
    save_setting(&conn, "mq_host", &settings.mq_host)?;
    save_setting(&conn, "mq_port", &settings.mq_port.to_string())?;
    save_setting(&conn, "mq_username", &settings.mq_username)?;
    save_setting(&conn, "mq_password", &settings.mq_password)?;
    save_setting(
        &conn,
        "mq_consumer_enabled",
        &settings.mq_consumer_enabled.to_string(),
    )?;
    save_setting(&conn, "mq_batch_size", &settings.mq_batch_size.to_string())?;
    save_setting(&conn, "translation_lang", &settings.translation_lang)?;

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

    if let Some(v) = load_setting(&conn, "api_key") {
        settings.api_key = v;
    }
    if let Some(v) = load_setting(&conn, "output_dir") {
        settings.output_dir = v;
    }
    if let Some(v) = load_setting(&conn, "sync_start_date") {
        settings.sync_start_date = v;
    }
    if let Some(v) = load_setting(&conn, "mq_host") {
        settings.mq_host = v;
    }
    if let Some(v) = load_setting(&conn, "mq_port") {
        settings.mq_port = v.parse().unwrap_or(5672);
    }
    if let Some(v) = load_setting(&conn, "mq_username") {
        settings.mq_username = v;
    }
    if let Some(v) = load_setting(&conn, "mq_password") {
        settings.mq_password = v;
    }
    if let Some(v) = load_setting(&conn, "mq_consumer_enabled") {
        settings.mq_consumer_enabled = v.parse().unwrap_or(false);
    }
    if let Some(v) = load_setting(&conn, "mq_batch_size") {
        settings.mq_batch_size = v.parse().unwrap_or(5);
    }
    if let Some(v) = load_setting(&conn, "translation_lang") {
        settings.translation_lang = v;
    }

    settings
}
