# Client Architecture (FD-Client)

The `fd-client` is a hybrid application built with **Tauri v2** and **React**. It serves as both the user interface for operators and the execution engine for AI tasks.

## Technology Stack
- **Framework**: Tauri v2 (Rust + Webview)
- **Frontend**: React 19, TypeScript, Vite 7
- **Styling**: TailwindCSS 3.4
- **State Management**: React Hooks + Context + Module-level Global State
- **Backend (Tauri)**: Rust (Tokio, Lapin for RabbitMQ, Reqwest for HTTP)

## Core Components

### 1. RabbitMQ Consumer (`src-tauri/src/mq_consumer.rs`)
The client acts as a worker node. It connects to the RabbitMQ server and listens on two queues via **two independent consumers**:

| Consumer | Queue | Concurrency | Processing Mode |
|----------|-------|-------------|-----------------|
| Translation | `q.ticket.translation` | Configurable (`batchSize`, default 1) | `tokio::spawn` parallel |
| Reply | `q.ticket.reply` | Fixed 1 | Direct `await` serial |

**Workflow:**
1. **Receive**: Rust backend receives an MQ message.
2. **Fetch**: Calls `fd-server` API to get latest ticket details.
3. **Emit**: Emits a Tauri Event (`mq-translate-request` or `mq-reply-request`) to the React frontend.
4. **Wait**: Registers a `oneshot::channel` in `pending_acks` and awaits the frontend completion signal (300s timeout).
5. **ACK/NACK**: On success ACKs the message; on failure NACKs without requeue.

**Architecture**: Unified `handle_message()` framework handles both message types with `parse_fn` and `build_payload` closures for type-specific logic. `submit_via_frontend()` is the common function for fetching ticket details, emitting events, and awaiting completion signals via `oneshot::channel`.

**Stop Behavior**: When `stop()` is called, `is_running` is set to `false`. Multiple checkpoints (`RunGuard` drop guard, consumer loop check, `handle_message` entry check, `submit_via_frontend` mid-check) ensure no new tasks are processed. Already-buffered messages are NACK'd with `requeue: true`.

