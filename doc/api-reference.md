# API Reference

所有 API 端点前缀为 `/api/v1`。除登录/注册和 Freshdesk Webhook 外，所有端点均需认证头 `Authorization: Bearer <token>`。

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
| `page` | int | 0 | 页号（从 0 开始）|
| `size` | int | 20 | 每页记录数 |
| `status` | string | - | 按状态过滤（例：`PENDING_TRANS`, `PENDING_REPLY`, `PENDING_AUDIT`, `APPROVED`, `COMPLETED`）|
| `subject` | string | - | 按工单主题模糊查询 |
| `external_id` | string | - | 按 Freshdesk 工单 ID 精确匹配 |
| `is_valid` | boolean | - | 按有效性标记过滤 |
| `created_after` | ISO8601 datetime | - | 查询在此时间后创建的工单 |
| `created_before` | ISO8601 datetime | - | 查询在此时间前创建的工单 |

**Response:** `ApiResponse<Page<Ticket>>` — 分页工单列表，包含关联的翻译和回复数据。

### Get Ticket Detail
`GET /api/v1/tickets/{id}`

**Response:** `ApiResponse<Ticket>` — 单个工单完整详情，包括主题、内容、状态、翻译记录、回复历史和审核信息。

### Submit Translation
`POST /api/v1/tickets/{id}/translation`

**Request Body:**
```json
{
  "targetLang": "zh-CN",
  "translatedTitle": "中文标题",
  "translatedContent": "中文内容"
}
```
**Effect:** 工单状态转换到 `PENDING_REPLY`，发送 MQ 消息到 `q.ticket.reply` 队列触发回复任务。

### Submit Reply Draft
`POST /api/v1/tickets/{id}/reply`

**Request Body:**
```json
{
  "zhReply": "中文审核说明",
  "targetReply": "英文客户回复"
}
```
**Effect:** 工单状态转换到 `PENDING_AUDIT`，发送 MQ 消息到 `q.ticket.audit` 队列触发审核任务。

### Update Reply
`PUT /api/v1/tickets/{id}/reply/{replyId}`

**Request Body:**
```json
{
  "zhReply": "更新后的中文审核说明",
  "targetReply": "更新后的英文客户回复"
}
```
**Effect:** 更新指定回复的内容（支持在 PENDING_AUDIT 或 PENDING_REPLY 状态下修改）。

### Skip Reply
`POST /api/v1/tickets/{id}/skip-reply`

**Effect:** 跳过当前回复任务，将工单标记为已完成状态（`COMPLETED`）。

### Submit Audit Result
`POST /api/v1/tickets/{id}/audit`

**Request Body:**
```json
{
  "replyId": 101,
  "auditResult": "PASS",
  "auditRemark": "已批准"
}
```
**Effect:**
- `PASS` + 自动推送关闭：工单转换到 `APPROVED`（进入待推送队列）
- `PASS` + 自动推送开启：工单转换到 `COMPLETED`（自动推送回复到 Freshdesk）
- `REJECT`：工单转换回 `PENDING_REPLY`，保存 `auditRemark` 为工单的 `lastAuditRemark` 用于 AI 反馈注入

### Trigger AI Translation (Manual)
`POST /api/v1/tickets/{id}/ai-translate`

发送工单到 `q.ticket.translation` 队列进行 AI 翻译处理。不立即改变工单状态。

### Trigger AI Reply (Manual)
`POST /api/v1/tickets/{id}/ai-reply`

发送工单到 `q.ticket.reply` 队列进行 AI 回复生成。不立即改变工单状态。

### Push Approved Reply to Freshdesk
`POST /api/v1/tickets/{id}/push-reply`

**Effect:** 推送 `APPROVED` 状态工单的选定回复到 Freshdesk，工单转换到 `COMPLETED`。

### Batch Push Approved Replies
`POST /api/v1/tickets/batch-push`

**Request Body:**
```json
[101, 102, 103]
```
**Response:** `ApiResponse<Integer>` — 成功推送的工单数量。

### Get Queue Counts
`GET /api/v1/tickets/queue-counts`

**Response:** `ApiResponse<Map<String, Integer>>` — 各状态队列的工单计数（PENDING_TRANS, PENDING_REPLY, PENDING_AUDIT, APPROVED 等）。

### Update Ticket Validity
`POST /api/v1/tickets/{id}/valid`

**Request Body:**
```json
{
  "isValid": true
}
```
**Permission:** 仅限 ADMIN 角色。用于标记工单是否在知识库中有效使用。

## Sync Management

### Manual Sync
`POST /api/v1/sync/freshdesk`

触发一次立即的增量同步（从 Freshdesk 同步新增/更新的工单到本地数据库）。

### Get Sync Config
`GET /api/v1/sync/config`

返回当前同步配置（Cron 表达式、启用标记、最后同步时间）。

**Response:** `ApiResponse<{ cronExpression: string, syncEnabled: boolean, lastSyncTime: ISO8601 datetime }>`

### Update Sync Config
`PUT /api/v1/sync/config`

