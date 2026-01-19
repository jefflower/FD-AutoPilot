use crate::models::Ticket;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResult {
    pub subject: String,
    pub description_text: Option<String>,
    pub conversations: Vec<ConversationTranslation>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationTranslation {
    #[serde(deserialize_with = "deserialize_id")]
    pub id: u64,
    pub body_text: String,
}

fn deserialize_id<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        String(String),
        Number(u64),
    }

    match StringOrNumber::deserialize(deserializer)? {
        StringOrNumber::String(s) => s.parse::<u64>().map_err(serde::de::Error::custom),
        StringOrNumber::Number(n) => Ok(n),
    }
}

pub struct GeminiClient;

impl GeminiClient {
    fn log(app: &AppHandle, msg: &str) {
        let _ = app.emit("log", msg.to_string());
    }

    pub fn translate_ticket(
        app: &AppHandle,
        ticket: &Ticket,
        target_lang: &str,
    ) -> Result<Ticket, String> {
        Self::log(
            app,
            &format!("🤖 Translating ticket #{} to {}...", ticket.id, target_lang),
        );

        // Prepare prompt
        let mut prompt = format!(
            "Translate the following customer support ticket content to {}. \
            Return ONLY a valid JSON object with the translated fields. \
            Do not include markdown formatting or code blocks. \
            The JSON structure must match this example: \
            {{ \"subject\": \"Translated Subject\", \"description_text\": \"Translated Description\", \"conversations\": [ {{ \"id\": 123, \"body_text\": \"Translated Body\" }} ] }}\n\n",
            if target_lang == "cn" { "Simplified Chinese" } else { "English" }
        );

        prompt.push_str(&format!(
            "Subject: {}\n",
            ticket.subject.clone().unwrap_or_default()
        ));
        if let Some(desc) = &ticket.description_text {
            prompt.push_str(&format!("Description: {}\n", desc));
        }

        if !ticket.conversations.is_empty() {
            prompt.push_str("Conversations:\n");
            for c in &ticket.conversations {
                prompt.push_str(&format!("ID {}: {}\n", c.id, c.body_text));
            }
        }

        // Call gemini CLI
        let output = Command::new("gemini")
            .arg(&prompt)
            .output()
            .map_err(|e| format!("Failed to execute gemini: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Gemini CLI error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Clean up markdown code blocks if present
        let clean_json = stdout
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        let translated_data: TranslationResult = serde_json::from_str(clean_json).map_err(|e| {
            format!(
                "Failed to parse translation JSON: {}. Output: {}",
                e, clean_json
            )
        })?;

        // Create new ticket with translated content
        // Create new ticket with translated content
        let mut new_ticket = ticket.clone();
        new_ticket.subject = Some(translated_data.subject);
        new_ticket.description_text = translated_data
            .description_text
            .or(ticket.description_text.clone());

        if !new_ticket.conversations.is_empty() {
            for conv in new_ticket.conversations.iter_mut() {
                if let Some(trans_conv) = translated_data
                    .conversations
                    .iter()
                    .find(|tc| tc.id == conv.id)
                {
                    conv.body_text = trans_conv.body_text.clone();
                }
            }
        }

        Self::log(app, &format!("✅ Translation to {} complete.", target_lang));
        Ok(new_ticket)
    }
}
