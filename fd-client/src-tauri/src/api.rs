use crate::models::{Conversation, Ticket};
use crate::storage::Storage;
use reqwest::Client;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use std::collections::HashSet;
use serde::Deserialize;
use chrono::{Utc, Duration as ChronoDuration, NaiveDate};

#[derive(Debug, Deserialize)]
struct SearchResult {
    results: Vec<Ticket>,
    #[allow(dead_code)]
    total: i64,
}

pub struct FreshdeskClient {
    client: Client,
    base_url: String,
    api_key: String,
}

impl FreshdeskClient {
    pub fn new(domain: &str, api_key: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());
            
        FreshdeskClient {
            client,
            base_url: format!("https://{}/api/v2", domain),
            api_key: api_key.to_string(),
        }
    }

    fn log(app: &AppHandle, msg: &str) {
        let _ = app.emit("log", msg.to_string());
    }

    /// Fetch ALL tickets and save immediately after each batch
    pub async fn fetch_and_save_all_tickets(&self, app: &AppHandle, storage: &Storage, client: &FreshdeskClient) -> Result<usize, String> {
        let statuses = [
            (2, "Open"),
            (3, "Pending"),
            (4, "Resolved"),
            (5, "Closed"),
        ];
        
        let mut seen_ids: HashSet<u64> = HashSet::new();
        let mut total_saved = 0;
        
        // Generate weekly ranges from 2025-01-01 to now
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let today = Utc::now().date_naive();
        
        let mut weeks = Vec::new();
        let mut current = start;
        while current < today {
            let end = current + ChronoDuration::days(7);
            weeks.push((current, end.min(today)));
            current = end;
        }
        
        Self::log(app, &format!("📅 {} weeks × {} statuses = {} queries", weeks.len(), statuses.len(), weeks.len() * statuses.len()));
        
        let total_queries = weeks.len() * statuses.len();
        let mut query_num = 0;
        
        for (status_code, status_name) in statuses.iter() {
            Self::log(app, &format!("📋 Fetching {} tickets...", status_name));
            let mut status_saved = 0;
            
            for (start_date, end_date) in &weeks {
                query_num += 1;
                let progress = (query_num as f32 / total_queries as f32 * 100.0) as i32;
                let _ = app.emit("progress", serde_json::json!({"phase": "fetching", "current": progress, "total": 100}));
                
                let query = format!("\"status:{} AND created_at:>'{}' AND created_at:<'{}'\"", 
                    status_code, start_date, end_date);
                
                match self.search_tickets(&query).await {
                    Ok(tickets) => {
                        let mut batch_saved = 0;
                        for ticket in tickets {
                            if !seen_ids.contains(&ticket.id) {
                                seen_ids.insert(ticket.id);
                                
                                // Fetch conversations and save immediately
                                let mut full_ticket = ticket;
                                if let Ok(convs) = client.list_conversations(full_ticket.id).await {
                                    full_ticket.conversations = convs;
                                }
                                
                                if storage.save_ticket(&full_ticket, None).is_ok() {
                                    batch_saved += 1;
                                    status_saved += 1;
                                    total_saved += 1;
                                }
                            }
                        }
                        if batch_saved > 0 {
                            Self::log(app, &format!("   {} {} ~ {}: +{} saved", status_name, start_date, end_date, batch_saved));
                        }
                    }
                    Err(e) => {
                        if !e.contains("0 results") {
                            Self::log(app, &format!("   ⚠️ {} {}: {}", status_name, start_date, e));
                        }
                    }
                }
                
                // Delay between queries
                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            }
            
            Self::log(app, &format!("   ✓ {} saved: {} (total: {})", status_name, status_saved, total_saved));
        }
        
        Self::log(app, &format!("✓ All done: {} tickets saved", total_saved));
        Ok(total_saved)
    }

    /// Search tickets with a query (max 10 pages = 300 results)
    async fn search_tickets(&self, query: &str) -> Result<Vec<Ticket>, String> {
        let url = format!("{}/search/tickets", self.base_url);
        
        let mut all_tickets = Vec::new();
        let mut page = 1;
        let max_pages = 10;

        loop {
            if page > max_pages {
                break;
            }

            let request = self.client.get(&url)
                .basic_auth(&self.api_key, Some("X"))
                .query(&[
                    ("query", query),
                    ("page", &page.to_string()),
                ]);
            
            let resp = match request.send().await {
                Ok(r) => r,
                Err(e) => return Err(e.to_string()),
            };

            let status_code = resp.status();
            
            if status_code.as_u16() == 429 {
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                continue;
            }
            
            if !status_code.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("{}: {}", status_code, text));
            }

            let result: SearchResult = match resp.json().await {
                Ok(r) => r,
                Err(e) => return Err(format!("JSON: {}", e)),
            };
            
            if result.results.is_empty() {
                break;
            }
            
            let count = result.results.len();
            all_tickets.extend(result.results);
            
            if count < 30 {
                break;
            }
            
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            page += 1;
        }

        Ok(all_tickets)
    }

    /// Fetch tickets updated since a specific date - for incremental sync
    pub async fn list_tickets_since(&self, updated_since: Option<&str>, _app: &AppHandle) -> Result<Vec<Ticket>, String> {
        let url = format!("{}/tickets", self.base_url);
        
        let mut all_tickets = Vec::new();
        let mut page = 1;
        let max_pages = 100;

        loop {
            if page > max_pages {
                break;
            }

            let mut request = self.client.get(&url)
                .basic_auth(&self.api_key, Some("X"))
                .query(&[
                    ("include", "description"),
                    ("per_page", "100"),
                    ("page", &page.to_string()),
                ]);
            
            if let Some(since) = updated_since {
                request = request.query(&[("updated_since", since)]);
            }
            
            let resp = match request.send().await {
                Ok(r) => r,
                Err(e) => return Err(e.to_string()),
            };

            if resp.status().as_u16() == 429 {
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                continue;
            }
            
            if !resp.status().is_success() {
                return Err(format!("API error {}", resp.status()));
            }

            let page_tickets: Vec<Ticket> = match resp.json().await {
                Ok(t) => t,
                Err(e) => return Err(format!("JSON error: {}", e)),
            };
            
            if page_tickets.is_empty() {
                break;
            }
            
            let count = page_tickets.len();
            all_tickets.extend(page_tickets);
            
            if count < 100 {
                break;
            }
            
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            page += 1;
        }

        Ok(all_tickets)
    }

    pub async fn list_conversations(&self, ticket_id: u64) -> Result<Vec<Conversation>, String> {
        let url = format!("{}/tickets/{}/conversations", self.base_url, ticket_id);
        let mut all_conversations = Vec::new();
        let mut page = 1;

        loop {
            if page > 5 {
                break;
            }
            
            let resp = match self.client.get(&url)
                .basic_auth(&self.api_key, Some("X"))
                .query(&[("page", page)])
                .send()
                .await 
            {
                Ok(r) => r,
                Err(_) => break,
            };

            if resp.status().as_u16() == 429 {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                continue;
            }

            if !resp.status().is_success() {
                break;
            }

            let page_convs: Vec<Conversation> = match resp.json().await {
                Ok(c) => c,
                Err(_) => break,
            };
            
            if page_convs.is_empty() {
                break;
            }

            let count = page_convs.len();
            all_conversations.extend(page_convs);

            if count < 30 {
                break;
            }
            page += 1;
        }

        Ok(all_conversations)
    }
}
