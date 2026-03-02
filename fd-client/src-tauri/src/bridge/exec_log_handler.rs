//! Execution log HTTP handlers.
//!
//! CRUD endpoints for the local SQLite execution log store.

use axum::extract::{Json, Path, Query, State};
use axum::http::StatusCode;

use crate::execution_log::{ExecLogConfig, ExecLogQuery};

use super::types::*;
use super::LogState;

pub async fn list_exec_logs(
    State(state): State<LogState>,
    Query(params): Query<ExecLogQueryParams>,
) -> LogPageResult {
    let q = ExecLogQuery {
        agent_code: params.agent_code,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
    };

    match state.log_store.query(&q) {
        Ok(page) => (StatusCode::OK, Json(ok_response(page))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn get_exec_log_detail(
    State(state): State<LogState>,
    Path(id): Path<i64>,
) -> LogEntryResult {
    match state.log_store.get_detail(id) {
        Ok(Some(entry)) => (StatusCode::OK, Json(ok_response(entry))),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(err_response(format!("Log entry {} not found", id))),
        ),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn get_exec_log_config(
    State(state): State<LogState>,
    Query(params): Query<ExecLogConfigQueryParams>,
) -> LogConfigResult {
    match state.log_store.get_config(params.agent_code.as_deref()) {
        Ok(configs) => (StatusCode::OK, Json(ok_response(configs))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn set_exec_log_config(
    State(state): State<LogState>,
    Json(config): Json<ExecLogConfig>,
) -> UnitResult {
    match state.log_store.set_config(&config) {
        Ok(()) => (StatusCode::OK, Json(ok_response(()))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}

pub async fn cleanup_exec_logs(
    State(state): State<LogState>,
    body: Option<Json<CleanupRequest>>,
) -> U32Result {
    let result = match body {
        Some(Json(req)) if req.agent_code.is_some() => {
            let agent_code = req.agent_code.as_deref().unwrap();
            let retention_days = req.retention_days.unwrap_or(30);
            state
                .log_store
                .cleanup_agent(agent_code, retention_days)
        }
        _ => state.log_store.cleanup(),
    };

    match result {
        Ok(count) => (StatusCode::OK, Json(ok_response(count))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(err_response(e))),
    }
}
