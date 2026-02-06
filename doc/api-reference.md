# API Reference

All API endpoints are prefixed with `/api/v1`.

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

## Tickets

### List Tickets
`GET /api/v1/tickets`

**Query Parameters:**
- `page`: Page number (default 0)
- `size`: Page size (default 20)
- `status`: Filter by status (e.g., `PENDING_TRANS`, `COMPLETED`)
- `subject`: Filter by subject (fuzzy match)

### Get Ticket Detail
`GET /api/v1/tickets/{id}`

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

### Submit Reply Draft
`POST /api/v1/tickets/{id}/reply`

**Request Body:**
```json
{
  "replyLang": "en",
  "zhReply": "Chinese explanation for audit",
  "targetReply": "English reply for customer"
}
```

### Submit Audit Result
`POST /api/v1/tickets/{id}/audit`

**Request Body:**
```json
{
  "replyId": 101,
  "auditResult": "PASS",  // or "REJECT"
  "auditRemark": "Approved."
}
```

### Trigger AI Translation (Manual)
`POST /api/v1/tickets/{id}/ai-translate`
Triggers the AI translation task for a specific ticket.

### Trigger AI Reply (Manual)
`POST /api/v1/tickets/{id}/ai-reply`
Triggers the AI reply generation task for a specific ticket.

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
Triggers an immediate synchronization with Freshdesk.

#### Get Sync Config
`GET /api/v1/sync/config`

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

#### Get Sync Logs
`GET /api/v1/sync/logs`

### User Management
- `GET /api/v1/admin/users/pending`: List pending user registrations.
- `POST /api/v1/admin/users/{id}/approve`: Approve or reject a user.

## System / Debug

### Client Request Logging
- `POST /api/requests`: Log a raw client request.
- `GET /api/requests`: Retrieve all logged requests.
