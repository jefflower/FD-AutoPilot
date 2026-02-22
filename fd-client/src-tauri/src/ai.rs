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

/// Extract JSON object from a string by finding the first '{' and last '}'.
/// Used to strip markdown fences and surrounding text from AI output.
pub fn extract_json_object(raw: &str) -> Result<&str, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| format!("Failed to find JSON start '{{' in output: {}", raw))?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| format!("Failed to find JSON end '}}' in output: {}", raw))?;
    Ok(&raw[start..=end])
}

/// Map a short language code to a full language name.
pub fn lang_code_to_name(code: &str) -> &str {
    match code {
        "cn" | "zh-CN" => "Simplified Chinese",
        "en" => "English",
        "jp" => "Japanese",
        _ => code,
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
        system_prompt: Option<&str>,
    ) -> Result<Ticket, String> {
        Self::log(
            app,
            &format!("🤖 Translating ticket #{} to {}...", ticket.id, target_lang),
        );

        // Prepare prompt
        let lang_name = lang_code_to_name(target_lang);
        let mut prompt = match system_prompt {
            Some(sp) if !sp.trim().is_empty() => {
                // 使用外部传入的 systemPrompt，替换占位符
                let mut p = sp.replace("${TARGET_LANG}", lang_name);
                p.push_str("\n\n");
                p
            }
            _ => {
                // 使用默认硬编码的 systemPrompt
                format!(
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
                )
            }
        };

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
        let clean_json = extract_json_object(&stdout)?;

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

    /// Generic gemini CLI execution: takes a fully constructed prompt and a list of models (priority ordered).
    /// Tries each model in order; returns raw stdout on the first success.
    pub async fn execute_gemini(
        app: &AppHandle,
        prompt: &str,
        models: &[String],
    ) -> Result<String, String> {
        let models_to_try: Vec<&str> = if models.is_empty() {
            vec![""]
        } else {
            models.iter().map(|s| s.as_str()).collect()
        };

        Self::log(
            app,
            &format!(
                "🤖 Executing gemini CLI with {} model(s): [{}]",
                models_to_try.len(),
                models_to_try.join(", ")
            ),
        );

        let mut last_error = String::new();

        for (i, model) in models_to_try.iter().enumerate() {
            Self::log(
                app,
                &format!(
                    "  Trying model: {} ({}/{})",
                    if model.is_empty() { "default" } else { model },
                    i + 1,
                    models_to_try.len()
                ),
            );

            let mut cmd = Command::new("gemini");
            if !model.is_empty() {
                cmd.arg("--model").arg(model);
            }
            cmd.arg(prompt);

            match cmd.output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    Self::log(
                        app,
                        &format!(
                            "  ✅ Success with model: {}, output: {} chars",
                            if model.is_empty() { "default" } else { model },
                            stdout.len()
                        ),
                    );
                    return Ok(stdout);
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    Self::log(
                        app,
                        &format!(
                            "  ❌ Model {} failed: {}",
                            if model.is_empty() { "default" } else { model },
                            stderr
                        ),
                    );
                    last_error = stderr;
                    // Continue to next model
                }
                Err(e) => {
                    return Err(format!("Failed to execute gemini: {}", e));
                }
            }
        }

        Err(format!("All models failed. Last error: {}", last_error))
    }

    /// Sync-translate a reply: given both language versions and a direction,
    /// translate one side to match the other using Gemini CLI.
    pub async fn sync_translate_reply(
        app: &AppHandle,
        source_text: &str,
        reference_text: &str,
        direction: &str,
        target_lang: &str,
    ) -> Result<String, String> {
        let lang_name = lang_code_to_name(target_lang);

        let (from_label, to_label, translate_from, translate_to) = match direction {
            "zh_to_target" => ("Chinese", lang_name, source_text, reference_text),
            "target_to_zh" => (lang_name, "Chinese", source_text, reference_text),
            _ => return Err(format!("Unknown direction: {}", direction)),
        };

        Self::log(
            app,
            &format!("🔄 Sync translating reply: {} → {}...", from_label, to_label),
        );

        let prompt = format!(
            "You are a professional customer support translator.\n\
            \n\
            Below are two versions of a customer support reply:\n\
            \n\
            --- VERSION A ({}) ---\n\
            {}\n\
            \n\
            --- VERSION B ({}) ---\n\
            {}\n\
            \n\
            TASK: Translate VERSION A from {} into {}.\n\
            Use VERSION B as reference for context and tone, but produce a fresh translation of VERSION A.\n\
            \n\
            CRITICAL RULES:\n\
            1. Output ONLY the translated text. No explanations, no labels, no markdown.\n\
            2. Maintain the same tone, formatting, and paragraph structure as VERSION A.\n\
            3. The output must be entirely in {}.",
            from_label, translate_from,
            to_label, translate_to,
            from_label, to_label,
            to_label
        );

        let output = Command::new("gemini")
            .arg(&prompt)
            .output()
            .map_err(|e| format!("Failed to execute gemini: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Gemini CLI error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        Self::log(
            app,
            &format!("✅ Sync translation complete ({} → {}), result: {} chars", from_label, to_label, stdout.len()),
        );

        Ok(stdout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_json_object ──

    #[test]
    fn extract_json_from_clean_input() {
        let input = r#"{"subject":"Hello","description_text":"World"}"#;
        assert_eq!(extract_json_object(input).unwrap(), input);
    }

    #[test]
    fn extract_json_from_markdown_fenced_output() {
        let input = "Here is the translation:\n```json\n{\"subject\":\"你好\"}\n```\nDone!";
        assert_eq!(
            extract_json_object(input).unwrap(),
            r#"{"subject":"你好"}"#
        );
    }

    #[test]
    fn extract_json_with_nested_braces() {
        let input = r#"prefix {"a":{"b":"c"}} suffix"#;
        assert_eq!(
            extract_json_object(input).unwrap(),
            r#"{"a":{"b":"c"}}"#
        );
    }

    #[test]
    fn extract_json_no_opening_brace() {
        let input = "no json here";
        assert!(extract_json_object(input).is_err());
    }

    #[test]
    fn extract_json_no_closing_brace() {
        let input = "start { but never close";
        // rfind('}') will fail
        assert!(extract_json_object(input).is_err());
    }

    // ── lang_code_to_name ──

    #[test]
    fn lang_code_chinese_variants() {
        assert_eq!(lang_code_to_name("cn"), "Simplified Chinese");
        assert_eq!(lang_code_to_name("zh-CN"), "Simplified Chinese");
    }

    #[test]
    fn lang_code_english() {
        assert_eq!(lang_code_to_name("en"), "English");
    }

    #[test]
    fn lang_code_japanese() {
        assert_eq!(lang_code_to_name("jp"), "Japanese");
    }

    #[test]
    fn lang_code_unknown_passthrough() {
        assert_eq!(lang_code_to_name("ko"), "ko");
        assert_eq!(lang_code_to_name("fr"), "fr");
    }

    // ── TranslationResult deserialization ──

    #[test]
    fn deserialize_translation_result_standard() {
        let json = r#"{
            "subject": "翻译后的标题",
            "description_text": "翻译后的正文",
            "conversations": [
                {"id": 123, "body_text": "翻译后的对话"}
            ]
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.subject, "翻译后的标题");
        assert_eq!(result.description_text.as_deref(), Some("翻译后的正文"));
        assert_eq!(result.conversations.len(), 1);
        assert_eq!(result.conversations[0].id, 123);
        assert_eq!(result.conversations[0].body_text, "翻译后的对话");
    }

    #[test]
    fn deserialize_translation_result_with_aliases() {
        // Test field aliases: "title" -> subject, "content" -> description_text
        let json = r#"{
            "title": "Title via alias",
            "content": "Content via alias",
            "conversations": []
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.subject, "Title via alias");
        assert_eq!(result.description_text.as_deref(), Some("Content via alias"));
    }

    #[test]
    fn deserialize_conversation_id_as_string() {
        // The deserialize_id function should handle string IDs
        let json = r#"{"id": "456", "body_text": "test"}"#;
        let conv: ConversationTranslation = serde_json::from_str(json).unwrap();
        assert_eq!(conv.id, 456);
    }

    #[test]
    fn deserialize_conversation_id_as_number() {
        let json = r#"{"id": 789, "body_text": "test"}"#;
        let conv: ConversationTranslation = serde_json::from_str(json).unwrap();
        assert_eq!(conv.id, 789);
    }

    #[test]
    fn deserialize_conversation_id_invalid_string() {
        let json = r#"{"id": "not_a_number", "body_text": "test"}"#;
        let result = serde_json::from_str::<ConversationTranslation>(json);
        assert!(result.is_err());
    }

    #[test]
    fn deserialize_translation_result_null_description() {
        let json = r#"{
            "subject": "Title",
            "conversations": []
        }"#;
        let result: TranslationResult = serde_json::from_str(json).unwrap();
        assert!(result.description_text.is_none());
    }
}
