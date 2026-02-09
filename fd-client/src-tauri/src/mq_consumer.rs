use lapin::{
    options::*, types::{FieldTable, AMQPValue, ShortString}, Connection, ConnectionProperties,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::ai::GeminiClient;
use crate::models::Ticket;
use crate::settings::Settings;

/// 翻译任务队列名称
const TRANSLATE_QUEUE: &str = "q.ticket.translation";
/// 回复任务队列名称
const REPLY_QUEUE: &str = "q.ticket.reply";
/// 审核任务队列名称
const AUDIT_QUEUE: &str = "q.ticket.audit";

/// 服务端 API 地址
const SERVER_API_URL: &str = "http://localhost:9988/api/v1";

/// MQ 配置
#[derive(Clone, Debug)]
pub struct MqConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl MqConfig {
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            host: settings.mq_host.clone(),
            port: settings.mq_port,
            username: settings.mq_username.clone(),
            password: settings.mq_password.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDto {
    pub id: u64,
    pub body_text: String,
    pub is_private: Option<bool>,
    pub incoming: Option<bool>,
    pub user_id: Option<u64>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TicketContent {
    pub description: Option<String>,
    pub conversations: Option<Vec<ConversationDto>>,
}

/// MQ 消息结构
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationMessage {
    pub msg_id: String,
    pub ticket_id: i64,
    pub timestamp: i64,
    pub payload: TranslationPayload,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPayload {
    pub external_id: String,
    pub subject: Option<String>,
    pub content: Option<String>,
}

/// 回复消息结构
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyMessage {
    pub msg_id: String,
    pub ticket_id: i64,
    pub timestamp: i64,
}

/// 翻译结果
#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResult {
    pub ticket_id: i64,
    pub external_id: String,
    pub translated_title: String,
    pub translated_content: String,
    pub target_lang: String,
}

/// 服务端通用的 API 响应包装
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RustApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
}

/// 翻译中的工单信息
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatingTicket {
    pub ticket_id: i64,
    pub external_id: String,
    pub subject: String,
    pub started_at: i64,  // Unix timestamp (毫秒)
}

/// 已完成翻译的工单信息
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTicket {
    pub ticket_id: i64,
    pub external_id: String,
    pub subject: String,
    pub started_at: i64,
    pub completed_at: i64,
    pub duration_ms: i64,  // 耗时(毫秒)
    pub success: bool,
    pub error_message: Option<String>,
}

/// MQ 消费者状态
#[derive(Clone)]
pub struct MqConsumerState {
    pub is_running: Arc<AtomicBool>,
    pub batch_size: Arc<AtomicU32>,
    pub translating_tickets: Arc<tokio::sync::Mutex<Vec<TranslatingTicket>>>,
    pub completed_tickets: Arc<tokio::sync::Mutex<Vec<CompletedTicket>>>,
    // 用于回复任务的 ACK 等待信号：ticket_id -> Sender
    pub pending_acks: Arc<tokio::sync::Mutex<std::collections::HashMap<i64, tokio::sync::oneshot::Sender<bool>>>>,
}

impl Default for MqConsumerState {
    fn default() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            batch_size: Arc::new(AtomicU32::new(1)),
            translating_tickets: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            completed_tickets: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            pending_acks: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        }
    }
}

/// Drop Guard: 确保 is_running 在 start_consuming 退出时（无论成功还是错误）都被重置为 false
struct RunGuard(Arc<AtomicBool>);
impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// 消息解析后的任务信息
struct TaskInfo {
    ticket_id: i64,
    initial_external_id: String,
    initial_subject: String,
}

/// MQ 消费者
#[derive(Clone)]
pub struct MqConsumer {
    config: MqConfig,
    state: MqConsumerState,
}

impl MqConsumer {
    /// 创建新的MQ消费者，使用外部传入的状态
    pub fn new_with_state(config: MqConfig, state: MqConsumerState) -> Self {
        Self {
            config,
            state,
        }
    }

    /// 连接到 RabbitMQ
    async fn connect(&self) -> Result<Connection, String> {
        let addr = format!(
            "amqp://{}:{}@{}:{}",
            self.config.username, self.config.password, self.config.host, self.config.port
        );
        
        Connection::connect(&addr, ConnectionProperties::default())
            .await
            .map_err(|e| format!("Failed to connect to RabbitMQ: {}", e))
    }

