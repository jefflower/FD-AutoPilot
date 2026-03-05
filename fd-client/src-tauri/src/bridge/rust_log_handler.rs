//! Rust runtime log HTTP handlers.
//!
//! Exposes the global RustLogCollector via Bridge HTTP endpoints.

use axum::extract::{Json, Query};
use axum::http::StatusCode;
use serde::Deserialize;

use crate::rust_log::{RustLogCollector, RustLogQuery};

use super::types::*;

#[derive(Debug, Deserialize)]
pub struct RustLogQueryParams {
    pub limit: Option<usize>,
    pub level: Option<String>,
    pub keyword: Option<String>,
}

pub async fn list_rust_logs(
    Query(params): Query<RustLogQueryParams>,
) -> (StatusCode, Json<BridgeResponse<Vec<crate::rust_log::RustLogEntry>>>) {
    let q = RustLogQuery {
        limit: params.limit,
        level: params.level,
        keyword: params.keyword,
    };
    let entries = RustLogCollector::global().query(&q);
    (StatusCode::OK, Json(ok_response(entries)))
}

pub async fn clear_rust_logs() -> (StatusCode, Json<BridgeResponse<&'static str>>) {
    RustLogCollector::global().clear();
    (StatusCode::OK, Json(ok_response("cleared")))
}
