//! Rust 端运行时日志收集器
//!
//! 提供一个全局内存环形缓冲区，收集 Rust 端运行日志。
//! 通过 Tauri command 或 Bridge HTTP 端点暴露给前端查看。

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

/// 默认保留的最大日志条数
const DEFAULT_MAX_ENTRIES: usize = 1000;

/// 单条日志
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RustLogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// 日志查询参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RustLogQuery {
    pub limit: Option<usize>,
    pub level: Option<String>,
    pub keyword: Option<String>,
}

/// 全局日志收集器
pub struct RustLogCollector {
    entries: Mutex<VecDeque<RustLogEntry>>,
    max_entries: usize,
}

/// 全局单例
static INSTANCE: OnceLock<RustLogCollector> = OnceLock::new();

impl RustLogCollector {
    /// 获取全局实例
    pub fn global() -> &'static RustLogCollector {
        INSTANCE.get_or_init(|| RustLogCollector {
            entries: Mutex::new(VecDeque::with_capacity(DEFAULT_MAX_ENTRIES)),
            max_entries: DEFAULT_MAX_ENTRIES,
        })
    }

    /// 追加一条日志
    pub fn push(&self, level: &str, message: String) {
        // 同时写到 stderr
        eprintln!("[{}] {}", level, message);

        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() >= self.max_entries {
                entries.pop_front();
            }
            entries.push_back(RustLogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: level.to_string(),
                message,
            });
        }
    }

    /// 查询日志
    pub fn query(&self, q: &RustLogQuery) -> Vec<RustLogEntry> {
        let entries = match self.entries.lock() {
            Ok(e) => e,
            Err(_) => return vec![],
        };

        let limit = q.limit.unwrap_or(200).min(1000);
        let level_filter = q.level.as_deref();
        let keyword_filter = q.keyword.as_deref();

        entries
            .iter()
            .rev() // 最新的在前
            .filter(|e| {
                if let Some(lv) = level_filter {
                    if !e.level.eq_ignore_ascii_case(lv) {
                        return false;
                    }
                }
                if let Some(kw) = keyword_filter {
                    if !e.message.contains(kw) {
                        return false;
                    }
                }
                true
            })
            .take(limit)
            .cloned()
            .collect()
    }

    /// 清空日志
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

// ========== 便捷宏 ==========

/// 记录 INFO 级别日志（同时写 stderr + 内存缓冲区）
#[macro_export]
macro_rules! rlog_info {
    ($($arg:tt)*) => {
        $crate::rust_log::RustLogCollector::global().push("INFO", format!($($arg)*));
    };
}

/// 记录 WARN 级别日志
#[macro_export]
macro_rules! rlog_warn {
    ($($arg:tt)*) => {
        $crate::rust_log::RustLogCollector::global().push("WARN", format!($($arg)*));
    };
}

/// 记录 ERROR 级别日志
#[macro_export]
macro_rules! rlog_error {
    ($($arg:tt)*) => {
        $crate::rust_log::RustLogCollector::global().push("ERROR", format!($($arg)*));
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_query() {
        let collector = RustLogCollector {
            entries: Mutex::new(VecDeque::with_capacity(10)),
            max_entries: 10,
        };
        collector.push("INFO", "hello world".to_string());
        collector.push("ERROR", "something broke".to_string());
        collector.push("INFO", "another info".to_string());

        let all = collector.query(&RustLogQuery {
            limit: None,
            level: None,
            keyword: None,
        });
        assert_eq!(all.len(), 3);
        // 最新在前
        assert_eq!(all[0].message, "another info");

        let errors = collector.query(&RustLogQuery {
            limit: None,
            level: Some("ERROR".to_string()),
            keyword: None,
        });
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "something broke");

        let keyword = collector.query(&RustLogQuery {
            limit: None,
            level: None,
            keyword: Some("hello".to_string()),
        });
        assert_eq!(keyword.len(), 1);
    }

    #[test]
    fn ring_buffer_evicts_old() {
        let collector = RustLogCollector {
            entries: Mutex::new(VecDeque::with_capacity(3)),
            max_entries: 3,
        };
        collector.push("INFO", "a".to_string());
        collector.push("INFO", "b".to_string());
        collector.push("INFO", "c".to_string());
        collector.push("INFO", "d".to_string()); // evicts "a"

        let all = collector.query(&RustLogQuery {
            limit: None,
            level: None,
            keyword: None,
        });
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].message, "d");
        assert_eq!(all[2].message, "b");
    }

    #[test]
    fn clear_empties() {
        let collector = RustLogCollector {
            entries: Mutex::new(VecDeque::with_capacity(10)),
            max_entries: 10,
        };
        collector.push("INFO", "test".to_string());
        assert_eq!(
            collector
                .query(&RustLogQuery {
                    limit: None,
                    level: None,
                    keyword: None
                })
                .len(),
            1
        );
        collector.clear();
        assert_eq!(
            collector
                .query(&RustLogQuery {
                    limit: None,
                    level: None,
                    keyword: None
                })
                .len(),
            0
        );
    }
}
