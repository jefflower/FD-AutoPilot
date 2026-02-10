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
    Translating,
    PendingReply,
    Replying,
    PendingAudit,
    Auditing,
    Approved,
    Completed,
    #[serde(untagged)]
    Unknown(serde_json::Value),
}

impl std::fmt::Display for TicketStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PendingTrans => write!(f, "PENDING_TRANS"),
            Self::Translating => write!(f, "TRANSLATING"),
            Self::PendingReply => write!(f, "PENDING_REPLY"),
            Self::Replying => write!(f, "REPLYING"),
            Self::PendingAudit => write!(f, "PENDING_AUDIT"),
            Self::Auditing => write!(f, "AUDITING"),
            Self::Approved => write!(f, "APPROVED"),
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
    #[serde(default)]
    pub last_audit_remark: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TicketStatus serialization / deserialization ──

    #[test]
    fn ticket_status_deserialize_all_known_variants() {
        let cases = vec![
            ("\"PENDING_TRANS\"", TicketStatus::PendingTrans),
            ("\"TRANSLATING\"", TicketStatus::Translating),
            ("\"PENDING_REPLY\"", TicketStatus::PendingReply),
            ("\"REPLYING\"", TicketStatus::Replying),
            ("\"PENDING_AUDIT\"", TicketStatus::PendingAudit),
            ("\"AUDITING\"", TicketStatus::Auditing),
            ("\"APPROVED\"", TicketStatus::Approved),
            ("\"COMPLETED\"", TicketStatus::Completed),
        ];

        for (json, expected) in cases {
            let status: TicketStatus = serde_json::from_str(json).unwrap();
            assert_eq!(status, expected, "Failed to deserialize {}", json);
        }
    }

    #[test]
    fn ticket_status_unknown_falls_back() {
        let status: TicketStatus = serde_json::from_str("\"SOME_NEW_STATUS\"").unwrap();
        match status {
            TicketStatus::Unknown(v) => assert_eq!(v.as_str().unwrap(), "SOME_NEW_STATUS"),
            _ => panic!("Expected Unknown variant"),
        }
    }

    #[test]
    fn ticket_status_display() {
        assert_eq!(TicketStatus::PendingTrans.to_string(), "PENDING_TRANS");
        assert_eq!(TicketStatus::Translating.to_string(), "TRANSLATING");
        assert_eq!(TicketStatus::PendingReply.to_string(), "PENDING_REPLY");
        assert_eq!(TicketStatus::Replying.to_string(), "REPLYING");
        assert_eq!(TicketStatus::PendingAudit.to_string(), "PENDING_AUDIT");
        assert_eq!(TicketStatus::Auditing.to_string(), "AUDITING");
        assert_eq!(TicketStatus::Approved.to_string(), "APPROVED");
        assert_eq!(TicketStatus::Completed.to_string(), "COMPLETED");
    }

    #[test]
    fn ticket_status_default_is_pending_trans() {
        assert_eq!(TicketStatus::default(), TicketStatus::PendingTrans);
    }

    #[test]
    fn ticket_status_serialize_roundtrip() {
        let status = TicketStatus::Approved;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"APPROVED\"");
        let back: TicketStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back, TicketStatus::Approved);
    }

    // ── Ticket deserialization ──

    #[test]
    fn ticket_deserialize_minimal() {
        let json = r#"{"id": 1}"#;
        let ticket: Ticket = serde_json::from_str(json).unwrap();
        assert_eq!(ticket.id, 1);
        assert!(ticket.subject.is_none());
        assert!(ticket.description_text.is_none());
        assert_eq!(ticket.status, TicketStatus::PendingTrans); // default
        assert_eq!(ticket.priority, 0); // default
        assert!(ticket.conversations.is_empty());
        assert!(ticket.cc_emails.is_empty());
    }

    #[test]
    fn ticket_deserialize_full() {
        let json = r#"{
            "id": 42,
            "externalId": "EXT-001",
            "subject": "Test Subject",
            "descriptionText": "Test Description",
            "status": "REPLYING",
            "priority": 3,
            "conversations": [
                {
                    "id": 100,
                    "body_text": "Hello",
                    "incoming": true,
                    "private": false
                }
            ],
            "ccEmails": ["a@b.com"],
            "lastAuditRemark": "需要修改措辞"
        }"#;
        let ticket: Ticket = serde_json::from_str(json).unwrap();
        assert_eq!(ticket.id, 42);
        assert_eq!(ticket.external_id.as_deref(), Some("EXT-001"));
        assert_eq!(ticket.subject.as_deref(), Some("Test Subject"));
        assert_eq!(ticket.status, TicketStatus::Replying);
        assert_eq!(ticket.priority, 3);
        assert_eq!(ticket.conversations.len(), 1);
        assert_eq!(ticket.conversations[0].id, 100);
        assert!(ticket.conversations[0].incoming);
        assert_eq!(ticket.cc_emails, vec!["a@b.com"]);
        assert_eq!(ticket.last_audit_remark.as_deref(), Some("需要修改措辞"));
    }

    // ── Conversation ──

    #[test]
    fn conversation_defaults() {
        let json = r#"{"id": 1, "body_text": "msg"}"#;
        let conv: Conversation = serde_json::from_str(json).unwrap();
        assert!(!conv.incoming);
        assert!(!conv.private);
        assert!(conv.user_id.is_none());
        assert!(conv.created_at.is_none());
    }
}
