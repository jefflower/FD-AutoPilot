export interface Ticket {
  id: number;
  subject: string;
  description_text: string | null;
  status: number;
  priority: number;
  created_at: string;
  updated_at: string;
  conversations?: Conversation[];
  available_langs?: string[];
}

export interface Conversation {
  id: number;
  body_text: string;
  created_at: string;
  incoming: boolean;
  private: boolean;
}

export interface Settings {
  api_key: string;
  output_dir: string;
  sync_start_date: string;
}

export interface Progress {
  phase: string;
  current: number;
  total: number;
  ticketId?: number;
  processed?: number;
  totalTickets?: number;
}

export interface NotebookLMConfig {
  cookie: string;
  atToken: string;
  fSid: string;
  notebookId: string;
  prompt: string;
  sourceIds?: string[];
}
