use crate::models::Ticket;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResult {
    #[serde(alias = "title")]
    pub subject: String,
    #[serde(alias = "content", alias = "body", alias = "description")]
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
    pub fn log(app: &AppHandle, msg: &str) {
        eprintln!("[GeminiLog] {}", msg);
        let _ = app.emit("log", msg.to_string());
    }

    pub async fn translate_ticket(
        app: &AppHandle,
        ticket: &Ticket,
        target_lang: &str,
    ) -> Result<Ticket, String> {
        Self::log(
            app,
            &format!("🤖 Translating ticket #{} to {}...", ticket.id, target_lang),
        );

        // Prepare prompt
        let lang_name = match target_lang {
            "cn" | "zh-CN" => "Simplified Chinese",
            "en" => "English",
            "jp" => "Japanese",
            _ => target_lang, // 兜底使用原始代码
        };
        let mut prompt = format!(
            "You are a professional customer support translator. \
            Translate the following support ticket into {}. \
            \
            CRITICAL INSTRUCTIONS:\
            1. Response must be ONLY a valid JSON object.\
            2. Do NOT include any intro, outro, explanations, or markdown blocks (like ```json).\
            3. You MUST translate BOTH the subject/description AND EVERY item in the 'conversations' list.\
            4. Maintain the original 'id' for each conversation item.\
            5. Ensure the content is ONLY in {} - DO NOT output in English if the target is {}.\
            6. JSON Structure Example:\
            {{\n  \"subject\": \"翻译后的标题\",\n  \"description_text\": \"翻译后的正文内容\",\n  \"conversations\": [\n    {{\"id\": 123, \"body_text\": \"翻译后的对话消息\"}}\n  ]\n}}\n\n",
            lang_name, lang_name, lang_name
        );

        prompt.push_str(&format!(
            "--- TICKET TO TRANSLATE ---\n\
            SUBJECT: {}\n",
            ticket.subject.clone().unwrap_or_default()
        ));
        if let Some(desc) = &ticket.description_text {
            prompt.push_str(&format!("DESCRIPTION: {}\n", desc));
        }

        if !ticket.conversations.is_empty() {
            prompt.push_str("CONVERSATIONS:\n");
            for c in &ticket.conversations {
                prompt.push_str(&format!("MSG_ID {}: {}\n", c.id, c.body_text));
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

        // Robust JSON extraction: Find the first '{' and the last '}'
        let start = stdout
            .find('{')
            .ok_or_else(|| format!("Failed to find JSON start '{{' in output: {}", stdout))?;
        let end = stdout
            .rfind('}')
            .ok_or_else(|| format!("Failed to find JSON end '}}' in output: {}", stdout))?;
        let clean_json = &stdout[start..=end];

        let translated_data: TranslationResult = serde_json::from_str(clean_json).map_err(|e| {
            format!(
                "Failed to parse translation JSON: {}. Extracted: {}",
                e, clean_json
            )
        })?;

        // Create new ticket with translated content
        let mut new_ticket = ticket.clone();
        // Use translated subject if not empty, otherwise keep original
        if !translated_data.subject.trim().is_empty() {
            new_ticket.subject = Some(translated_data.subject);
        }

        // If AI returns an empty string or None, fallback to original content
        new_ticket.description_text = match translated_data.description_text {
            Some(ref s) if !s.trim().is_empty() => Some(s.clone()),
            _ => ticket.description_text.clone(),
        };

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

        Self::log(
            app,
            &format!(
                "✅ Translation to {} complete. Result: Title({} chars), Desc({} chars), Conversations({} items)",
                target_lang,
                new_ticket.subject.as_ref().map(|s| s.len()).unwrap_or(0),
                new_ticket.description_text.as_ref().map(|s| s.len()).unwrap_or(0),
                new_ticket.conversations.len()
            ),
        );
        Ok(new_ticket)
    }
}
