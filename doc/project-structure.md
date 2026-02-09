# Project Structure Map

This document provides a detailed map of the `FD-AutoPilot` codebase to help AI agents and developers understand the organization of files and directories.

## Root Directory (`/`)
- `data/`: Directory for storing persistent data (H2 database files).
- `doc/`: Project documentation.
    - `api-reference.md`: HTTP API endpoints and usage.
    - `client-architecture.md`: Detail on the Tauri + React client.
    - `project-documentation.md`: High-level entry point and overview.
    - `project-structure.md`: This file.
    - `server-architecture.md`: Detail on the Spring Boot server.
    - `system-design.md`: Comprehensive system design doc (DB schema, state flow, MQ design).
- `fd-client/`: The Frontend/Client Application (Tauri + React).
- `fd-server/`: The Backend/Server Application (Spring Boot).

## Client Application (`fd-client/`)
Built with **Tauri v2**, **React 19**, **TypeScript**, and **TailwindCSS**.

### `src-tauri/` (Rust Backend for Client)
- `src/lib.rs`: Main entry point. Registers all Tauri commands (`#[tauri::command]`). `MqConsumerHolder` shared struct with `MqTranslateState`/`MqReplyState` newtype wrappers. Common helpers: `start_consumer_inner`, `stop_consumer_inner`, `get_consumer_status_inner`, `complete_task_inner`.
- `src/main.rs`: Application bootstrap.
- `src/mq_consumer.rs`: Unified RabbitMQ consumer. `handle_message()` framework with `parse_fn`/`build_payload` closures. `submit_via_frontend()` common function. `RunGuard` for safe `is_running` cleanup, multi-level stop checks.
- `src/ai.rs`: Gemini CLI translation engine (`GeminiClient::translate_ticket`).
- `src/api.rs`: Freshdesk HTTP client (direct access for local sync).
- `src/models.rs`: Shared data models (Ticket, Conversation, etc.).
- `src/settings.rs`: Settings management (persisted to JSON file on disk).
- `src/storage.rs`: Local SQLite storage for offline ticket data.
- `tauri.conf.json`: Tauri configuration (windows, permissions, CSP, bundles).
- `Cargo.toml`: Rust dependencies (lapin, reqwest, rusqlite, serde, tokio).

### `src/` (Frontend Source)

#### Entry Points
- `main.tsx`: React entry point.
- `AppNew.tsx`: Main layout, Context provider wrapping (`MQTranslationProvider`, `MQReplyProvider`), tab routing, sidebar.

#### Components (`components/`)
- `SidebarNew.tsx`: Main navigation sidebar.
- `SettingsTab.tsx`: Settings management (MQ config, NotebookLM config).
- **`server/`** — Server-mode task components:
    - `ServerTicketDetail.tsx`: Ticket detail workspace with AI action buttons (~600 lines).
    - **`ticket-detail/`** — Sub-components extracted from ServerTicketDetail:
        - `TranslationPreviewBar.tsx`: Translation confirmation bar.
        - `AiReplyPanel.tsx`: AI reply streaming display + bilingual toggle + save/discard.
        - `ReplyHistoryPanel.tsx`: Reply history list + inline audit controls.
    - `ServerTicketList.tsx`: Paginated ticket list with filters.
    - `ServerTicketsTab.tsx`: Tickets tab container.
    - `ServerTaskWorkspace.tsx`: Multi-tab task workspace (auto-close successful tabs, retain failed tabs).
    - `TranslationTasksTab.tsx`: MQ translation task management (left panel + workspace).
    - `ReplyTasksTab.tsx`: MQ reply task management (no concurrency config, serial only).
    - `AuditTasksTab.tsx`: Audit task management (inline card-based review with one-click pass/reject).
    - `ApprovedTasksTab.tsx`: Approved tickets queue (manual/batch push to Freshdesk, auto-reply toggle).
- **`common/`** — Shared components:
    - `FloatingTaskWidget.tsx`: Floating task status indicator (shows active MQ tasks).