**State Management (lib.rs)**: `MqConsumerHolder` is the shared underlying struct for both consumers. `MqTranslateState` and `MqReplyState` are newtype wrappers (required by Tauri's `State<>` type system). Common command logic is extracted into `start_consumer_inner`, `stop_consumer_inner`, `get_consumer_status_inner`, `complete_task_inner` helper functions.

### 2. NotebookLM Shadow Service (`src/services/notebookShadow.ts`)
Since Google NotebookLM has no public API, we use a "Shadow Window" technique with a **hybrid observer + relay architecture (v3)**.

- **Window**: A hidden Webview window (`label: notebook_shadow`) created via `open_notebook_window`. The `initialization_script` sets up `window.__TAURI__` IPC bridge by polling for `__TAURI_INTERNALS__`.
- **Query Flow** (`NotebookShadowService.query(prompt)`):
  1. **mainScript** (IIFE injected via `execute_notebook_js`):
     - Clears previous chat history (click delete buttons)
     - Inputs prompt using `nativeInputValueSetter` + keyboard events
     - Clicks send button with confirmation loop
     - Sets up `setInterval` observer that monitors `.chat-message-pair` DOM elements
  2. **Observer** (runs inside shadow window's setInterval):
     - Reads bot response from `.to-user-container .message-text-content` (bot-only text, avoids user prompt with `[timestamp]` patterns)
     - Detects completion via `.xap-copy-to-clipboard` button + `isJsonBalanced` + `botIdle` + `botResponded`
     - Writes result to `window.__SHADOW_LATEST_RESULT` global variable (does NOT call `invoke` in setInterval — unreliable)
  3. **Relay** (injected periodically by the async generator):
     - Reads `window.__SHADOW_LATEST_RESULT` via `execute_notebook_js`
     - Forwards to main window via `forward_shadow_event` IPC command
     - Main window receives via Tauri event listener
  4. **Generator** yields `{ text, status }` chunks to the caller
- **Mutex**: Global lock ensures only one query runs at a time.

### 3. Context Providers (`src/context/`)

#### createMQTaskContext (Factory)
A generic factory function (`createMQTaskContext.tsx`) generates React Context + Provider + hook from a `MQTaskConfig` object. Eliminates 95% duplication between translation and reply contexts. The `taskProcessor` function is injected via Provider prop (not config) to support React hooks.

**Config parameters**: `taskType`, `eventName`, `startCommand`, `stopCommand`, `statusCommand`, `completeCommand`, `defaultBatchSize`, `concurrencyMode` (`'parallel'` | `'serial'`), `interTaskDelayMs`.

**Internal logic**: Event listening → dedup (`queuedTicketIdsRef` + `processingTasksRef`) → task scheduling (parallel via `activeCountRef` or serial via `isProcessingRef`) → completion history → consumer control.

#### MQTranslationContext (~47 lines)
- Config: `concurrencyMode: 'parallel'`, `defaultBatchSize: 5`
- Injects `runTranslation` as taskProcessor

#### MQReplyContext (~52 lines)
- Config: `concurrencyMode: 'serial'`, `defaultBatchSize: 1`, `interTaskDelayMs: 1000`
- Injects `runReply` with `onStreamChunk` callback bridging to `setStreamingText`

### 3.5. AI Provider Abstraction (`src/ai/`)
Defines provider interfaces (`AiTranslationProvider`, `AiReplyProvider`) and concrete implementations:
- `GeminiTranslationProvider` — wraps Rust `translate_ticket_direct_cmd` invoke
- `NotebookLMReplyProvider` — wraps `NotebookShadowService` with streaming and JSON parsing
- Factory functions `getTranslationProvider(name)` / `getReplyProvider(name, config)` for future provider swapping

### 4. State Management

#### Hooks
| Hook | Purpose |
|------|---------|
| `useAuth.ts` | JWT authentication (login, register, token storage) |
| `useSettings.ts` | Application settings (MQ config, NotebookLM config, API keys) |
| `useTickets.ts` | Fetch and filter tickets from `fd-server` |
| `useTicketProcess.ts` | **Global** process state per ticket (`status`, `tempTranslation`, `tempAiReply`, `streamingText`). Uses module-level variables + listener pattern for cross-component sharing |
| `useAiReply.ts` | AI reply generation via Shadow Window. Callbacks: `onStreamChunk`, `onParsed`, `onPromptReady`, `onError` |
| `useAiTranslation.ts` | AI translation via Rust Gemini CLI. Callbacks: `onStatusChange`, `onError` |
| `useNotebookShadow.ts` | Shadow window visibility state |
| `useSync.ts` | Freshdesk synchronization status |

#### Shared Constants
- `constants/agentMap.ts` — Freshdesk Agent ID → name mapping (single source of truth)

## Directory Map (Source)
```text
src/
├── ai/                              # AI Provider abstraction layer
│   ├── types.ts                     # Provider interfaces (AiTranslationProvider, AiReplyProvider)
│   ├── index.ts                     # Factory functions + re-exports
│   ├── parseUtils.ts                # Shared JSON parsing utilities
│   └── providers/
│       ├── geminiTranslationProvider.ts   # Gemini CLI translation
│       └── notebookLMReplyProvider.ts     # NotebookLM reply generation
├── components/
│   ├── server/                      # Server-mode task components
│   │   ├── ServerTicketDetail.tsx    # Ticket detail with AI actions (~600 lines)
│   │   ├── ticket-detail/           # Sub-components extracted from ServerTicketDetail
│   │   │   ├── TranslationPreviewBar.tsx  # Translation confirmation bar
│   │   │   ├── AiReplyPanel.tsx           # AI reply streaming + bilingual display
│   │   │   └── ReplyHistoryPanel.tsx      # Reply history + audit controls
│   │   ├── ServerTicketList.tsx      # Paginated ticket list
│   │   ├── ServerTicketsTab.tsx      # Tickets tab container
│   │   ├── ServerTaskWorkspace.tsx   # Multi-tab task workspace
│   │   ├── TranslationTasksTab.tsx   # MQ translation task management
│   │   ├── ReplyTasksTab.tsx         # MQ reply task management
│   │   ├── AuditTasksTab.tsx         # Audit task management (inline card review)
│   │   └── ApprovedTasksTab.tsx      # Approved tickets push queue
│   ├── common/
│   │   └── FloatingTaskWidget.tsx    # Floating task status indicator
│   ├── admin/
│   │   ├── AdminUsersTab.tsx         # User management (list, approval, role change, password reset)
│   │   ├── ManualSyncTab.tsx         # Manual Freshdesk sync + auto-reply toggle
│   │   ├── ServerLogsTab.tsx         # Server log viewer
│   │   └── DatabaseTab.tsx           # Database query panel
│   ├── auth/
│   │   ├── AuthLoginTab.tsx          # Login form
│   │   └── AuthRegisterTab.tsx       # Register form
│   ├── user/
│   │   └── UserProfileTab.tsx        # User profile
│   ├── SidebarNew.tsx                # Navigation sidebar
│   └── SettingsTab.tsx               # Settings management
├── context/
│   ├── createMQTaskContext.tsx       # Generic MQ task context factory
│   ├── MQTranslationContext.tsx      # Translation config (thin wrapper)
│   └── MQReplyContext.tsx            # Reply config (thin wrapper)
├── hooks/                            # (see Hooks table above)
├── services/
│   ├── notebookShadow.ts            # Shadow Window service (SELECTORS constant + hybrid observer + relay)
│   └── serverApi.ts                  # REST API client for fd-server
├── constants/
│   └── agentMap.ts                  # Agent ID mapping
├── types/
│   ├── types.ts                     # Local data types
│   └── server.ts                    # Server API types
├── AppNew.tsx                       # Main entry, Context providers, tab routing
└── main.tsx                         # React entry point
```

## Rust Backend (`src-tauri/src/`)
```text
src-tauri/src/
├── lib.rs           # Tauri commands + MqConsumerHolder/newtype wrappers + common helpers
├── main.rs          # Application bootstrap
├── mq_consumer.rs   # Unified MQ consumer (handle_message + submit_via_frontend, RunGuard)
├── ai.rs            # Gemini CLI translation engine
├── api.rs           # Freshdesk HTTP client (local direct access)
├── models.rs        # Shared data models (Ticket, Conversation, etc.)
├── settings.rs      # Settings persistence (JSON file)
└── storage.rs       # Local SQLite storage
```

## AI Workflow (Provider-based)

Both translation and reply use the **AI Provider abstraction** (`src/ai/`). Hooks (`useAiTranslation`, `useAiReply`) delegate to provider implementations, enabling future provider swapping via factory functions.

### 1. Translation (`GeminiTranslationProvider`)
- **Trigger**: MQ message on `q.ticket.translation` OR button click in UI
- **Execution**: `useAiTranslation` → `GeminiTranslationProvider.translate()` → `invoke('translate_ticket_direct_cmd')` → `ai.rs` → `gemini` CLI
- **Concurrency**: Supports parallel execution (configurable `batchSize` via QoS prefetch)
- **Result**: Auto-saved via `serverApi.ticket.submitTranslation()`, or manual preview in UI

### 2. Reply Generation (`NotebookLMReplyProvider`)
- **Trigger**: MQ message on `q.ticket.reply` OR button click in UI
- **Execution**: `useAiReply` → `NotebookLMReplyProvider.generateReply()` → `NotebookShadowService.query(prompt)` → Shadow Window → NotebookLM
- **Concurrency**: Serial only (1 at a time, Shadow Window limitation)
- **Result**: Parsed as `[targetReply, zhReply]` JSON array via `parseReply()`. Auto-saved or manual confirm in UI.
- **JSON Parsing**: Uses backward search for `["` pattern (avoids matching `[timestamp]` from conversation logs in prompt), shared in `parseUtils.ts`

## Tauri Commands (registered in `lib.rs`)

| Category | Commands |
|----------|----------|
| Local Sync | `sync_tickets`, `list_local_tickets`, `load_ticket_cmd`, `sync_statuses_cmd` |
| Settings | `save_settings_cmd`, `load_settings_cmd` |
| File | `select_folder`, `export_to_csv_cmd` |
| Translation | `translate_ticket_cmd`, `translate_ticket_direct_cmd` |
| NotebookLM | `open_notebook_window`, `execute_notebook_js`, `get_shadow_result`, `toggle_notebook_window`, `get_notebook_window_visibility`, `forward_shadow_event` |
| MQ Translation | `start_mq_consumer`, `stop_mq_consumer`, `get_mq_consumer_status`, `update_mq_batch_size`, `complete_translate_task` |
| MQ Reply | `start_reply_mq_consumer`, `stop_reply_mq_consumer`, `get_reply_mq_consumer_status`, `complete_reply_task` |
