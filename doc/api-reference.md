# API Reference

All API endpoints are prefixed with `/api/v1`. Authentication is required for all endpoints except Login and Register (via `Authorization: Bearer <token>` header).

## Authentication

### Login
`POST /api/v1/auth/login`

**Request Body:**
```json
{
  "username": "admin",
  "password": "password"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI...",
  "expireAt": 1735689600000,
  "username": "admin",
  "role": "ADMIN"
}
```

### Register
`POST /api/v1/auth/register`

**Request Body:**
```json
{
  "username": "newuser",
  "password": "password"
}
```
Note: New users are created with status `PENDING`. They cannot login until approved by an admin.

## Tickets

### List Tickets
`GET /api/v1/tickets`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | Page number |
| `size` | int | 20 | Page size |
| `status` | string | - | Filter by status (e.g., `PENDING_TRANS`, `COMPLETED`) |
| `subject` | string | - | Filter by subject (fuzzy match) |
| `external_id` | string | - | Filter by Freshdesk external ID (exact match) |
| `is_valid` | boolean | - | Filter by validity flag |
| `created_after` | ISO8601 datetime | - | Filter tickets created after this time |
| `created_before` | ISO8601 datetime | - | Filter tickets created before this time |

**Response:** `ApiResponse<Page<Ticket>>` — Paginated list with ticket data including associated translations and replies.

### Get Ticket Detail
`GET /api/v1/tickets/{id}`

**Response:** `ApiResponse<Ticket>` — Single ticket with full details (subject, content, status, translations, replies).

### Submit Translation
`POST /api/v1/tickets/{id}/translation`

**Request Body:**
```json
{
  "targetLang": "zh-CN",
  "translatedTitle": "Title in Chinese",
  "translatedContent": "Content in Chinese"
}
```
**Effect:** Updates ticket status to `PENDING_REPLY` and sends MQ message to `q.ticket.reply`.

### Submit Reply Draft
`POST /api/v1/tickets/{id}/reply`

**Request Body:**
```json
{
  "zhReply": "Chinese explanation for audit",
  "targetReply": "English reply for customer"
}
```
**Effect:** Updates ticket status to `PENDING_AUDIT` and sends MQ message to `q.ticket.audit`.

### Submit Audit Result
`POST /api/v1/tickets/{id}/audit`

**Request Body:**
```json
{
  "replyId": 101,
  "auditResult": "PASS",
  "auditRemark": "Approved."
}
```
**Effect:**
- `PASS` + auto-reply OFF: Updates ticket status to `APPROVED` (enters push queue).
- `PASS` + auto-reply ON: Updates ticket status to `COMPLETED`, auto-pushes reply to Freshdesk.
- `REJECT`: Updates ticket status back to `PENDING_REPLY`, saves `auditRemark` as `lastAuditRemark` on ticket for AI feedback injection.

### Trigger AI Translation (Manual)
`POST /api/v1/tickets/{id}/ai-translate`

Sends the ticket to `q.ticket.translation` for AI translation processing. Does not change ticket status immediately.

### Trigger AI Reply (Manual)
`POST /api/v1/tickets/{id}/ai-reply`

Sends the ticket to `q.ticket.reply` for AI reply generation. Does not change ticket status immediately.

### Push Approved Reply to Freshdesk
`POST /api/v1/tickets/{id}/push-reply`

**Effect:** Pushes the selected reply of an `APPROVED` ticket to Freshdesk and updates status to `COMPLETED`.

### Batch Push Approved Replies
`POST /api/v1/tickets/batch-push`

**Request Body:**
```json
[101, 102, 103]
```
**Response:** `ApiResponse<Integer>` — Number of successfully pushed tickets.

### Update Ticket Validity
`POST /api/v1/tickets/{id}/valid`

**Request Body:**
```json
{
  "isValid": true
}
```

## Admin

### Sync Management

#### Manual Sync
`POST /api/v1/sync/freshdesk`

Triggers an immediate incremental synchronization with Freshdesk.

#### Get Sync Config
`GET /api/v1/sync/config`

Returns current sync configuration (cron expression, enabled flag).

#### Update Sync Config
`PUT /api/v1/sync/config`

**Request Body:**
```json
{
  "cronExpression": "0 0/10 * * * ?",
  "syncEnabled": "true"
}
```

#### Get Sync Status
`GET /api/v1/sync/status`

Returns current sync running status.

#### Get Sync Logs
`GET /api/v1/sync/logs`

Returns history of sync executions (status, trigger type, counts, timestamps).

### User Management

#### List All Users (Paginated)
`GET /api/v1/admin/users`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | Page number |
| `size` | int | 20 | Page size |
| `status` | string | - | Filter by status (`PENDING`, `APPROVED`, `REJECTED`) |
| `username` | string | - | Filter by username (fuzzy match, case-insensitive) |

**Response:** `ApiResponse<Page<SysUser>>` — Paginated user list (password field excluded via `@JsonIgnore`). Sorted by `createdAt` descending.

#### List Pending Users
`GET /api/v1/admin/users/pending`

**Response:** `ApiResponse<List<SysUser>>` — All users with status `PENDING`.

#### Approve/Reject User
`POST /api/v1/admin/users/{id}/approve`

**Request Body:**
```json
{ "action": "APPROVE" }
```
or
```json
{ "action": "REJECT" }
```

#### Update User Role
`PUT /api/v1/admin/users/{id}/role`

**Request Body:**
```json
{ "role": "ADMIN" }
```
Accepted values: `ADMIN`, `USER`.

#### Reset User Password
`POST /api/v1/admin/users/{id}/reset-password`

**Request Body:**
```json
{ "password": "newpassword" }
```
Password must be at least 6 characters.

## System Configuration

### Get Auto-Reply Status
`GET /api/v1/config/auto-reply`

**Response:** `ApiResponse<{ enabled: boolean }>`

### Set Auto-Reply Status
`PUT /api/v1/config/auto-reply`

**Request Body:**
```json
{ "enabled": true }
```

### Get WeChat Work Webhook Config
`GET /api/v1/config/wecom-webhook`

**Response:** `ApiResponse<{ url: string, enabled: boolean }>`

### Set WeChat Work Webhook Config
`PUT /api/v1/config/wecom-webhook`

**Request Body:**
```json
{ "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...", "enabled": true }
```

### Test WeChat Work Webhook
`POST /api/v1/config/wecom-webhook/test`

**Response:** `ApiResponse<{ success: boolean }>`

## System / Debug

### Client Request Logging
- `POST /api/requests`: Log a raw client request for debugging.
- `GET /api/requests`: Retrieve all logged requests.