- **`admin/`** — Admin-only components:
    - `AdminUsersTab.tsx`: User management (paginated list with status/username filters, approval, role change, password reset, confirm dialogs).
    - `ManualSyncTab.tsx`: Manual Freshdesk sync trigger + auto-reply push toggle.
    - `ServerLogsTab.tsx`: Server log viewer.
    - `DatabaseTab.tsx`: Database query panel.
- **`auth/`** — Authentication:
    - `AuthLoginTab.tsx`: Login form.
    - `AuthRegisterTab.tsx`: Register form.
- **`user/`** — User components:
    - `UserProfileTab.tsx`: User profile.

#### Context Providers (`context/`)
- `createMQTaskContext.tsx`: Generic factory function that generates Context + Provider + hook from `MQTaskConfig`. Handles event listening, dedup, task scheduling (parallel/serial), completion history, consumer control.
- `MQTranslationContext.tsx`: Thin wrapper using `createMQTaskContext` with `concurrencyMode: 'parallel'`, `defaultBatchSize: 5`.
- `MQReplyContext.tsx`: Thin wrapper using `createMQTaskContext` with `concurrencyMode: 'serial'`, `defaultBatchSize: 1`, streaming text bridge via `onStreamChunk`.

#### Hooks (`hooks/`)
- `useAuth.ts`: JWT authentication state (login, register, token storage).
- `useSettings.ts`: Application settings (MQ, NotebookLM, API keys).
- `useTickets.ts`: Fetch and filter tickets from `fd-server`.
- `useTicketProcess.ts`: Global per-ticket process state (`status`, `tempTranslation`, `tempAiReply`, `streamingText`). Module-level variables + listener pattern.
- `useAiReply.ts`: AI reply generation hook (Shadow Window → NotebookLM). Supports `onStreamChunk`, `onParsed`, `onPromptReady` callbacks.
- `useAiTranslation.ts`: AI translation hook (Rust Gemini CLI). Supports `onStatusChange`, `onError` callbacks.
- `useNotebookShadow.ts`: Shadow window visibility state.
- `useSync.ts`: Freshdesk synchronization status.

#### AI Provider Abstraction (`ai/`)
- `types.ts`: Provider interfaces (`AiTranslationProvider`, `AiReplyProvider`) and shared types.
- `index.ts`: Factory functions (`getTranslationProvider`, `getReplyProvider`) + re-exports.
- `parseUtils.ts`: Shared JSON parsing utilities (backward `]` search, regex fallback).
- **`providers/`**:
    - `geminiTranslationProvider.ts`: `GeminiTranslationProvider` — wraps Rust `translate_ticket_direct_cmd` invoke.
    - `notebookLMReplyProvider.ts`: `NotebookLMReplyProvider` — wraps `NotebookShadowService` with streaming and JSON parsing.

#### Services (`services/`)
- `notebookShadow.ts`: **Core Service**. NotebookLM Shadow Window (hybrid observer + relay architecture v3). DOM selectors centralized in `SELECTORS` constant.
- `serverApi.ts`: REST API client for `fd-server`.

#### Constants (`constants/`)
- `agentMap.ts`: Freshdesk Agent ID → name mapping (single source of truth).

#### Types (`types/`)
- `types.ts`: Local data types (Ticket, Conversation for offline mode).
- `server.ts`: Server API types (ServerTicket, TicketTranslation, TicketReply, etc.).

## Server Application (`fd-server/`)
Built with **Spring Boot 3.4**, **Java 21**, **H2 Database**, and **RabbitMQ**.

### `src/main/java/com/jefflower/fdserver/`
- `FdServerApplication.java`: Main Spring Boot application class.

#### Config (`config/`)
- `RabbitMQConfig.java`: Queue, Exchange, Routing Key, DLQ setup.
- `SecurityConfig.java`: Spring Security setup (JWT filters, CORS, endpoint permissions).

