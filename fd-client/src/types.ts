export interface Settings {
  mq_host: string;
  mq_port: number;
  mq_username: string;
  mq_password: string;
  translation_lang: string;
}

export interface NotebookLMConfig {
  cookie: string;
  atToken: string;
  fSid: string;
  notebookId: string;
  notebookUrl?: string;
  prompt: string;
  sourceIds?: string[];
}