**Request Body:**
```json
{
  "cronExpression": "0 0/10 * * * ?",
  "syncEnabled": true,
  "lastSyncTime": "2024-01-01T00:00:00Z"
}
```
**Permission:** 仅限 ADMIN 角色。

### Get Sync Status
`GET /api/v1/sync/status`

返回当前同步运行状态（是否正在同步、最后同步时间）。

**Response:** `ApiResponse<{ isSyncing: boolean, lastSyncTime: ISO8601 datetime }>`

### Get Sync Logs
`GET /api/v1/sync/logs`

返回同步执行历史记录（状态、触发类型、处理计数、时间戳）。

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | 页号 |
| `size` | int | 20 | 每页记录数 |

**Response:** `ApiResponse<Page<SyncLog>>` — 分页同步日志列表。

## User Settings

### Get User Settings for App
`GET /api/v1/user/settings/{appCode}`

返回指定应用的用户设置（JSON 字符串）。

**Response:** `ApiResponse<String>` — 返回 `settingsJson` 或 `null`

### Save User Settings
`PUT /api/v1/user/settings/{appCode}`

**Request Body:** JSON 字符串（例如 `"{\"mqEnabled\": true, \"notebookLMUrl\": \"...\"}"` 作为字符串发送）

**Response:** `ApiResponse<String>` — 返回保存成功的消息

### Delete User Settings
`DELETE /api/v1/user/settings/{appCode}`

删除指定应用的用户设置。

**Response:** `ApiResponse<Void>` — 返回删除成功的消息

### Get All User Settings
`GET /api/v1/user/settings`

返回当前用户所有应用的设置列表。

**Response:** `ApiResponse<List<UserAppSettings>>` — 返回用户全部应用设置记录

## Admin

### User Management

#### List All Users (Paginated)
`GET /api/v1/admin/users`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | 页号 |
| `size` | int | 20 | 每页记录数 |
| `status` | string | - | 按用户状态过滤（`PENDING`, `APPROVED`, `REJECTED`）|
| `username` | string | - | 按用户名模糊查询（不区分大小写）|

**Response:** `ApiResponse<Page<SysUser>>` — 分页用户列表，密码字段通过 `@JsonIgnore` 排除，按 `createdAt` 降序排列。

#### List Pending Users
`GET /api/v1/admin/users/pending`

**Response:** `ApiResponse<List<SysUser>>` — 所有状态为 `PENDING` 的用户。

#### Approve/Reject User
`POST /api/v1/admin/users/{id}/approve`

**Request Body:**
```json
{ "action": "APPROVE" }
```
或
```json
{ "action": "REJECT" }
```
**Permission:** 仅限 ADMIN 角色。

#### Update User Role
`PUT /api/v1/admin/users/{id}/role`

**Request Body:**
```json
{ "role": "ADMIN" }
```
接受值：`ADMIN`, `USER`。

**Permission:** 仅限 ADMIN 角色。

#### Reset User Password
`POST /api/v1/admin/users/{id}/reset-password`

**Request Body:**
```json
{ "password": "新密码" }
```
密码至少 6 个字符。

**Permission:** 仅限 ADMIN 角色。

## Knowledge Base Management

### List Knowledge Notes
`GET /api/v1/admin/knowledge/notes`

返回知识库注意事项列表。

**Response:** `ApiResponse<List<KnowledgeNote>>` — 包含 id, title, content, sortOrder 等字段。

### Create Knowledge Note
`POST /api/v1/admin/knowledge/notes`

**Request Body:**
```json
{
  "title": "注意事项标题",
  "content": "详细说明内容",
  "sortOrder": 1
}
```
**Response:** `ApiResponse<KnowledgeNote>`

**Permission:** 仅限 ADMIN 角色。

### Update Knowledge Note
`PUT /api/v1/admin/knowledge/notes/{id}`

**Request Body:**
```json
{
  "title": "更新后的标题",
  "content": "更新后的内容",
  "sortOrder": 1
}
```
**Permission:** 仅限 ADMIN 角色。

### Delete Knowledge Note
`DELETE /api/v1/admin/knowledge/notes/{id}`

**Permission:** 仅限 ADMIN 角色。

### Batch Mark Ticket Validity
`POST /api/v1/admin/knowledge/batch-valid`

**Request Body:**
```json
{
  "ticketIds": [101, 102, 103],
  "isValid": true
}
```
**Effect:** 批量标记指定工单的有效性标记。

**Permission:** 仅限 ADMIN 角色。

### Export Valid Tickets to CSV
`GET /api/v1/admin/knowledge/export/tickets`

**Response:** CSV 文件下载，包含所有 `isValid=true` 的工单数据。

### Export Knowledge Notes to CSV
`GET /api/v1/admin/knowledge/export/notes`

**Response:** CSV 文件下载，包含所有知识库注意事项。

## Database Administration

### Execute SQL Query
`POST /api/v1/admin/database/query`

**Request Body:**
```json
{
  "sql": "SELECT * FROM ticket WHERE status = 'PENDING_TRANS'",
  "maxRows": 1000
}
```
**Response:** `ApiResponse<QueryResult>` — 查询结果（列名、数据行）。