    /// 启动消费循环
    pub async fn start_consuming(
        &self,
        app: AppHandle,
        auth_token: String,
        queue_type: &str, // "translate" or "reply"
    ) -> Result<(), String> {
        let queue_name = match queue_type {
            "translate" => TRANSLATE_QUEUE,
            "reply" => REPLY_QUEUE,
            "audit" => AUDIT_QUEUE,
            _ => return Err(format!("Unknown queue type: {}", queue_type)),
        };

        if self.state.is_running.load(Ordering::SeqCst) {
            return Err("Consumer already running".to_string());
        }

        self.state.is_running.store(true, Ordering::SeqCst);
        // Guard 确保函数退出时（包括连接失败等错误路径）is_running 一定被重置为 false
        let _run_guard = RunGuard(self.state.is_running.clone());
        GeminiClient::log(&app, &format!("🐰 Connecting to RabbitMQ for {}...", queue_name));

        let conn = self.connect().await?;
        let channel = conn
            .create_channel()
            .await
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        // 设置 QoS (prefetch count)，控制并发消费数量
        // 对于回复任务，强制设为 1，因为 NotebookLM 影子窗口同一时间只能处理一个
        let batch_size = if queue_type == "reply" || queue_type == "audit" { 1 } else { self.state.batch_size.load(Ordering::SeqCst) as u16 };
        channel
            .basic_qos(batch_size, BasicQosOptions::default())
            .await
            .map_err(|e| format!("Failed to set QoS: {}", e))?;

        // 声明队列（如果不存在），必须与服务端的参数完全一致
        let mut arguments = FieldTable::default();
        arguments.insert(
            ShortString::from("x-dead-letter-exchange"),
            AMQPValue::LongString("".into()),
        );
        arguments.insert(
            ShortString::from("x-dead-letter-routing-key"),
            AMQPValue::LongString("q.ticket.dlq".into()),
        );

        channel
            .queue_declare(
                queue_name,
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                arguments,
            )
            .await
            .map_err(|e| format!("Failed to declare queue: {}", e))?;

        GeminiClient::log(&app, &format!("✅ Connected to RabbitMQ, consuming from {} (batch: {})", queue_name, batch_size));

        // 创建消费者
        let mut consumer = channel
            .basic_consume(
                queue_name,
                &format!("fd-client-consumer-{}", queue_type),
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await
            .map_err(|e| format!("Failed to create consumer: {}", e))?;

        // 消费循环
        while self.state.is_running.load(Ordering::SeqCst) {
            match tokio::time::timeout(std::time::Duration::from_secs(5), consumer.next()).await {
                Ok(Some(delivery_result)) => {
                    match delivery_result {
                        Ok(delivery) => {
                            // 收到消息后再次检查 is_running，防止 stop 后仍处理已到达的消息
                            if !self.state.is_running.load(Ordering::SeqCst) {
                                GeminiClient::log(&app, "🛑 Consumer stopped, rejecting received message (requeue)");
                                let _ = channel.basic_nack(
                                    delivery.delivery_tag,
                                    BasicNackOptions { requeue: true, ..Default::default() },
                                ).await;
                                break;
                            }

                            let app_clone = app.clone();
                            let channel_clone = channel.clone();
                            let self_clone = self.clone();
                            let auth_token_clone = auth_token.clone();
                            let q_type = queue_type.to_string();

                            // reply: 同步等待完成（串行执行）
                            // translate: 并发处理（tokio::spawn，受 QoS prefetch 限制）
                            if q_type == "reply" {
                                let auth_for_payload = auth_token_clone.clone();
                                self_clone.handle_message(
                                    app_clone, channel_clone, delivery, auth_token_clone,
                                    "REPLY", "mq-reply-request",
                                    |data| {
                                        let msg: ReplyMessage = serde_json::from_slice(data).map_err(|e| e.to_string())?;
                                        Ok(TaskInfo { ticket_id: msg.ticket_id, initial_external_id: "Loading...".into(), initial_subject: "Loading...".into() })
                                    },
                                    move |ticket, ticket_id| serde_json::json!({
                                        "ticketId": ticket_id,
                                        "externalId": ticket.external_id,
                                        "subject": ticket.subject,
                                        "description": ticket.description_text,
                                        "conversations": ticket.conversations,
                                        "authToken": auth_for_payload,
                                        "auditRemark": ticket.last_audit_remark,
                                    }),
                                ).await;
                            } else if q_type == "audit" {
                                // 审核任务：同步等待（人工审核，与 reply 相同串行模式）
                                let auth_for_payload = auth_token_clone.clone();
                                self_clone.handle_message(
                                    app_clone, channel_clone, delivery, auth_token_clone,
                                    "AUDIT", "mq-audit-request",
                                    |data| {
                                        let msg: ReplyMessage = serde_json::from_slice(data).map_err(|e| e.to_string())?;
                                        Ok(TaskInfo { ticket_id: msg.ticket_id, initial_external_id: "Loading...".into(), initial_subject: "Loading...".into() })
                                    },
                                    move |ticket, ticket_id| serde_json::json!({
                                        "ticketId": ticket_id,
                                        "externalId": ticket.external_id,
                                        "subject": ticket.subject,
                                        "status": ticket.status.to_string(),
                                        "authToken": auth_for_payload,
                                    }),
                                ).await;
                            } else if q_type == "translate" {
                                tokio::spawn(async move {
                                    self_clone.handle_message(
                                        app_clone, channel_clone, delivery, auth_token_clone,
                                        "TRANSLATE", "mq-translate-request",
                                        |data| {
                                            let msg: TranslationMessage = serde_json::from_slice(data).map_err(|e| e.to_string())?;
                                            Ok(TaskInfo {
                                                ticket_id: msg.ticket_id,
                                                initial_external_id: msg.payload.external_id,
                                                initial_subject: msg.payload.subject.unwrap_or_default(),
                                            })
                                        },
                                        |ticket, ticket_id| serde_json::json!({
                                            "ticketId": ticket_id,
                                            "externalId": ticket.external_id.clone().unwrap_or_default(),
                                            "subject": ticket.subject.clone().unwrap_or_default(),
                                        }),
                                    ).await;
                                });
                            }
                        }
                        Err(e) => {
                            GeminiClient::log(&app, &format!("❌ Delivery error: {}", e));
                        }
                    }
                }
                Ok(None) => {
                    // 消费者被关闭
                    break;
                }
                Err(_) => {
                    // 超时，继续循环检查 is_running 状态
                    continue;
                }
            }
        }

        GeminiClient::log(&app, "🛑 MQ Consumer stopped");
        // _run_guard 的 Drop 会自动将 is_running 设为 false
        Ok(())
    }

    /// 统一的消息处理框架
    ///
    /// 翻译和回复任务共用：检查运行状态 → 解析消息 → 管理任务生命周期 → ACK/NACK
    async fn handle_message(
        &self,
        app: AppHandle,
        channel: lapin::Channel,
        delivery: lapin::message::Delivery,
        auth_token: String,
        task_label: &str,
        event_name: &str,
        parse_fn: impl FnOnce(&[u8]) -> Result<TaskInfo, String>,
        build_payload: impl FnOnce(&Ticket, i64) -> serde_json::Value,
    ) {
        // 根据任务类型确定超时时间：审核任务 30 分钟（人工操作），其他 5 分钟
        let timeout_secs: u64 = if task_label == "AUDIT" { 1800 } else { 300 };
        // 1. 检查运行状态
        if !self.state.is_running.load(Ordering::SeqCst) {
            GeminiClient::log(&app, &format!("🛑 Consumer stopped, rejecting {} task (requeue)", task_label));
            let _ = channel.basic_nack(
                delivery.delivery_tag,
                BasicNackOptions { requeue: true, ..Default::default() },
            ).await;
            return;
        }

        // 2. 记录原始消息
        let raw = String::from_utf8_lossy(&delivery.data);
        GeminiClient::log(&app, &format!("📨 [{}] MQ Message (len: {})", task_label, raw.len()));

        // 3. 解析消息
        let task_info = match parse_fn(&delivery.data) {
            Ok(info) => info,
            Err(e) => {
                GeminiClient::log(&app, &format!("❌ Failed to parse {} message: {}", task_label, e));
                let _ = channel.basic_ack(delivery.delivery_tag, BasicAckOptions::default()).await;
                return;
            }
        };

        let ticket_id = task_info.ticket_id;
        GeminiClient::log(&app, &format!("📝 [{}] Processing ticket #{}", task_label, ticket_id));

        // 4. 记录开始时间 + 加入处理中列表
        let started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        {
            let mut translating = self.state.translating_tickets.lock().await;
            translating.push(TranslatingTicket {
                ticket_id,
                external_id: task_info.initial_external_id.clone(),
                subject: task_info.initial_subject.clone(),
                started_at,
            });
        }

        // 5. 通过前端执行任务
        let result = self.submit_via_frontend(
            &app, ticket_id, &auth_token, event_name, task_label, timeout_secs,
            |ticket| build_payload(ticket, ticket_id),
        ).await;

        // 6. 记录完成时间
        let completed_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        // 7. 从处理中列表移除，获取最终显示信息（submit_via_frontend 可能已更新）
        let (final_external_id, final_subject) = {
            let mut translating = self.state.translating_tickets.lock().await;
            if let Some(pos) = translating.iter().position(|t| t.ticket_id == ticket_id) {
                let t = translating.remove(pos);
                (t.external_id, t.subject)
            } else {
                (task_info.initial_external_id, task_info.initial_subject)
            }
        };

        // 8. 加入已完成列表
        {
            let completed_ticket = CompletedTicket {
                ticket_id,
                external_id: final_external_id,
                subject: final_subject,
                started_at,
                completed_at,
                duration_ms: completed_at - started_at,
                success: result.is_ok(),
                error_message: result.as_ref().err().cloned(),
            };
            let mut completed = self.state.completed_tickets.lock().await;
            completed.insert(0, completed_ticket);
            if completed.len() > 100 {
                completed.truncate(100);
            }
        }

        // 9. ACK/NACK
        match &result {
            Ok(_) => {
                GeminiClient::log(&app, &format!("✅ [{}] Ticket #{} completed", task_label, ticket_id));
                let _ = channel.basic_ack(delivery.delivery_tag, BasicAckOptions::default()).await;
            }
            Err(e) => {
                GeminiClient::log(&app, &format!("❌ [{}] Ticket #{} failed: {}", task_label, ticket_id, e));
                let _ = channel.basic_nack(
                    delivery.delivery_tag,
                    BasicNackOptions { requeue: false, ..Default::default() },
                ).await;
            }
        }

        // 10. 清理 pending_acks（安全兜底，防止超时/异常残留）
        {
            let mut p_acks = self.state.pending_acks.lock().await;
            p_acks.remove(&ticket_id);
        }
    }

    /// 停止消费
    #[allow(dead_code)]
    pub fn stop(&self) {
        self.state.is_running.store(false, Ordering::SeqCst);
    }

    /// 统一的前端任务提交函数（翻译和回复共用）
    ///
    /// 流程：检查运行状态 → 获取工单详情 → 更新显示信息 → 注册 ACK 信号 → 发送事件到前端 → 等待完成
    async fn submit_via_frontend(
        &self,
        app: &AppHandle,
        ticket_id: i64,
        auth_token: &str,
        event_name: &str,
        task_label: &str,
        timeout_secs: u64,
        build_payload: impl FnOnce(&Ticket) -> serde_json::Value,
    ) -> Result<(), String> {
        if !self.state.is_running.load(Ordering::SeqCst) {
            return Err(format!("Consumer stopped, aborting {} task", task_label));
        }

        GeminiClient::log(app, &format!("🔄 [MQ-{}] Triggering frontend for ticket #{}", task_label, ticket_id));

        // 1. 从服务端 API 获取工单详情
        let client = reqwest::Client::new();
        let resp = client.get(format!("{}/tickets/{}", SERVER_API_URL, ticket_id))
            .header("Authorization", format!("Bearer {}", auth_token))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch ticket from server: {}", e))?;

        let api_resp: RustApiResponse<Ticket> = resp.json()
            .await
            .map_err(|e| format!("Failed to parse ticket response: {}", e))?;

        let server_ticket = api_resp.data
            .ok_or_else(|| format!("Ticket #{} not found on server", ticket_id))?;

        // 再次检查（API 请求可能耗时）
        if !self.state.is_running.load(Ordering::SeqCst) {
            return Err(format!("Consumer stopped during API fetch, aborting {} task", task_label));
        }

        // 2. 更新状态中的显示信息
        {
            let mut translating = self.state.translating_tickets.lock().await;
            if let Some(t) = translating.iter_mut().find(|t| t.ticket_id == ticket_id) {
                t.external_id = server_ticket.external_id.clone().unwrap_or_default();
                t.subject = server_ticket.subject.clone().unwrap_or_default();
            }
        }

        // 3. 注册 ACK 等待信号
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut p_acks = self.state.pending_acks.lock().await;
            p_acks.insert(ticket_id, tx);
        }

        // 4. 构建 payload 并发送事件到前端
        let payload = build_payload(&server_ticket);
        app.emit(event_name, payload)
            .map_err(|e| format!("Failed to emit {}: {}", event_name, e))?;

        GeminiClient::log(app, &format!("📡 [MQ-{}] Event sent for ticket #{}, awaiting completion (timeout: {}s)...", task_label, ticket_id, timeout_secs));

        // 5. 等待前端完成信号
        match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(success)) => {
                if success {
                    GeminiClient::log(app, &format!("✅ [MQ-{}] Frontend reported success for ticket #{}", task_label, ticket_id));
                    Ok(())
                } else {
                    let err_msg = format!("Frontend reported failure for ticket #{}", ticket_id);
                    GeminiClient::log(app, &format!("❌ [MQ-{}] {}", task_label, err_msg));
                    Err(err_msg)
                }
            }
            Ok(Err(_)) => {
                let err_msg = format!("Frontend completion channel closed for ticket #{}", ticket_id);
                GeminiClient::log(app, &format!("❌ [MQ-{}] {}", task_label, err_msg));
                Err(err_msg)
            }
            Err(_) => {
                {
                    let mut p_acks = self.state.pending_acks.lock().await;
                    p_acks.remove(&ticket_id);
                }
                let err_msg = format!("Timed out waiting for frontend completion for ticket #{}", ticket_id);
                GeminiClient::log(app, &format!("❌ [MQ-{}] {}", task_label, err_msg));
                Err(err_msg)
            }
        }
    }
}
