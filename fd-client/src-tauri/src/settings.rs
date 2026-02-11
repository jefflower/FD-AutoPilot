use rusqlite::{Connection, Result};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct Settings {
    // RabbitMQ 配置
    pub mq_host: String,
    pub mq_port: u16,
    pub mq_username: String,
    pub mq_password: String,
    // MQ 消费者配置
    pub mq_consumer_enabled: bool,
    pub mq_batch_size: u32,
    pub translation_lang: String,
    // MQ 队列名配置
    pub mq_queue_translation: String,
    pub mq_queue_reply: String,
    pub mq_queue_audit: String,
    pub mq_queue_dlq: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            mq_host: "localhost".to_string(),
            mq_port: 5672,
            mq_username: "guest".to_string(),
            mq_password: "guest".to_string(),
            mq_consumer_enabled: false,
            mq_batch_size: 5,
            translation_lang: "zh-CN".to_string(),
            mq_queue_translation: "q.ticket.translation".to_string(),
            mq_queue_reply: "q.ticket.reply".to_string(),
            mq_queue_audit: "q.ticket.audit".to_string(),
            mq_queue_dlq: "q.ticket.dlq".to_string(),
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
    save_setting(&conn, "mq_queue_translation", &settings.mq_queue_translation)?;
    save_setting(&conn, "mq_queue_reply", &settings.mq_queue_reply)?;
    save_setting(&conn, "mq_queue_audit", &settings.mq_queue_audit)?;
    save_setting(&conn, "mq_queue_dlq", &settings.mq_queue_dlq)?;

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
    if let Some(v) = load_setting(&conn, "mq_queue_translation") {
        settings.mq_queue_translation = v;
    }
    if let Some(v) = load_setting(&conn, "mq_queue_reply") {
        settings.mq_queue_reply = v;
    }
    if let Some(v) = load_setting(&conn, "mq_queue_audit") {
        settings.mq_queue_audit = v;
    }
    if let Some(v) = load_setting(&conn, "mq_queue_dlq") {
        settings.mq_queue_dlq = v;
    }

    settings
}

// =========== NotebookLM Selectors ===========

const NOTEBOOK_SELECTORS_KEY: &str = "notebook_selectors";

/// 默认选择器，与 notebookShadow.ts 中的 SELECTORS 保持一致
pub fn default_notebook_selectors() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("INPUT".to_string(), "textarea.query-box-input".to_string());
    m.insert("CHAT_PAIR".to_string(), ".chat-message-pair".to_string());
    m.insert("CHAT_PAIR_ALT".to_string(), "[role=\"log\"] .message-content".to_string());
    m.insert("BOT_REPLY".to_string(), ".to-user-container .message-text-content".to_string());
    m.insert("BOT_REPLY_FALLBACK_1".to_string(), ".model-response-text".to_string());
    m.insert("BOT_REPLY_FALLBACK_2".to_string(), ".response-container".to_string());
    m.insert("COPY_BUTTON".to_string(), ".xap-copy-to-clipboard".to_string());
    m.insert("SEND_BUTTON".to_string(), "button.submit-button:not([disabled])".to_string());
    m.insert("MENU_BUTTON".to_string(), "button[aria-label=\"对话选项\"]".to_string());
    m.insert("CONFIRM_DELETE".to_string(), "button.yes-button".to_string());
    m
}

pub fn get_notebook_selectors(app: &AppHandle) -> HashMap<String, String> {
    let db_path = get_db_path(app);
    if !db_path.exists() {
        return default_notebook_selectors();
    }
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return default_notebook_selectors(),
    };
    let _ = init_db(&conn);

    match load_setting(&conn, NOTEBOOK_SELECTORS_KEY) {
        Some(json_str) => {
            serde_json::from_str::<HashMap<String, String>>(&json_str)
                .unwrap_or_else(|_| default_notebook_selectors())
        }
        None => default_notebook_selectors(),
    }
}

pub fn save_notebook_selectors(app: &AppHandle, selectors: &HashMap<String, String>) -> std::result::Result<(), String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_db(&conn).map_err(|e| e.to_string())?;

    let json_str = serde_json::to_string(selectors).map_err(|e| e.to_string())?;
    save_setting(&conn, NOTEBOOK_SELECTORS_KEY, &json_str)
}

pub fn reset_notebook_selectors(app: &AppHandle) -> std::result::Result<HashMap<String, String>, String> {
    let defaults = default_notebook_selectors();
    save_notebook_selectors(app, &defaults)?;
    Ok(defaults)
}