#### Controller (`controller/`)
- `AuthController.java`: Login/Register endpoints.
- `TicketController.java`: Ticket CRUD, translation/reply/audit submission, AI triggers, push-reply, batch-push.
- `AdminController.java`: Freshdesk sync, user management (paginated query, approvals, role change, password reset), sync config management.
- `ConfigController.java`: System config endpoints (auto-reply toggle, WeChat Work webhook).
- `RequestController.java`: Debug endpoint for logging raw client requests.

#### DTO (`dto/`)
- `LoginRequest.java`, `LoginResponse.java`: Auth DTOs.
- `RegisterRequest.java`: Registration DTO.
- `TranslationRequest.java`: Translation submission (`targetLang`, `translatedTitle`, `translatedContent`).
- `ReplyRequest.java`: Reply submission (`zhReply`, `targetReply`).
- `AuditRequest.java`: Audit submission (`replyId`, `auditResult`, `auditRemark`).
- `ValidRequest.java`: Ticket validity toggle (`isValid`).
- `ApproveRequest.java`: User approval.
- `ApiResponse.java`: Generic API response wrapper.
- `TicketContent.java`: Parsed ticket content DTO.

#### Entity (`entity/`)
- `Ticket.java`: Main ticket record (with `@OneToMany` to translations and replies).
- `TicketTranslation.java`: Translation details.
- `TicketReply.java`: Draft replies.
- `TicketAudit.java`: Audit history records.
- `SysUser.java`: User accounts (`password` field `@JsonIgnore`).
- `SystemConfig.java`: System configuration key-value pairs (auto-reply, WeChat Work webhook).
- `SyncConfig.java`: Sync configuration (cron expression, enabled flag).
- `SyncLog.java`: Sync execution history logs.

#### Enums (`enums/`)
- `TicketStatus.java`: `PENDING_TRANS`, `TRANSLATING`, `PENDING_REPLY`, `REPLYING`, `PENDING_AUDIT`, `AUDITING`, `APPROVED`, `COMPLETED`.
- `UserRole.java`: `ADMIN`, `USER`.
- `UserStatus.java`: `PENDING`, `APPROVED`, `REJECTED`.
- `AuditResult.java`: `PASS`, `REJECT`.
- `SyncStatus.java`: Sync execution status.
- `TriggerType.java`: Sync trigger type (CRON, MANUAL).

#### Repository (`repository/`)
- `TicketRepository.java`, `TicketTranslationRepository.java`, `TicketReplyRepository.java`, `TicketAuditRepository.java`
- `SysUserRepository.java`, `SystemConfigRepository.java`
- `SyncConfigRepository.java`, `SyncLogRepository.java`
- `ClientRequestRepository.java`

#### Service (`service/`)
- `TicketService.java`: Ticket workflow orchestration (state transitions, MQ message triggers, APPROVED push logic).
- `FreshdeskService.java`: Freshdesk API sync (incremental via `updated_since`).
- `MqPublisherService.java`: RabbitMQ message publishing (includes `auditRemark` in reply payload).
- `AuthService.java`: User authentication, registration, paginated user queries (status/username filters), role management, and password reset.
- `SyncConfigService.java`: Sync configuration management.
- `SystemConfigService.java`: System config CRUD (auto-reply toggle, WeChat Work webhook).
- `WeChatWorkNotifyService.java`: WeChat Work webhook notifications (audit pass/reject, reply pushed).

#### Scheduler (`scheduler/`)
- `SyncScheduler.java`: Cron-based Freshdesk sync scheduler.

#### Security (`security/`)
- `JwtUtil.java`: JWT token generation and validation.
- `JwtAuthenticationFilter.java`: Spring Security filter for JWT authentication.

## Key Configuration Files
- `fd-server/src/main/resources/application.yml`: Server config (H2 path, RabbitMQ, Freshdesk, JWT).
- `fd-client/src-tauri/tauri.conf.json`: Client window and capability config.
- `fd-client/src-tauri/Cargo.toml`: Rust dependencies.
