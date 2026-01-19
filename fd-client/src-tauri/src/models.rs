use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: u64,
    pub body_text: String,
    pub user_id: Option<u64>,
    pub created_at: String, // Keep as string for simplicity, or use chrono::DateTime
    pub updated_at: Option<String>,
    #[serde(default)]
    pub incoming: bool,
    #[serde(default)]
    pub private: bool,
    pub source: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ticket {
    pub id: u64,
    pub subject: Option<String>,
    pub description_text: Option<String>,
    pub status: i32,
    pub priority: i32,
    pub created_at: String,
    pub updated_at: String,
    pub requester_id: Option<u64>,
    pub responder_id: Option<u64>,
    #[serde(default)]
    pub cc_emails: Vec<String>,
    #[serde(default)]
    pub conversations: Vec<Conversation>,
    #[serde(default)]
    pub available_langs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncState {
    pub last_updated_at: Option<String>,
}