/// 用 JsonValue 保存选择器（前端可能传来 serde_json::Value）
pub fn save_notebook_selectors_from_json(app: &AppHandle, value: &JsonValue) -> std::result::Result<(), String> {
    let map: HashMap<String, String> = serde_json::from_value(value.clone())
        .map_err(|e| format!("Invalid selectors JSON: {}", e))?;
    save_notebook_selectors(app, &map)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Settings defaults ──

    #[test]
    fn settings_default_values() {
        let s = Settings::default();
        assert_eq!(s.mq_host, "localhost");
        assert_eq!(s.mq_port, 5672);
        assert_eq!(s.mq_username, "guest");
        assert_eq!(s.mq_password, "guest");
        assert!(!s.mq_consumer_enabled);
        assert_eq!(s.mq_batch_size, 5);
        assert_eq!(s.translation_lang, "zh-CN");
        assert_eq!(s.mq_queue_translation, "q.ticket.translation");
        assert_eq!(s.mq_queue_reply, "q.ticket.reply");
        assert_eq!(s.mq_queue_audit, "q.ticket.audit");
        assert_eq!(s.mq_queue_dlq, "q.ticket.dlq");
    }

    #[test]
    fn settings_serialization_roundtrip() {
        let s = Settings {
            mq_host: "prod.mq.local".to_string(),
            mq_port: 5673,
            mq_username: "admin".to_string(),
            mq_password: "p@ss".to_string(),
            mq_consumer_enabled: true,
            mq_batch_size: 10,
            translation_lang: "en".to_string(),
            mq_queue_translation: "custom.translation".to_string(),
            mq_queue_reply: "custom.reply".to_string(),
            mq_queue_audit: "custom.audit".to_string(),
            mq_queue_dlq: "custom.dlq".to_string(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mq_host, "prod.mq.local");
        assert_eq!(back.mq_port, 5673);
        assert_eq!(back.mq_username, "admin");
        assert!(back.mq_consumer_enabled);
        assert_eq!(back.mq_batch_size, 10);
        assert_eq!(back.translation_lang, "en");
        assert_eq!(back.mq_queue_translation, "custom.translation");
        assert_eq!(back.mq_queue_reply, "custom.reply");
        assert_eq!(back.mq_queue_audit, "custom.audit");
        assert_eq!(back.mq_queue_dlq, "custom.dlq");
    }

    // ── SQLite setting operations (in-memory DB) ──

    #[test]
    fn save_and_load_setting_in_memory_db() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        save_setting(&conn, "test_key", "test_value").unwrap();
        assert_eq!(load_setting(&conn, "test_key"), Some("test_value".to_string()));
    }

    #[test]
    fn load_setting_missing_key() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        assert_eq!(load_setting(&conn, "nonexistent"), None);
    }

    #[test]
    fn save_setting_upsert() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        save_setting(&conn, "key", "value1").unwrap();
        assert_eq!(load_setting(&conn, "key"), Some("value1".to_string()));

        save_setting(&conn, "key", "value2").unwrap();
        assert_eq!(load_setting(&conn, "key"), Some("value2".to_string()));
    }

    #[test]
    fn init_db_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        init_db(&conn).unwrap(); // should not error
        save_setting(&conn, "k", "v").unwrap();
        assert_eq!(load_setting(&conn, "k"), Some("v".to_string()));
    }

    #[test]
    fn save_setting_with_special_characters() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        save_setting(&conn, "password", "p@ss'w\"ord&<>").unwrap();
        assert_eq!(load_setting(&conn, "password"), Some("p@ss'w\"ord&<>".to_string()));
    }

    // ── NotebookLM Selectors ──

    #[test]
    fn default_notebook_selectors_has_all_keys() {
        let sel = default_notebook_selectors();
        assert_eq!(sel.len(), 10);
        assert_eq!(sel.get("INPUT").unwrap(), "textarea.query-box-input");
        assert_eq!(sel.get("CHAT_PAIR").unwrap(), ".chat-message-pair");
        assert_eq!(sel.get("BOT_REPLY").unwrap(), ".to-user-container .message-text-content");
        assert_eq!(sel.get("COPY_BUTTON").unwrap(), ".xap-copy-to-clipboard");
        assert_eq!(sel.get("SEND_BUTTON").unwrap(), "button.submit-button:not([disabled])");
        assert_eq!(sel.get("MENU_BUTTON").unwrap(), "button[aria-label=\"对话选项\"]");
        assert_eq!(sel.get("CONFIRM_DELETE").unwrap(), "button.yes-button");
    }

    #[test]
    fn notebook_selectors_save_load_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        let mut sel = default_notebook_selectors();
        sel.insert("INPUT".to_string(), "textarea.new-query-input".to_string());

        let json_str = serde_json::to_string(&sel).unwrap();
        save_setting(&conn, NOTEBOOK_SELECTORS_KEY, &json_str).unwrap();

        let loaded_str = load_setting(&conn, NOTEBOOK_SELECTORS_KEY).unwrap();
        let loaded: HashMap<String, String> = serde_json::from_str(&loaded_str).unwrap();
        assert_eq!(loaded.get("INPUT").unwrap(), "textarea.new-query-input");
        assert_eq!(loaded.get("CHAT_PAIR").unwrap(), ".chat-message-pair");
    }

    #[test]
    fn notebook_selectors_from_json_validates() {
        // Valid JSON object
        let valid: JsonValue = serde_json::json!({"INPUT": "textarea.test", "CHAT_PAIR": ".test"});
        let map: std::result::Result<HashMap<String, String>, _> = serde_json::from_value(valid);
        assert!(map.is_ok());

        // Invalid JSON (number value instead of string)
        let invalid: JsonValue = serde_json::json!({"INPUT": 123});
        let map: std::result::Result<HashMap<String, String>, _> = serde_json::from_value(invalid);
        assert!(map.is_err());
    }
}
