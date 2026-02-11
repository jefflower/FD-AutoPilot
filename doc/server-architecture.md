# Server Architecture (FD-Server)

The `fd-server` is a centralized Java Spring Boot application that manages the lifecycle of tickets, synchronizes with Freshdesk, and coordinates task distribution via RabbitMQ.

## Technology Stack
- **Language**: Java 21
- **Framework**: Spring Boot 3.4.1
- **Database**: H2 Database (File-based, persistent), Hibernate DDL `update`
- **ORM**: Spring Data JPA
- **Messaging**: RabbitMQ (via Spring AMQP)
- **Security**: Spring Security + JWT
- **Port**: 9988 (default)

## Core Modules

### 1. Data Model (`entity/`)
The data model is centered around the `Ticket` entity.
- **Ticket**: Root aggregate. Contains `subject`, `content` (JSON with description + conversations), `status`, `externalId` (Freshdesk ID), `isValid`.
  - `@OneToMany` → `TicketTranslation` (translations)
  - `@OneToMany` → `TicketReply` (reply drafts)
  - Freshdesk metadata: `fdStatus`, `fdPriority`, `fdSource`, `fdType`, `fdRequesterId`, `fdResponderId`, `fdGroupId`, `fdTags`, `fdCreatedAt`, `fdUpdatedAt`
  - Sync fields: `contentHash`, `lastSyncedAt`, `sourceLang`, `lastAuditRemark`
- **TicketTranslation**: Stores translated title and content with target language.
- **TicketReply**: Stores proposed reply in both languages (`zhReply`, `targetReply`). Note: `ReplyRequest` DTO only accepts `zhReply` and `targetReply` (no `replyLang` field).
- **TicketAudit**: Audit history records (`auditResult`: PASS/REJECT, linked to a reply).
- **SysUser**: Users with role (ADMIN/USER) and status (PENDING/APPROVED/REJECTED). `password` field is `@JsonIgnore`.
- **SystemConfig**: System configuration key-value pairs (`auto_reply_enabled`, `wecom_webhook_url`, `wecom_notify_enabled`).
- **SyncConfig**: Sync configuration (cron expression, enabled flag, description). Constants: `KEY_SYNC_CRON`, `KEY_LAST_SYNC_TIME`, `KEY_SYNC_ENABLED`.
- **SyncLog**: Sync execution history (startTime, endTime, ticketsSynced, ticketsUpdated, status, triggerType, errorMessage).
- **KnowledgeNote**: Knowledge base notes (title, content, sortOrder, timestamps).
- **FailedReplyPush**: Failed reply push records for retry (ticketId, externalId, replyId, retryCount, maxRetries, nextRetryAt, lastError, status).

### 2. Business Logic

#### Ticket Synchronization (`FreshdeskService.java` + `SyncScheduler.java`)
- **Cron Job**: `SyncScheduler` triggers sync based on `SyncConfig.cronExpression` (configurable, default every 5 minutes).
- **Incremental Sync**: Queries Freshdesk for tickets updated since `last_sync_time` via `updated_since` parameter.
- **Task Generation**:
    - New tickets with status `Open` are saved as `PENDING_TRANS`.
    - A message is immediately sent to `q.ticket.translation` via `MqPublisherService`.
- **Sync Logs**: Each sync execution is recorded in `SyncLog` with status (SUCCESS/FAILED), trigger type (CRON/MANUAL), and counts.

#### Task Distribution (`TicketService.java` + `MqPublisherService.java`)
State changes trigger MQ messages via `MqPublisherService`:
- `PENDING_TRANS` → Send to `q.ticket.translation` (routing key: `ticket.task.translate`)
- `PENDING_REPLY` → Send to `q.ticket.reply` (routing key: `ticket.task.reply`, includes `auditRemark` if present)
- `PENDING_AUDIT` → Send to `q.ticket.audit` (routing key: `ticket.task.audit`)

#### Audit & Push Flow
- **PASS + auto-reply OFF** → `APPROVED` (enters push queue for manual push)
- **PASS + auto-reply ON** → `COMPLETED` (auto-push to Freshdesk via `ReplyPushService`)
- **REJECT** → `PENDING_REPLY` (saves `lastAuditRemark` on Ticket, re-enters MQ reply flow with audit feedback injected into AI prompt)
- **Push**: `pushApprovedReply()` / `batchPushApprovedReplies()` push selected reply to Freshdesk and transition to `COMPLETED`

#### System Configuration (`SystemConfigService.java`)
Runtime config stored in `SystemConfig` entity (key-value pairs):
- `auto_reply_enabled` — Auto-push to Freshdesk after audit pass (default: `false`)
- `wecom_webhook_url` — WeChat Work webhook URL
- `wecom_notify_enabled` — Enable WeChat Work notifications (default: `false`)

#### WeChat Work Notifications (`WeChatWorkNotifyService.java`)
Async webhook notifications on key events:
- Audit pass / reject
- Reply pushed to Freshdesk
- MQ auto-reply completed

