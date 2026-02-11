export interface Settings {
  mq_host: string;
  mq_port: number;
  mq_username: string;
  mq_password: string;
  translation_lang: string;
  mq_queue_translation: string;
  mq_queue_reply: string;
  mq_queue_audit: string;
  mq_queue_dlq: string;
}

export interface NotebookLMConfig {
  notebookId: string;
  notebookUrl?: string;
  prompt: string;
}