**Permission:** 仅限 ADMIN 角色。建议用于调试和数据导出。

### Get Table Metadata
`GET /api/v1/admin/database/tables`

返回数据库所有表的元数据信息（表名、列定义）。

**Response:** `ApiResponse<List<TableMetadata>>`

**Permission:** 仅限 ADMIN 角色。

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
**Permission:** 仅限 ADMIN 角色。

### Get WeChat Work Webhook Config
`GET /api/v1/config/wecom-webhook`

**Response:** `ApiResponse<{ url: string, enabled: boolean }>`

### Set WeChat Work Webhook Config
`PUT /api/v1/config/wecom-webhook`

**Request Body:**
```json
{ "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...", "enabled": true }
```
**Permission:** 仅限 ADMIN 角色。

### Test WeChat Work Webhook
`POST /api/v1/config/wecom-webhook/test`

**Response:** `ApiResponse<{ success: boolean }>`

## Task Management

### Claim Task
`POST /api/v1/tasks/claim`

客户端领取一个待处理任务。

**Request Body:**
```json
{
  "taskCode": "translation"
}
```

**Response:** `ApiResponse<TaskInstance>` — 返回领取的任务实例，包含 `id`, `taskCode`, `status`, `claimedAt` 等字段。若无待处理任务，返回 `null`。

### Complete Task
`POST /api/v1/tasks/{id}/complete`

客户端上报任务完成结果。

**Request Body:**
```json
{
  "result": "SUCCESS",
  "resultData": "{\"translationId\": 123, \"status\": \"completed\"}",
  "errorMessage": null
}
```

**Response:** `ApiResponse<TaskInstance>` — 返回更新后的任务实例

### Release Task
`POST /api/v1/tasks/{id}/release`

客户端释放一个已领取但未完成的任务（返还到待处理队列）。

**Response:** `ApiResponse<TaskInstance>` — 返回释放后的任务实例

### Get My Tasks
`GET /api/v1/tasks/mine`

获取当前用户的所有任务（分页）。

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | 页号 |
| `size` | int | 20 | 每页记录数 |
| `status` | string | - | 按状态过滤（`PENDING`, `CLAIMED`, `COMPLETED`, `FAILED`）|

**Response:** `ApiResponse<Page<TaskInstance>>` — 返回分页任务列表

### Task Dashboard (Admin)
`GET /api/v1/task-admin/dashboard`

获取任务执行统计和仪表板数据（ADMIN 权限）。

**Response:** `ApiResponse<TaskDashboard>` — 返回统计信息（总任务数、执行中、完成、失败等）

### List Task Definitions (Admin)
`GET /api/v1/task-admin/definitions`

列出所有任务定义（ADMIN 权限）。

**Response:** `ApiResponse<List<TaskDefinition>>` — 返回任务定义列表

### Create Task Definition (Admin)
`POST /api/v1/task-admin/definitions`

创建新的任务定义（ADMIN 权限）。

**Request Body:**
```json
{
  "code": "review",
  "name": "审核",
  "handler": "com.jefflower.fdserver.task.handler.ReviewTaskHandler",
  "cronExpression": "0 */5 * * * ?",
  "enabled": true
}
```

**Response:** `ApiResponse<TaskDefinition>`

### Toggle Task Definition (Admin)
`PUT /api/v1/task-admin/definitions/{id}/toggle`

启用或禁用任务定义（ADMIN 权限）。

**Request Body:**
```json
{
  "enabled": false
}
```

**Response:** `ApiResponse<TaskDefinition>`

### Manual Trigger Task (Admin)
`POST /api/v1/task-admin/definitions/{code}/trigger`

手动触发一个任务定义（立即创建任务实例，ADMIN 权限）。

**Response:** `ApiResponse<TaskInstance>`

### Get Task Execution History (Admin)
`GET /api/v1/task-admin/history`

获取任务执行历史记录（ADMIN 权限）。

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 0 | 页号 |
| `size` | int | 20 | 每页记录数 |
| `taskCode` | string | - | 按任务代码过滤 |
| `status` | string | - | 按状态过滤 |

**Response:** `ApiResponse<Page<TaskExecutionLog>>`

### Cleanup Task History (Admin)
`DELETE /api/v1/task-admin/history/cleanup`

清理过期的任务执行历史（ADMIN 权限）。

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `olderThanDays` | int | 30 | 清理多少天前的记录 |

**Response:** `ApiResponse<Integer>` — 返回删除的记录数

## Webhooks

### Receive Freshdesk Webhook
`POST /api/v1/webhook/freshdesk`

**Authentication:** 无需认证。支持 Freshdesk Webhook 签名验证（`X-Freshdesk-Webhook-Secret` 请求头）。

**Request Body:**
Freshdesk webhook 原始事件负载（JSON 格式）。系统自动处理工单创建/更新事件。

**Response:** `{ "status": "received" }`

**Note:** 该端点在系统初始化时需在 Freshdesk 管理后台配置 Webhook URL。
