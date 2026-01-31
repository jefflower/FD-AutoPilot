use lapin::{
    options::*, types::{FieldTable, AMQPValue, ShortString}, Connection, ConnectionProperties,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

use crate::ai::GeminiClient;
use crate::models::Ticket;
use crate::settings::Settings;
use crate::storage::Storage;

/// 翻译任务队列名称
const TRANSLATE_QUEUE: &str = "q.ticket.translation";
/// 回复任务队列名称
const REPLY_QUEUE: &str = "q.ticket.reply";

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
    pub current_task: Arc<tokio::sync::Mutex<Option<String>>>,
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
            current_task: Arc::new(tokio::sync::Mutex::new(None)),
            batch_size: Arc::new(AtomicU32::new(1)),
            translating_tickets: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            completed_tickets: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            pending_acks: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        }
    }
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

    pub fn get_state(&self) -> MqConsumerState {
        self.state.clone()
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
        let queue_name = if queue_type == "translate" {
            TRANSLATE_QUEUE
        } else {
            REPLY_QUEUE
        };

        if self.state.is_running.load(Ordering::SeqCst) {
            return Err("Consumer already running".to_string());
        }

        self.state.is_running.store(true, Ordering::SeqCst);
        GeminiClient::log(&app, &format!("🐰 Connecting to RabbitMQ for {}...", queue_name));

        let conn = self.connect().await?;
        let channel = conn
            .create_channel()
            .await
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        // 设置 QoS (prefetch count)，控制并发消费数量
        // 对于回复任务，强制设为 1，因为 NotebookLM 影子窗口同一时间只能处理一个
        let batch_size = if queue_type == "reply" { 1 } else { self.state.batch_size.load(Ordering::SeqCst) as u16 };
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
                            let app_clone = app.clone();
                            let channel_clone = channel.clone();
                            let self_clone = self.clone();
                            let auth_token_clone = auth_token.clone();
                            let q_type = queue_type.to_string();

                            // 派发到异步任务处理，实现并发 (受 QoS prefetch 限制)
                            tokio::spawn(async move {
                                if q_type == "translate" {
                                    self_clone.handle_delivery(app_clone, channel_clone, delivery, auth_token_clone).await;
                                } else {
                                    self_clone.handle_reply_delivery(app_clone, channel_clone, delivery, auth_token_clone).await;
                                }
                            });
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
        self.state.is_running.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// 处理单个消息
    async fn handle_delivery(
        &self,
        app: AppHandle,
        channel: lapin::Channel,
        delivery: lapin::message::Delivery,
        auth_token: String,
    ) {
        let _data = String::from_utf8_lossy(&delivery.data);
        let preview = _data.chars().take(200).collect::<String>();
        GeminiClient::log(&app, &format!("📨 Raw MQ Message (len: {}): {}{}", _data.len(), preview, if _data.len() > 200 { "..." } else { "" }));

        // 解析消息
        match serde_json::from_slice::<TranslationMessage>(&delivery.data) {
            Ok(msg) => {
                GeminiClient::log(&app, &format!("📝 Processing ticket #{} (external_id: {})", msg.ticket_id, msg.payload.external_id));
                
                let started_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                
                let translating_ticket = TranslatingTicket {
                    ticket_id: msg.ticket_id,
                    external_id: msg.payload.external_id.clone(),
                    subject: msg.payload.subject.clone().unwrap_or_default(),
                    started_at,
                };

                // 添加到翻译中列表
                {
                    let mut translating = self.state.translating_tickets.lock().await;
                    translating.push(translating_ticket.clone());
                }
                
                // 执行翻译并提交
                let result = self.translate_and_submit(&app, &msg, &auth_token).await;
                
                let completed_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                
                // 从翻译中列表移除
                {
                    let mut translating = self.state.translating_tickets.lock().await;
                    translating.retain(|t| t.ticket_id != msg.ticket_id);
                }
                
                // 添加到已完成列表
                {
                    let completed_ticket = CompletedTicket {
                        ticket_id: msg.ticket_id,
                        external_id: msg.payload.external_id.clone(),
                        subject: msg.payload.subject.clone().unwrap_or_default(),
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
                
                match result {
                    Ok(_) => {
                        GeminiClient::log(&app, &format!("✅ Ticket #{} processing completed and saved", msg.ticket_id));
                        // 任务成功完成且保存成功后 ACK 消息
                        let _ = channel
                            .basic_ack(delivery.delivery_tag, BasicAckOptions::default())
                            .await;
                    }
                    Err(ref e) => {
                        GeminiClient::log(&app, &format!("❌ Translation failed for ticket #{}: {}", msg.ticket_id, e));
                        // 失败则 NACK 且不重新入队，防止无限循环抢占资源
                        let _ = channel
                            .basic_nack(delivery.delivery_tag, BasicNackOptions { requeue: false, ..Default::default() })
                            .await;
                    }
                }
            }
            Err(e) => {
                GeminiClient::log(&app, &format!("❌ Failed to parse message: {}", e));
                // 格式错误无法解析，ACK 避免死循环
                let _ = channel
                    .basic_ack(delivery.delivery_tag, BasicAckOptions::default())
                    .await;
            }
        }
    }

    /// 处理回复消息
    async fn handle_reply_delivery(
        &self,
        app: AppHandle,
        channel: lapin::Channel,
        delivery: lapin::message::Delivery,
        auth_token: String,
    ) {
        let _data = String::from_utf8_lossy(&delivery.data);
        GeminiClient::log(&app, &format!("📨 Received Reply Task MQ Message (len: {})", _data.len()));

        match serde_json::from_slice::<ReplyMessage>(&delivery.data) {
            Ok(msg) => {
                GeminiClient::log(&app, &format!("📝 Processing reply for ticket #{}", msg.ticket_id));
                
                let started_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                
                // 复用 TranslatingTicket 结构体
                let translating_ticket = TranslatingTicket {
                    ticket_id: msg.ticket_id,
                    external_id: "Loading...".to_string(),
                    subject: "Loading...".to_string(),
                    started_at,
                };

                {
                    let mut translating = self.state.translating_tickets.lock().await;
                    translating.push(translating_ticket);
                }
                
                // (注意：generate_reply_and_submit 内部会负责注册 ACK 等待信号)

                // 通知前端开始处理，并在这里等待结果（generate_reply_and_submit 内部已包含 rx 等待）
                let result = self.generate_reply_and_submit(&app, &msg, &auth_token).await;
                let final_success = result.is_ok();

                let completed_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                
                let mut ticket_info = (msg.ticket_id.to_string(), "Reply Task".to_string());
                
                {
                    let mut translating = self.state.translating_tickets.lock().await;
                    if let Some(pos) = translating.iter().position(|t| t.ticket_id == msg.ticket_id) {
                        let t = translating.remove(pos);
                        ticket_info = (t.external_id, t.subject);
                    }
                }
                
                {
                    let completed_ticket = CompletedTicket {
                        ticket_id: msg.ticket_id,
                        external_id: ticket_info.0,
                        subject: ticket_info.1,
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
                
                if final_success {
                    GeminiClient::log(&app, &format!("✅ Reply task for ticket #{} completed and ACKed", msg.ticket_id));
                    let _ = channel.basic_ack(delivery.delivery_tag, BasicAckOptions::default()).await;
                } else {
                    GeminiClient::log(&app, &format!("❌ Reply task for ticket #{} failed or timed out, NACKing (no requeue)", msg.ticket_id));
                    let _ = channel.basic_nack(delivery.delivery_tag, BasicNackOptions { requeue: false, ..Default::default() }).await;
                }

                // 确保从 map 中移除（以防超时或其他异常残留）
                {
                    let mut p_acks = self.state.pending_acks.lock().await;
                    p_acks.remove(&msg.ticket_id);
                }
            }
            Err(e) => {
                GeminiClient::log(&app, &format!("❌ Failed to parse reply message: {}", e));
                let _ = channel.basic_ack(delivery.delivery_tag, BasicAckOptions::default()).await;
            }
        }
    }

    /// 停止消费
    #[allow(dead_code)]
    pub fn stop(&self) {
        self.state.is_running.store(false, Ordering::SeqCst);
    }

    /// 翻译并提交结果 (改为发送事件通知前端处理)
    async fn translate_and_submit(
        &self,
        app: &AppHandle,
        msg: &TranslationMessage,
        auth_token: &str,
    ) -> Result<(), String> {
        let settings = crate::settings::load_settings(app);
        // 1. 从 API 获取最新完整工单数据 (包含 conversations)
        let client = reqwest::Client::new();
        let get_url = format!("{}/tickets/{}", SERVER_API_URL, msg.ticket_id);
        
        let resp = client.get(&get_url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch ticket from server: {}", e))?;
        
        let api_resp: RustApiResponse<Ticket> = resp.json()
            .await
            .map_err(|e| format!("Failed to parse ticket response: {}", e))?;
        
        let original_ticket = api_resp.data.ok_or_else(|| format!("Ticket #{} not found on server", msg.ticket_id))?;
        
        // 2. 调用 AI 模块进行翻译 (后端直接调用，并发受 QoS 限制)
        GeminiClient::log(app, &format!("⚙️ Backend AI translating ticket #{}...", msg.ticket_id));
        let target_lang = settings.translation_lang.clone();
        let translated = GeminiClient::translate_ticket(app, &original_ticket, &target_lang).await?;
        
        // 3. 保存到本地存储
        let storage = Storage::new(&settings.output_dir);
        storage.save_ticket(&translated, Some(&target_lang))?;
        
        // 4. 提交到服务端
        GeminiClient::log(app, &format!("📤 Submitting translation for ticket #{} to server...", msg.ticket_id));
        
        // 构造服务端期望的 JSON 结构 (与前端 ServerTicketDetail.tsx:L194 一致)
        let translated_conversations: Vec<serde_json::Value> = translated.conversations.iter().map(|c| {
            serde_json::json!({
                "id": c.id,
                "bodyText": c.body_text,
                "userId": c.user_id,
                "createdAt": c.created_at,
                "incoming": c.incoming,
                "isPrivate": c.private
            })
        }).collect();

        let final_translated_content = serde_json::json!({
            "description": translated.description_text,
            "conversations": translated_conversations
        }).to_string();

        let submit_data = serde_json::json!({
            "targetLang": target_lang,
            "translatedTitle": translated.subject.clone().unwrap_or_default(),
            "translatedContent": final_translated_content
        });

        let post_url = format!("{}/tickets/{}/translation", SERVER_API_URL, msg.ticket_id);
        let submit_resp = client.post(&post_url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .json(&submit_data)
            .send()
            .await
            .map_err(|e| format!("Failed to submit translation to server: {}", e))?;

        if !submit_resp.status().is_success() {
            let status = submit_resp.status();
            let body = submit_resp.text().await.unwrap_or_default();
            return Err(format!("Server returned error during translation submission ({}): {}", status, body));
        }

        GeminiClient::log(app, &format!("✅ Translation for ticket #{} successfully submitted to server", msg.ticket_id));

        // 5. 发出事件通知前端刷新
        use tauri::Emitter;
        let _ = app.emit("ticket-updated", msg.ticket_id);
        
        Ok(())
    }

    /// 生成回复并提交 (已弃用直接调用，改为通知前端)
    async fn generate_reply_and_submit(
        &self,
        app: &AppHandle,
        msg: &ReplyMessage,
        auth_token: &str,
    ) -> Result<(), String> {
        let client = reqwest::Client::new();
        let get_url = format!("{}/tickets/{}", SERVER_API_URL, msg.ticket_id);
        
        let resp = client.get(&get_url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch ticket from server: {}", e))?;
        
        let api_resp: RustApiResponse<Ticket> = resp.json()
            .await
            .map_err(|e| format!("Failed to parse ticket response: {}", e))?;
        
        let server_ticket = api_resp.data.ok_or_else(|| format!("Ticket #{} not found on server", msg.ticket_id))?;
        
        {
            let mut translating = self.state.translating_tickets.lock().await;
            if let Some(t) = translating.iter_mut().find(|t| t.ticket_id == msg.ticket_id) {
                t.external_id = server_ticket.external_id.clone().unwrap_or_default();
                t.subject = server_ticket.subject.clone().unwrap_or_default();
            }
        }

        // 注册 ACK 等待信号
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut p_acks = self.state.pending_acks.lock().await;
            p_acks.insert(msg.ticket_id, tx);
        }

        // --- 核心改动：发出事件通知前端处理 ---
        use tauri::Emitter;
        let payload = serde_json::json!({
            "ticketId": msg.ticket_id,
            "externalId": server_ticket.external_id,
            "subject": server_ticket.subject,
            "description": server_ticket.description_text,
            "conversations": server_ticket.conversations,
            "authToken": auth_token,
        });
        
        app.emit("mq-reply-request", payload.to_string())
            .map_err(|e| format!("Failed to emit mq-reply-request: {}", e))?;

        GeminiClient::log(app, &format!("📡 Emitted mq-reply-request for ticket #{}", msg.ticket_id));
        
        // 等待前端完成信号（或者超时/失败）
        match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
            Ok(Ok(success)) => {
                if success {
                    Ok(())
                } else {
                    Err("Frontend reported failure in reply task".to_string())
                }
            }
            _ => {
                GeminiClient::log(app, &format!("⏳ Reply task for ticket #{} timed out waiting for frontend", msg.ticket_id));
                Err("Reply task timed out".to_string())
            }
        }
    }
}