#### Sync Configuration (`SyncConfigService.java`)
- Manages sync settings (cron expression, enabled flag)
- Persisted in `SyncConfig` entity
- Default initialization via `@PostConstruct initDefaultConfig()`:
  - `freshdesk_sync_cron` = `0 0/1 * * * ?` (every 1 minute)
  - `freshdesk_sync_enabled` = `true`
  - `freshdesk_last_sync_time` = empty
- Exposed via Admin API for runtime configuration changes
- Provides sync lock mechanism (`tryAcquireSyncLock()`, `releaseSyncLock()`) to prevent concurrent syncs
- Manages `SyncLog` records (created on sync start, updated on completion/failure)

### 3. API Layer

#### `TicketController.java`
- `GET /api/v1/tickets` — Query tickets with filters: `status`, `external_id`, `subject`, `is_valid`, `created_after`, `created_before`, `page`, `size`
- `GET /api/v1/tickets/{id}` — Get single ticket detail
- `POST /api/v1/tickets/{id}/translation` — Submit translation result
- `POST /api/v1/tickets/{id}/reply` — Submit reply draft
- `POST /api/v1/tickets/{id}/audit` — Submit audit decision
- `POST /api/v1/tickets/{id}/ai-translate` — Manual trigger AI translation (sends MQ message)
- `POST /api/v1/tickets/{id}/ai-reply` — Manual trigger AI reply (sends MQ message)
- `POST /api/v1/tickets/{id}/valid` — Update ticket validity
- `POST /api/v1/tickets/{id}/push-reply` — Push approved ticket reply to Freshdesk
- `POST /api/v1/tickets/batch-push` — Batch push approved tickets

#### `ConfigController.java`
- `GET /api/v1/config/auto-reply` — Get auto-reply enabled status
- `PUT /api/v1/config/auto-reply` — Set auto-reply enabled
- `GET /api/v1/config/wecom-webhook` — Get WeChat Work webhook config
- `PUT /api/v1/config/wecom-webhook` — Set WeChat Work webhook config
- `POST /api/v1/config/wecom-webhook/test` — Send test notification

#### `KnowledgeController.java` (`/api/v1/admin/knowledge`)
- `GET /api/v1/admin/knowledge/notes` — Get all knowledge notes
- `POST /api/v1/admin/knowledge/notes` — Create knowledge note
- `PUT /api/v1/admin/knowledge/notes/{id}` — Update knowledge note
- `DELETE /api/v1/admin/knowledge/notes/{id}` — Delete knowledge note
- `POST /api/v1/admin/knowledge/batch-valid` — Batch mark tickets as valid/invalid
- `GET /api/v1/admin/knowledge/export/tickets` — Export valid tickets to CSV (UTF-8 with BOM)
- `GET /api/v1/admin/knowledge/export/notes` — Export knowledge notes to CSV

#### `DatabaseController.java` (`/api/v1/admin/database`)
- `POST /api/v1/admin/database/query` — Execute SQL query (with row limit)
- `GET /api/v1/admin/database/tables` — Get table metadata

#### `WebhookController.java` (`/api/v1/webhook`)
- `POST /api/v1/webhook/freshdesk` — Receive Freshdesk webhook callbacks
  - Validates webhook secret (header: `X-Freshdesk-Webhook-Secret`)
  - Extracts `ticket_id` from payload
  - Async processes single ticket via `FreshdeskSyncService.processSingleTicketFromWebhook()`
  - Returns 200 immediately (async processing)

#### `AdminController.java`
**Sync Management:**
- `POST /api/v1/sync/freshdesk` — Manual sync trigger (returns syncedCount, updatedCount, skippedCount, success, message)
- `GET /api/v1/sync/config` — Get sync configuration (cronExpression, syncEnabled, lastSyncTime, isSyncing)
- `PUT /api/v1/sync/config` — Update sync configuration (cronExpression, syncEnabled, lastSyncTime)
- `GET /api/v1/sync/status` — Get current sync status (isSyncing, lastSyncTime)
- `GET /api/v1/sync/logs` — Get sync execution logs (paginated, sorted by startTime descending)

**User Management:**
- `GET /api/v1/admin/users` — List all users (paginated, supports status/username filters)
- `GET /api/v1/admin/users/pending` — List pending users
- `POST /api/v1/admin/users/{id}/approve` — Approve/reject user
- `PUT /api/v1/admin/users/{id}/role` — Update user role (ADMIN/USER)
- `POST /api/v1/admin/users/{id}/reset-password` — Reset user password

#### `AuthController.java`
- `POST /api/v1/auth/login` — Login (returns JWT token)
- `POST /api/v1/auth/register` — Register (initial status: PENDING)

#### User Management (`AuthService.java`)
Handles authentication, registration, and user lifecycle management:
- **Default Admin Initialization**: `@PostConstruct initDefaultAdmin()` — Auto-creates default admin user on startup (username=admin, password=admin123, role=ADMIN, status=APPROVED) if not exists.
- **Login**: Validates credentials (BCrypt) + status check (must be `APPROVED`) + JWT token generation
- **Register**: Creates user with `role=USER`, `status=PENDING`
- **Paginated Query**: `getAllUsers(status, username, pageable)` — supports optional status filter, username fuzzy search (case-insensitive), sorted by `createdAt` descending
- **Approval**: `approveUser(id, action)` — sets status to `APPROVED` or `REJECTED`
- **Role Management**: `updateUserRole(id, role)` — changes user role between `ADMIN` and `USER`
- **Password Reset**: `resetPassword(id, newPassword)` — BCrypt re-encodes and saves

