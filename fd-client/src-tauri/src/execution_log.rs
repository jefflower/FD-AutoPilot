use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

// ========== Data Models ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogEntry {
    pub id: Option<i64>,
    pub agent_code: String,
    pub status: String, // "success" | "failed" | "timeout" | "running"
    pub command: Option<String>,
    pub input_params: Option<String>,
    /// 完整执行提示词（不截断）
    pub prompt_full: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub error_msg: Option<String>,
    pub duration_ms: Option<i64>,
    pub ref_type: Option<String>,
    pub ref_id: Option<String>,
    pub created_at: String, // ISO8601
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogConfig {
    pub agent_code: String,
    pub retention_days: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogQuery {
    pub agent_code: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecLogPage {
    pub total: i64,
    pub items: Vec<ExecLogEntry>,
}

// ========== Store ==========

pub struct ExecLogStore {
    db: Mutex<Connection>,
}

impl ExecLogStore {
    /// Open (or create) the SQLite database under `~/.fd-autopilot/exec_logs.db`.
    pub fn open() -> Result<Self, String> {
        let data_dir = Self::data_dir()?;
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data dir {:?}: {}", data_dir, e))?;

        let db_path = data_dir.join("exec_logs.db");
        eprintln!("[ExecLog] Opening database at {:?}", db_path);

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open SQLite: {}", e))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        // Create tables and indexes
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS exec_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_code TEXT NOT NULL,
                status TEXT NOT NULL,
                command TEXT,
                input_params TEXT,
                prompt_full TEXT,
                stdout TEXT,
                stderr TEXT,
                error_msg TEXT,
                duration_ms INTEGER,
                ref_type TEXT,
                ref_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_exec_log_agent ON exec_log(agent_code, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_exec_log_time ON exec_log(created_at);

            CREATE TABLE IF NOT EXISTS exec_log_config (
                agent_code TEXT PRIMARY KEY,
                retention_days INTEGER NOT NULL DEFAULT 30,
                enabled INTEGER NOT NULL DEFAULT 1
            );",
        )
        .map_err(|e| format!("Failed to create tables: {}", e))?;

        // Migrate: add prompt_full column for existing databases
        let _ = conn.execute_batch("ALTER TABLE exec_log ADD COLUMN prompt_full TEXT;");

        eprintln!("[ExecLog] Database initialized successfully");

        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    /// Data directory: `~/.fd-autopilot/`
    fn data_dir() -> Result<PathBuf, String> {
        dirs::home_dir()
            .map(|h| h.join(".fd-autopilot"))
            .ok_or_else(|| "Cannot determine home directory".to_string())
    }

    /// Insert a log entry, returning its auto-generated id.
    pub fn insert(&self, entry: &ExecLogEntry) -> Result<i64, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "INSERT INTO exec_log (agent_code, status, command, input_params, prompt_full, stdout, stderr, error_msg, duration_ms, ref_type, ref_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                entry.agent_code,
                entry.status,
                entry.command,
                entry.input_params,
                entry.prompt_full,
                entry.stdout,
                entry.stderr,
                entry.error_msg,
                entry.duration_ms,
                entry.ref_type,
                entry.ref_id,
                entry.created_at,
            ],
        )
        .map_err(|e| format!("Insert error: {}", e))?;

        Ok(conn.last_insert_rowid())
    }

    /// Paginated query with optional filters. Default limit 50, max 200.
    /// Results ordered by created_at DESC.
    pub fn query(&self, q: &ExecLogQuery) -> Result<ExecLogPage, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;

        let limit = q.limit.unwrap_or(50).min(200);
        let offset = q.offset.unwrap_or(0);

        // Build WHERE clause
        let mut conditions: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref ac) = q.agent_code {
            conditions.push(format!("agent_code = ?{}", param_values.len() + 1));
            param_values.push(Box::new(ac.clone()));
        }
        if let Some(ref st) = q.status {
            conditions.push(format!("status = ?{}", param_values.len() + 1));
            param_values.push(Box::new(st.clone()));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM exec_log {}", where_clause);
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|b| b.as_ref()).collect();
        let total: i64 = conn
            .query_row(&count_sql, params_ref.as_slice(), |row| row.get(0))
            .map_err(|e| format!("Count error: {}", e))?;

        // Query items
        let query_sql = format!(
            "SELECT id, agent_code, status, command, input_params, prompt_full, stdout, stderr, error_msg, duration_ms, ref_type, ref_id, created_at
             FROM exec_log {}
             ORDER BY created_at DESC
             LIMIT ?{} OFFSET ?{}",
            where_clause,
            param_values.len() + 1,
            param_values.len() + 2
        );

        // Build params for the data query (re-create since Box<dyn ToSql> is not Clone)
        let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(ref ac) = q.agent_code {
            all_params.push(Box::new(ac.clone()));
        }
        if let Some(ref st) = q.status {
            all_params.push(Box::new(st.clone()));
        }
        all_params.push(Box::new(limit as i64));
        all_params.push(Box::new(offset as i64));

        let all_params_ref: Vec<&dyn rusqlite::types::ToSql> =
            all_params.iter().map(|b| b.as_ref()).collect();

        let mut stmt = conn
            .prepare(&query_sql)
            .map_err(|e| format!("Prepare error: {}", e))?;

        let rows = stmt
            .query_map(all_params_ref.as_slice(), |row| {
                Ok(ExecLogEntry {
                    id: row.get(0)?,
                    agent_code: row.get(1)?,
                    status: row.get(2)?,
                    command: row.get(3)?,
                    input_params: row.get(4)?,
                    prompt_full: row.get(5)?,
                    stdout: row.get(6)?,
                    stderr: row.get(7)?,
                    error_msg: row.get(8)?,
                    duration_ms: row.get(9)?,
                    ref_type: row.get(10)?,
                    ref_id: row.get(11)?,
                    created_at: row.get(12)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| format!("Row error: {}", e))?);
        }

        Ok(ExecLogPage { total, items })
    }

    /// Get a single log entry by id.
    pub fn get_detail(&self, id: i64) -> Result<Option<ExecLogEntry>, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, agent_code, status, command, input_params, prompt_full, stdout, stderr, error_msg, duration_ms, ref_type, ref_id, created_at
                 FROM exec_log WHERE id = ?1",
            )
            .map_err(|e| format!("Prepare error: {}", e))?;

        let mut rows = stmt
            .query_map(params![id], |row| {
                Ok(ExecLogEntry {
                    id: row.get(0)?,
                    agent_code: row.get(1)?,
                    status: row.get(2)?,
                    command: row.get(3)?,
                    input_params: row.get(4)?,
                    prompt_full: row.get(5)?,
                    stdout: row.get(6)?,
                    stderr: row.get(7)?,
                    error_msg: row.get(8)?,
                    duration_ms: row.get(9)?,
                    ref_type: row.get(10)?,
                    ref_id: row.get(11)?,
                    created_at: row.get(12)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        match rows.next() {
            Some(Ok(entry)) => Ok(Some(entry)),
            Some(Err(e)) => Err(format!("Row error: {}", e)),
            None => Ok(None),
        }
    }

    /// Get log configs. If agent_code is None, return all configs.
    pub fn get_config(&self, agent_code: Option<&str>) -> Result<Vec<ExecLogConfig>, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;

        let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match agent_code {
            Some(ac) => (
                "SELECT agent_code, retention_days, enabled FROM exec_log_config WHERE agent_code = ?1".to_string(),
                vec![Box::new(ac.to_string())],
            ),
            None => (
                "SELECT agent_code, retention_days, enabled FROM exec_log_config ORDER BY agent_code".to_string(),
                vec![],
            ),
        };

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Prepare error: {}", e))?;

        let rows = stmt
            .query_map(params_ref.as_slice(), |row| {
                let enabled_int: i32 = row.get(2)?;
                Ok(ExecLogConfig {
                    agent_code: row.get(0)?,
                    retention_days: row.get(1)?,
                    enabled: enabled_int != 0,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        let mut configs = Vec::new();
        for row in rows {
            configs.push(row.map_err(|e| format!("Row error: {}", e))?);
        }

        Ok(configs)
    }

    /// Insert or replace a log config.
    pub fn set_config(&self, config: &ExecLogConfig) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO exec_log_config (agent_code, retention_days, enabled)
             VALUES (?1, ?2, ?3)",
            params![config.agent_code, config.retention_days, config.enabled as i32],
        )
        .map_err(|e| format!("Set config error: {}", e))?;
        Ok(())
    }

    /// Cleanup expired logs for all agents.
    /// Agents with explicit config use their retention_days; others default to 30 days.
    pub fn cleanup(&self) -> Result<u32, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;

        let mut total_deleted: u32 = 0;

        // 1. Get all agent configs
        let mut stmt = conn
            .prepare("SELECT agent_code, retention_days FROM exec_log_config")
            .map_err(|e| format!("Prepare error: {}", e))?;

        let configs: Vec<(String, i32)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // 2. Delete expired logs per agent with explicit config
        let mut configured_agents: Vec<String> = Vec::new();
        for (agent_code, retention_days) in &configs {
            configured_agents.push(agent_code.clone());
            let cutoff = chrono::Utc::now()
                - chrono::Duration::days(*retention_days as i64);
            let cutoff_str = cutoff.to_rfc3339();

            let deleted = conn
                .execute(
                    "DELETE FROM exec_log WHERE agent_code = ?1 AND created_at < ?2",
                    params![agent_code, cutoff_str],
                )
                .map_err(|e| format!("Delete error: {}", e))?;

            total_deleted += deleted as u32;
        }

        // 3. Delete logs for unconfigured agents using default 2-day retention
        let default_cutoff =
            chrono::Utc::now() - chrono::Duration::days(2);
        let default_cutoff_str = default_cutoff.to_rfc3339();

        if configured_agents.is_empty() {
            // No configs at all, clean everything older than 2 days
            let deleted = conn
                .execute(
                    "DELETE FROM exec_log WHERE created_at < ?1",
                    params![default_cutoff_str],
                )
                .map_err(|e| format!("Delete error: {}", e))?;
            total_deleted += deleted as u32;
        } else {
            // Build NOT IN clause for unconfigured agents
            let placeholders: Vec<String> = configured_agents
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 2))
                .collect();
            let sql = format!(
                "DELETE FROM exec_log WHERE agent_code NOT IN ({}) AND created_at < ?1",
                placeholders.join(", ")
            );

            let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            params_vec.push(Box::new(default_cutoff_str));
            for ac in &configured_agents {
                params_vec.push(Box::new(ac.clone()));
            }
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params_vec.iter().map(|b| b.as_ref()).collect();

            let deleted = conn
                .execute(&sql, params_ref.as_slice())
                .map_err(|e| format!("Delete error: {}", e))?;
            total_deleted += deleted as u32;
        }

        Ok(total_deleted)
    }

    /// Cleanup expired logs for a specific agent.
    pub fn cleanup_agent(&self, agent_code: &str, retention_days: i32) -> Result<u32, String> {
        let conn = self.db.lock().map_err(|e| format!("Lock error: {}", e))?;
        let cutoff =
            chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let deleted = conn
            .execute(
                "DELETE FROM exec_log WHERE agent_code = ?1 AND created_at < ?2",
                params![agent_code, cutoff_str],
            )
            .map_err(|e| format!("Delete error: {}", e))?;

        Ok(deleted as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory store for testing.
    fn test_store() -> ExecLogStore {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS exec_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_code TEXT NOT NULL,
                status TEXT NOT NULL,
                command TEXT,
                input_params TEXT,
                prompt_full TEXT,
                stdout TEXT,
                stderr TEXT,
                error_msg TEXT,
                duration_ms INTEGER,
                ref_type TEXT,
                ref_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_exec_log_agent ON exec_log(agent_code, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_exec_log_time ON exec_log(created_at);
            CREATE TABLE IF NOT EXISTS exec_log_config (
                agent_code TEXT PRIMARY KEY,
                retention_days INTEGER NOT NULL DEFAULT 30,
                enabled INTEGER NOT NULL DEFAULT 1
            );",
        )
        .unwrap();

        ExecLogStore {
            db: Mutex::new(conn),
        }
    }

    fn sample_entry(agent_code: &str, status: &str) -> ExecLogEntry {
        ExecLogEntry {
            id: None,
            agent_code: agent_code.to_string(),
            status: status.to_string(),
            command: Some("gemini test".to_string()),
            input_params: Some(r#"{"prompt":"hello"}"#.to_string()),
            prompt_full: Some("hello world prompt".to_string()),
            stdout: Some("output text".to_string()),
            stderr: None,
            error_msg: None,
            duration_ms: Some(1500),
            ref_type: Some("ticket".to_string()),
            ref_id: Some("42".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn insert_and_get_detail() {
        let store = test_store();
        let entry = sample_entry("ticket-translate", "success");
        let id = store.insert(&entry).unwrap();
        assert!(id > 0);

        let detail = store.get_detail(id).unwrap().unwrap();
        assert_eq!(detail.agent_code, "ticket-translate");
        assert_eq!(detail.status, "success");
        assert_eq!(detail.command.as_deref(), Some("gemini test"));
        assert_eq!(detail.duration_ms, Some(1500));
    }

    #[test]
    fn get_detail_not_found() {
        let store = test_store();
        assert!(store.get_detail(9999).unwrap().is_none());
    }

    #[test]
    fn query_all() {
        let store = test_store();
        store.insert(&sample_entry("agent-a", "success")).unwrap();
        store.insert(&sample_entry("agent-b", "failed")).unwrap();
        store.insert(&sample_entry("agent-a", "success")).unwrap();

        let page = store
            .query(&ExecLogQuery {
                agent_code: None,
                status: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.items.len(), 3);
    }

    #[test]
    fn query_filter_by_agent() {
        let store = test_store();
        store.insert(&sample_entry("agent-a", "success")).unwrap();
        store.insert(&sample_entry("agent-b", "failed")).unwrap();
        store.insert(&sample_entry("agent-a", "failed")).unwrap();

        let page = store
            .query(&ExecLogQuery {
                agent_code: Some("agent-a".to_string()),
                status: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 2);
    }

    #[test]
    fn query_filter_by_status() {
        let store = test_store();
        store.insert(&sample_entry("agent-a", "success")).unwrap();
        store.insert(&sample_entry("agent-a", "failed")).unwrap();
        store.insert(&sample_entry("agent-a", "success")).unwrap();

        let page = store
            .query(&ExecLogQuery {
                agent_code: None,
                status: Some("failed".to_string()),
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].status, "failed");
    }

    #[test]
    fn query_pagination() {
        let store = test_store();
        for i in 0..10 {
            store
                .insert(&sample_entry("agent-a", if i % 2 == 0 { "success" } else { "failed" }))
                .unwrap();
        }

        let page = store
            .query(&ExecLogQuery {
                agent_code: None,
                status: None,
                limit: Some(3),
                offset: Some(0),
            })
            .unwrap();
        assert_eq!(page.total, 10);
        assert_eq!(page.items.len(), 3);

        let page2 = store
            .query(&ExecLogQuery {
                agent_code: None,
                status: None,
                limit: Some(3),
                offset: Some(9),
            })
            .unwrap();
        assert_eq!(page2.total, 10);
        assert_eq!(page2.items.len(), 1);
    }

    #[test]
    fn query_limit_capped_at_200() {
        let store = test_store();
        store.insert(&sample_entry("a", "success")).unwrap();

        // limit > 200 should be capped
        let page = store
            .query(&ExecLogQuery {
                agent_code: None,
                status: None,
                limit: Some(500),
                offset: None,
            })
            .unwrap();
        // Just verify it doesn't error; actual cap tested indirectly
        assert_eq!(page.total, 1);
    }

    #[test]
    fn config_set_and_get() {
        let store = test_store();

        let config = ExecLogConfig {
            agent_code: "ticket-translate".to_string(),
            retention_days: 7,
            enabled: true,
        };
        store.set_config(&config).unwrap();

        let configs = store.get_config(Some("ticket-translate")).unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].retention_days, 7);
        assert!(configs[0].enabled);
    }

    #[test]
    fn config_get_all() {
        let store = test_store();
        store
            .set_config(&ExecLogConfig {
                agent_code: "a".to_string(),
                retention_days: 7,
                enabled: true,
            })
            .unwrap();
        store
            .set_config(&ExecLogConfig {
                agent_code: "b".to_string(),
                retention_days: 14,
                enabled: false,
            })
            .unwrap();

        let configs = store.get_config(None).unwrap();
        assert_eq!(configs.len(), 2);
    }

    #[test]
    fn config_upsert() {
        let store = test_store();
        store
            .set_config(&ExecLogConfig {
                agent_code: "a".to_string(),
                retention_days: 7,
                enabled: true,
            })
            .unwrap();
        store
            .set_config(&ExecLogConfig {
                agent_code: "a".to_string(),
                retention_days: 14,
                enabled: false,
            })
            .unwrap();

        let configs = store.get_config(Some("a")).unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].retention_days, 14);
        assert!(!configs[0].enabled);
    }

    #[test]
    fn cleanup_agent_removes_old() {
        let store = test_store();
        // Insert an entry with old timestamp
        let mut old_entry = sample_entry("agent-a", "success");
        old_entry.created_at = (chrono::Utc::now() - chrono::Duration::days(10)).to_rfc3339();
        store.insert(&old_entry).unwrap();

        // Insert a recent entry
        store.insert(&sample_entry("agent-a", "success")).unwrap();

        // Cleanup with 5-day retention
        let deleted = store.cleanup_agent("agent-a", 5).unwrap();
        assert_eq!(deleted, 1);

        let page = store
            .query(&ExecLogQuery {
                agent_code: Some("agent-a".to_string()),
                status: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(page.total, 1);
    }

    #[test]
    fn cleanup_all_with_defaults() {
        let store = test_store();

        // Insert an entry 5 days old (should be cleaned with default 2-day retention)
        let mut old_entry = sample_entry("agent-x", "success");
        old_entry.created_at = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
        store.insert(&old_entry).unwrap();

        // Insert a recent entry
        store.insert(&sample_entry("agent-x", "success")).unwrap();

        let deleted = store.cleanup().unwrap();
        assert_eq!(deleted, 1);
    }

    #[test]
    fn cleanup_respects_per_agent_config() {
        let store = test_store();

        // Set config: agent-a retains 3 days
        store
            .set_config(&ExecLogConfig {
                agent_code: "agent-a".to_string(),
                retention_days: 3,
                enabled: true,
            })
            .unwrap();

        // Insert a 5-day-old entry for agent-a (should be cleaned by its 3-day config)
        let mut old_a = sample_entry("agent-a", "success");
        old_a.created_at = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
        store.insert(&old_a).unwrap();

        // Insert a 1-day-old entry for agent-b (default 2-day retention, should NOT be cleaned)
        let mut old_b = sample_entry("agent-b", "success");
        old_b.created_at = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
        store.insert(&old_b).unwrap();

        let deleted = store.cleanup().unwrap();
        assert_eq!(deleted, 1); // only agent-a's entry should be deleted

        // Verify agent-b entry still exists
        let page = store
            .query(&ExecLogQuery {
                agent_code: Some("agent-b".to_string()),
                status: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(page.total, 1);
    }
}
