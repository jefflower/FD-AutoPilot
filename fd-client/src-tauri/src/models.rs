use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: u64,
    pub body_text: String,
    pub user_id: Option<u64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub incoming: bool,
    #[serde(default)]
    pub private: bool,
    pub source: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TicketStatus {
    PendingTrans,
    PendingReply,
    PendingAudit,
    Completed,
    #[serde(untagged)]
    Unknown(serde_json::Value),
}

impl std::fmt::Display for TicketStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PendingTrans => write!(f, "PENDING_TRANS"),
            Self::PendingReply => write!(f, "PENDING_REPLY"),
            Self::PendingAudit => write!(f, "PENDING_AUDIT"),
            Self::Completed => write!(f, "COMPLETED"),
            Self::Unknown(v) => write!(f, "{}", v),
        }
    }
}

impl Default for TicketStatus {
    fn default() -> Self {
        Self::PendingTrans
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: u64,
    pub external_id: Option<String>,
    pub subject: Option<String>,
    pub description_text: Option<String>,
    pub content: Option<String>,
    #[serde(default)]
    pub status: TicketStatus,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
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