**Note**: `SysUser.password` is annotated with `@JsonIgnore` to prevent password hash leakage in API responses.

#### `RequestController.java`
- `POST /api/requests` — Log raw client request (debug)
- `GET /api/requests` — Retrieve logged requests

### 3.5. Support Services

#### Knowledge Base (`KnowledgeService.java` + `KnowledgeController.java`)
- **CRUD Operations**:
  - `createNote(KnowledgeNoteRequest)` — Create knowledge note
  - `updateNote(id, KnowledgeNoteRequest)` — Update note title/content/sortOrder
  - `deleteNote(id)` — Delete note by ID
  - `getAllNotes()` — Get all notes sorted by sortOrder
- **Batch Operations**:
  - `batchUpdateValidity(ticketIds, isValid)` — Mark multiple tickets as valid/invalid
  - `getValidTickets()` — Get all tickets marked as valid
- **Export**:
  - CSV export support with UTF-8 BOM for Excel compatibility
  - Exports: valid tickets (subject + content) and notes (title + content)

#### Database Query (`DatabaseQueryService.java` + `DatabaseController.java`)
- **SQL Execution**:
  - `executeQuery(sql, maxRows)` — Execute arbitrary SQL queries with row limit
  - Returns: `SqlQueryResult` with columns, rows, execution time, row count
- **Metadata**:
  - `getTableMetadata()` — Get all H2 table names and column information
  - Returns: `List<TableInfo>` with table name and columns

**Note**: These endpoints are restricted to ADMIN role for security (no direct execution endpoint exposed for non-admins).

### 4. Security (`SecurityConfig.java` + `security/`)
- **JWT Authentication**: Stateless, token in `Authorization: Bearer <token>` header
- **Filter**: `JwtAuthenticationFilter` validates tokens on every request
- **Token Management**: `JwtUtil` handles generation and validation
- **CORS**: Configured for cross-origin requests from the Tauri client
- **Public Endpoints**: `/api/v1/auth/login`, `/api/v1/auth/register`, `/h2-console/**`
- **Role-based Access**: ADMIN endpoints restricted via Spring Security rules

## Configuration
Configuration is managed in `application.yml`.
```yaml
server:
  port: 9988

freshdesk:
  domain: your-domain.freshdesk.com
  api-key: your-api-key
  sync:
    cron: "0 0/5 * * * ?"  # Every 5 minutes

spring:
  datasource:
    url: jdbc:h2:file:./data/fdserver  # Persistent H2 path
  jpa:
    hibernate:
      ddl-auto: update
  h2:
    console:
      enabled: true           # /h2-console for dev
  rabbitmq:
    host: 47.110.152.25
    port: 5672
    username: guest
    password: guest

jwt:
  secret: your-256-bit-secret
  expiration-hours: 24

freshdesk:
  webhook:
    secret: optional-webhook-secret  # Optional: validates X-Freshdesk-Webhook-Secret header
```

## Webhook Integration

### Freshdesk Webhook Configuration
To receive real-time ticket events from Freshdesk, configure an Automation Rule in Freshdesk:
1. **Endpoint**: `https://your-server:9988/api/v1/webhook/freshdesk`
2. **Method**: `POST`
3. **Payload Example**:
   ```json
   {
     "ticket_id": "{{ticket.id}}",
     "event": "ticket_created"
   }
   ```
4. **Custom Header** (optional for security):
   - Header: `X-Freshdesk-Webhook-Secret`
   - Value: matches `freshdesk.webhook.secret` in `application.yml`

The webhook receiver is async-first: returns 200 immediately while processing the ticket in the background via `FreshdeskSyncService.processSingleTicketFromWebhook()`.

## Known Entities & Relationships

### State Transitions
Tickets progress through this lifecycle:
```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → (APPROVED or COMPLETED)
```
- **APPROVED**: Ready for manual push (if auto-push disabled)
- **COMPLETED**: Reply already pushed to Freshdesk (if auto-push enabled)

### MQ Queue Mapping
- `q.ticket.translation` (routing key: `ticket.task.translate`) — Translation requests
- `q.ticket.reply` (routing key: `ticket.task.reply`) — Reply generation requests
- `q.ticket.audit` (routing key: `ticket.task.audit`) — Audit requests
- `q.ticket.dlq` — Dead Letter Queue for failed messages

### Default Configuration (on first startup)
- Default admin: `username=admin`, `password=admin123`, `role=ADMIN`, `status=APPROVED`
- Default sync cron: Every 1 minute (`0 0/1 * * * ?`)
- Default sync enabled: `true`
- Auto-reply enabled: `false` (requires manual configuration)
- WeChat Work notifications: `false` (requires manual configuration)
