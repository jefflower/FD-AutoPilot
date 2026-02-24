# Ticket Module (fd-server-ticket)

ticket 模块是 FD-AutoPilot 系统的核心业务引擎，管理工单的**完整生命周期**（Freshdesk 同步 → 翻译 → 回复 → 审核 → 推送），通过 RabbitMQ 实现异步任务分发，与 Freshdesk、企业微信等外部系统集成。

## 模块概览

### Maven 坐标

```xml
<dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-ticket</artifactId>
    <version>${project.version}</version>
</dependency>
```

**模块性质**: 核心业务模块，依赖 `fd-server-task`（间接依赖 auth 和 common）。集成 Freshdesk API、RabbitMQ、企业微信等外部服务。

### 职责范围

| 职责 | 说明 |
|------|------|
| **工单生命周期管理** | 工单创建、状态流转、完成关闭 |
| **Freshdesk 同步** | 定时轮询增量同步、Webhook 回调处理 |
| **翻译任务分发** | 通过 RabbitMQ 发送翻译任务到 fd-client（Gemini CLI） |
| **回复任务分发** | 通过 RabbitMQ 发送回复任务到 fd-client（NotebookLM） |
| **审核工作流** | 管理员或 AUDITOR 审核内容，支持通过/驳回，驳回时重新回复 |
| **回复推送** | 将审核通过的回复推送回 Freshdesk，失败自动重试 |
| **知识库管理** | 维护工单有效性标记、注意事项、数据导出 |
| **企业微信通知** | 审核事件、推送完成事件异步通知管理员 |
| **系统配置** | 自动推送开关、企业微信 Webhook、MQ 队列配置 |
| **数据库查询** | 管理员 SQL 查询（仅读、超时保护） |

### Maven 依赖链

```
common ← auth ← task ← ticket ← app

ticket 模块的依赖:
  ├─ fd-server-task (直接依赖，TaskDistributionService + 任务定义)
  │  └─ 传递获得: fd-server-auth + fd-server-common
  └─ Spring Boot 核心
      ├── spring-boot-starter-amqp (RabbitMQ)
      ├── spring-boot-starter-web (REST API)
      ├── spring-boot-starter-data-jpa (数据库)
      ├── spring-boot-starter-scheduling (定时任务)
      └── spring-boot-starter-test (仅测试)
```

### fd-server-ticket 的 Maven 依赖

```xml
<!-- ticket 模块的 pom.xml 依赖声明 -->
<dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-task</artifactId>
    <version>${project.version}</version>
</dependency>

<!-- 自动传递获得 fd-server-auth 和 fd-server-common 的所有依赖 -->

<!-- ticket 模块特有依赖 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

**允许的依赖**：
- `auth` 模块的所有公开 Service（`AuthService`、`RolePermissionService`、`UserAppSettingsService`）和接口
- `task` 模块的 `TaskDistributionService`、任务定义相关 API
- `common` 模块的工具类、公共 DTO、异常类
- Spring Boot 核心库（web、data-jpa、amqp、scheduling）

**禁止的依赖**：
- 不得引用 `auth` 模块的内部实现类（如 `SecurityConfig`、`JwtAuthenticationFilter` 等 security 包内部类）
- 不得引用 `task` 模块的内部实现细节（repository、scheduler、config 等）

---

## 工单工作流编排

### 编排器接口（TicketWorkflowOrchestrator）

工单处理通过 `TicketWorkflowOrchestrator` 接口编排。系统支持两种实现：

| 实现类 | 编排模式 | 说明 |
|--------|---------|------|
| `FlowableTicketOrchestrator` | Flowable BPMN | 通过 BPMN 流程驱动（当前默认） |
| `LegacyTicketOrchestrator` | 硬编码状态转换 | 传统 MQ 驱动（仅在 `fd.workflow.enabled=false` 时用） |

**核心方法**:
- `void onNewTicket(Ticket ticket)` — **新工单创建时调用**，启动编排流程（通常由 FreshdeskSyncService 调用）
- `void onTranslationCompleted(Long ticketId, ...)` — **Flowable 模式下为 no-op**（改由 WorkflowTaskCompletionListener 自动唤醒）
- `void onReplyCompleted(Long ticketId, ...)` — **Flowable 模式下为 no-op**
- `void onAuditCompleted(Long ticketId, ...)` — 审核完成后处理

---

## 工单状态机

### 状态定义 (TicketStatus Enum)

```
PENDING_TRANS      ← 初始状态，待翻译（并行网关后自动进入翻译+回复并行阶段）
  ↓ [翻译完成]
TRANSLATING        ← 翻译进行中
  ↓ [翻译回调成功]
PENDING_REPLY      ← 待生成回复
  ↓ [触发 AI 回复]
REPLYING           ← 回复生成中
  ↓ [回复完成+翻译完成]
PENDING_AUDIT      ← 待审核
  ↓ [提交审核]
AUDITING           ← 审核进行中
  ↓ [审核完成]
APPROVED           ← 审核通过，待推送（自动推送开关关闭时）
  ↓ [手动或批量推送]
COMPLETED          ← 已完成，已推送或自动推送（开关打开时）
```

### 状态流转规则

| 转换 | 触发事件 | 条件 | 目标状态 | MQ 任务 | 备注 |
|------|---------|------|---------|--------|------|
| PENDING_TRANS → TRANSLATING | 工单创建或手动翻译 | - | TRANSLATING | 发送翻译任务 | fd-client Gemini CLI 处理 |
| TRANSLATING → PENDING_REPLY | 翻译回调成功 | - | PENDING_REPLY | - | 自动流转 |
| PENDING_REPLY → REPLYING | 手动或 MQ 触发回复 | - | REPLYING | 发送回复任务 | fd-client NotebookLM 处理 |
| REPLYING → PENDING_AUDIT | 回复完成 | - | PENDING_AUDIT | 发送审核任务 | 通知 AUDITOR 审核 |
| PENDING_AUDIT → AUDITING | AUDITOR 提交审核 | - | AUDITING | - | 自动流转 |
| AUDITING → APPROVED | 审核通过 | auto_reply=OFF | APPROVED | - | 等待手动推送 |
| AUDITING → COMPLETED | 审核通过 | auto_reply=ON | COMPLETED | 发送推送任务 | 直接推送 Freshdesk |
| AUDITING → PENDING_REPLY | 审核驳回 | - | PENDING_REPLY | 发送回复任务 | 保存驳回意见到 lastAuditRemark，AI 重新回复时注入意见 |

### 核心字段

**Ticket Entity**:
- `lastAuditRemark`: 最后一次审核驳回意见（若当前状态是 PENDING_REPLY 且此字段非空，AI 回复 Prompt 中会自动注入作为约束条件）
- `contentHash`: 内容 SHA-256 哈希，用于去重（Freshdesk 同步时）
- `syncSource`: 同步来源（POLLING 定时轮询 or WEBHOOK 即时回调）

---

## 数据模型

### Entity 关系图

```
┌─────────────────────────────────────────────────────────────┐
│ Ticket                                                      │
├─────────────────────────────────────────────────────────────┤
│ PK  id                              │ BIGINT                │
│ UQ  externalId                      │ VARCHAR(255)          │
│     subject                         │ CLOB                  │
│     content                         │ CLOB (JSON)           │
│     sourceLang                      │ VARCHAR(10)           │
│     targetLang                      │ VARCHAR(10)           │
│     status                          │ ENUM(TicketStatus)    │
│     isValid                         │ BOOLEAN               │
│     lastAuditRemark                 │ CLOB (nullable)       │
│ FK  fdRequesterId                   │ BIGINT                │
│     fdResponderId                   │ BIGINT (nullable)     │
│     fdGroupId                       │ BIGINT (nullable)     │
│     fdStatus, fdPriority, fdSource  │ VARCHAR               │
│     fdTags                          │ VARCHAR (comma-sep)   │
│     fdCreatedAt, fdUpdatedAt        │ TIMESTAMP             │
│     contentHash                     │ VARCHAR(64) SHA-256   │
│     lastSyncedAt                    │ TIMESTAMP             │
│     syncSource                      │ ENUM(POLLING|WEBHOOK) │
│     createdAt, updatedAt            │ TIMESTAMP             │
└─────────────────────────────────────────────────────────────┘
         1:N            1:N             1:N
         │              │               │
         ↓              ↓               ↓
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ TicketTranslation    │  │ TicketReply          │  │ TicketAudit          │
├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
│ id (PK)              │  │ id (PK)              │  │ id (PK)              │
│ targetLang           │  │ replyLang            │  │ replyId (FK)         │
│ translatedTitle      │  │ zhReply (CLOB)       │  │ auditResult          │
│ translatedContent    │  │ targetReply (CLOB)   │  │ auditRemark (CLOB)   │
│ createdAt            │  │ isSelected           │  │ auditorId (FK)       │
└──────────────────────┘  │ createdAt            │  │ createdAt            │
                          └──────────────────────┘  └──────────────────────┘
```

**关键约束**:
- Ticket 的 `translations` 和 `replies` 使用 `@OneToMany(fetch=FetchType.EAGER)` 即时加载，避免 N+1 查询
- TicketTranslation 和 TicketReply 按 `createdAt DESC` 排序，查询时通常只取最新一条
- TicketAudit 记录所有审核历史（不覆盖）

### 配置表

#### SystemConfig
键值对表，存储系统级配置。

| Key | Value 示例 | 说明 |
|-----|-----------|------|
| `auto_reply_enabled` | `true` / `false` | 是否自动推送回复到 Freshdesk（AUDITING → COMPLETED or APPROVED） |
| `wecom_webhook_url` | `https://qyapi.weixin.qq.com/cgi-bin/webhook/...` | 企业微信群机器人 Webhook URL |
| `wecom_notify_enabled` | `true` / `false` | 是否启用企业微信通知 |
| `mq_queue_translation` | `q.ticket.translation` | 翻译队列名 |
| `mq_queue_reply` | `q.ticket.reply` | 回复队列名 |
| `mq_queue_audit` | `q.ticket.audit` | 审核队列名 |
| `notify_platform` | `wecom` / `dingtalk` / `none` | 通知平台（企业微信/钉钉/无） |
| `dingtalk_webhook_url` | `https://oapi.dingtalk.com/robot/send?access_token=...` | 钉钉 Webhook URL |
| `dingtalk_notify_enabled` | `true` / `false` | 是否启用钉钉通知 |
| `audit_base_url` | `https://fd.example.com` | 审核链接 baseUrl（用于生成移动审核链接） |
| `audit_token_expire_hours` | `24` | 审核令牌有效时长（小时，默认 24） |

#### SyncConfig
同步配置表。

| 字段 | 说明 |
|------|------|
| `freshdesk_sync_cron` | Cron 表达式，默认 `0 * * * * ?`（每分钟） |
| `freshdesk_sync_enabled` | 是否启用定时同步 |
| `freshdesk_last_sync_time` | 上次同步完成时间（用于增量同步) |

#### SyncLog
同步日志表，记录每次 Freshdesk 同步的详情。

| 字段 | 说明 |
|------|------|
| `startTime`, `endTime` | 同步执行时间 |
| `ticketsSynced` | 本次同步新增工单数 |
| `ticketsUpdated` | 本次同步更新工单数 |
| `status` | 同步状态（SUCCESS / FAILED） |
| `message` | 失败时的错误信息 |
| `triggerType` | 触发类型（POLLING / WEBHOOK / MANUAL） |

#### KnowledgeNote
知识库注意事项表。

| 字段 | 说明 |
|------|------|
| `title` | 注意事项标题 |
| `content` | 注意事项内容（Markdown） |
| `sortOrder` | 排序权重（升序） |
| `createdAt`, `updatedAt` | 创建/更新时间 |

#### FailedReplyPush
推送失败重试表。

| 字段 | 说明 |
|------|------|
| `ticketId` | 工单 ID |
| `replyId` | 回复 ID |
| `retryCount` | 当前重试次数 |
| `maxRetries` | 最大重试次数（默认 5） |
| `nextRetryAt` | 下次重试时间 |
| `lastError` | 最后一次错误信息 |

#### RequestRecord
客户端请求审计表（可选，用于审计日志）。

| 字段 | 说明 |
|------|------|
| `userId` | 用户 ID |
| `endpoint` | 请求端点 |
| `method` | HTTP 方法 |
| `statusCode` | 响应状态码 |
| `timestamp` | 请求时间 |

#### AuditToken
一次性审核令牌（用于移动审核，支持无登录状态访问）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT | 主键 |
| `token` | VARCHAR(60) UQ | Base64URL 编码的随机令牌（43字符，256bit 熵） |
| `ticketId` | BIGINT FK | 关联工单 ID |
| `status` | ENUM | ACTIVE / USED / EXPIRED / REVOKED |
| `usedAt` | TIMESTAMP | 使用时间（审核完成时设置） |
| `expireAt` | TIMESTAMP | 过期时间（默认 24h） |
| `createdAt` | TIMESTAMP | 创建时间 |

**枚举 AuditTokenStatus**:
- `ACTIVE` — 活跃可用，可提交审核
- `USED` — 已使用，禁止重复提交
- `EXPIRED` — 已过期，不可用
- `REVOKED` — 已撤销（工单状态变化时自动撤销）

### DTO

#### 请求 DTO

**TranslationRequest**
```json
{
  "targetLang": "zh-CN",
  "translatedTitle": "翻译后的标题",
  "translatedContent": "翻译后的内容"
}
```

**ReplyRequest**
```json
{
  "zhReply": "中文回复内容",
  "targetReply": "Target language reply content"
}
```

**AuditRequest**
```json
{
  "replyId": 123,
  "auditResult": "PASS",  // or "REJECT"
  "auditRemark": "审核意见（驳回时必填）"
}
```

**ValidRequest**
```json
{
  "isValid": true
}
```

**KnowledgeNoteRequest**
```json
{
  "title": "注意事项标题",
  "content": "注意事项内容",
  "sortOrder": 1
}
```

**BatchValidRequest**
```json
{
  "ticketIds": [1, 2, 3],
  "isValid": true
}
```

**SqlQueryRequest**
```json
{
  "sql": "SELECT * FROM ticket LIMIT 10"
}
```

#### 响应 DTO

**TicketListDTO** (轻量列表项，减少数据传输)
```json
{
  "id": 123,
  "externalId": "fd-12345",
  "subject": "工单主题",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "status": "PENDING_REPLY",
  "isValid": true,
  "createdAt": "2025-02-16T10:00:00Z",
  "latestTranslation": {
    "targetLang": "zh-CN",
    "translatedTitle": "...",
    "translatedContent": "..."
  },
  "latestReply": {
    "replyLang": "zh-CN",
    "zhReply": "...",
    "targetReply": "..."
  }
}
```

**Ticket** (完整详情，包含所有关联)
```json
{
  "id": 123,
  "externalId": "fd-12345",
  "subject": "工单主题",
  "content": {
    "html": "...",
    "text": "..."
  },
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "status": "PENDING_REPLY",
  "isValid": true,
  "lastAuditRemark": "需要更换回复语气",
  "fdStatus": "open",
  "fdPriority": "high",
  "fdSource": "email",
  "fdType": "question",
  "fdRequesterId": 12345,
  "fdResponderId": 67890,
  "fdGroupId": 111,
  "fdTags": ["urgent", "billing"],
  "fdCreatedAt": "2025-02-01T08:00:00Z",
  "fdUpdatedAt": "2025-02-16T10:00:00Z",
  "translations": [
    {
      "id": 456,
      "targetLang": "zh-CN",
      "translatedTitle": "...",
      "translatedContent": "...",
      "createdAt": "2025-02-16T09:00:00Z"
    }
  ],
  "replies": [
    {
      "id": 789,
      "replyLang": "zh-CN",
      "zhReply": "中文回复",
      "targetReply": "English reply",
      "isSelected": true,
      "createdAt": "2025-02-16T09:30:00Z"
    }
  ],
  "audits": [
    {
      "id": 1000,
      "replyId": 789,
      "auditResult": "REJECT",
      "auditRemark": "语气不太友好",
      "auditorId": 555,
      "createdAt": "2025-02-16T10:00:00Z"
    }
  ],
  "createdAt": "2025-02-01T08:00:00Z",
  "updatedAt": "2025-02-16T10:00:00Z"
}
```

**SqlQueryResult**
```json
{
  "success": true,
  "columns": ["id", "subject", "status"],
  "rows": [
    [1, "工单1", "COMPLETED"],
    [2, "工单2", "PENDING_REPLY"]
  ],
  "rowCount": 2,
  "executionTimeMs": 45
}
```

**TableInfo** (表元数据)
```json
{
  "name": "ticket",
  "columns": [
    {
      "name": "id",
      "type": "BIGINT",
      "nullable": false,
      "primaryKey": true
    },
    {
      "name": "subject",
      "type": "CLOB",
      "nullable": false,
      "primaryKey": false
    }
  ]
}
```

---

## REST API

所有 API 前缀 `/api/v1`，除 Webhook 和认证外需携带 `Authorization: Bearer <token>` 头。

### TicketController (/api/v1/tickets)

#### GET /tickets - 工单列表查询

查询工单列表，支持多维过滤、分页、排序。

**请求参数**（query string）:
- `status` (string, optional): 工单状态，多个值用 `,` 分隔（如 `PENDING_REPLY,AUDITING`）
- `externalId` (string, optional): Freshdesk 工单 ID，支持模糊查询
- `subject` (string, optional): 工单主题，支持模糊查询
- `isValid` (boolean, optional): 知识库有效性过滤
- `createdAfter` (ISO 8601, optional): 创建时间范围起始
- `createdBefore` (ISO 8601, optional): 创建时间范围结束
- `page` (int, default=0): 页码（0-indexed）
- `size` (int, default=20): 每页数量
- `sort_by` (string, default=`createdAt`): 排序字段（`createdAt`, `updatedAt`, `status`）
- `sort_dir` (string, default=`DESC`): 排序方向（`ASC`, `DESC`）
- `detail` (boolean, default=`false`): 是否返回完整详情（true 返回 Ticket，false 返回 TicketListDTO）

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "totalElements": 150,
    "totalPages": 8,
    "currentPage": 0,
    "pageSize": 20,
    "content": [
      // TicketListDTO 或 Ticket，取决于 detail 参数
    ]
  }
}
```

**权限**: `ticket:read`（USER、AUDITOR）

**示例**:
```bash
GET /api/v1/tickets?status=PENDING_REPLY,AUDITING&createdAfter=2025-02-01&page=0&size=10
```

---

#### GET /tickets/{id} - 工单详情

获取单个工单的完整信息，包括翻译历史、回复、审核记录。

**路径参数**:
- `id` (long): 工单 ID

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    // 完整 Ticket 对象
  }
}
```

**权限**: `ticket:read`

---

#### POST /tickets/{id}/translation - 提交翻译结果

提交翻译完成的结果（通常由 fd-client 翻译后端调用）。

**路径参数**:
- `id` (long): 工单 ID

**请求 Body**:
```json
{
  "targetLang": "zh-CN",
  "translatedTitle": "翻译后的标题",
  "translatedContent": "翻译后的内容"
}
```

**响应**:
```json
{
  "code": 0,
  "message": "翻译已保存，已发送回复任务"
}
```

**副作用**:
- 创建 TicketTranslation 记录
- 工单状态流转 TRANSLATING → PENDING_REPLY
- 发送 MQ 回复任务

**权限**: `ticket:translate`（USER）

**错误处理**:
- 400: 工单不在 TRANSLATING 状态（幂等性检查）
- 404: 工单不存在

---

#### POST /tickets/{id}/reply - 提交回复内容

提交 AI 生成的回复（fd-client 调用）。

**请求 Body**:
```json
{
  "zhReply": "中文回复内容",
  "targetReply": "English reply content"
}
```

**响应**:
```json
{
  "code": 0,
  "message": "回复已保存，已发送审核任务"
}
```

**副作用**:
- 创建 TicketReply 记录
- 工单状态流转 REPLYING → PENDING_AUDIT
- 发送 MQ 审核任务
- 异步通知管理员审核

**权限**: `ticket:reply`

---

#### PUT /tickets/{id}/reply/{replyId} - 更新回复内容

更新已提交的回复（仅当状态为 PENDING_AUDIT 时）。

**路径参数**:
- `id` (long): 工单 ID
- `replyId` (long): 回复 ID

**请求 Body**:
```json
{
  "zhReply": "修改后的中文回复",
  "targetReply": "Revised reply"
}
```

**权限**: `ticket:reply`

---

#### POST /tickets/{id}/audit - 提交审核结果

AUDITOR 或 ADMIN 提交审核意见（通过或驳回）。

**请求 Body**:
```json
{
  "replyId": 789,
  "auditResult": "PASS",  // or "REJECT"
  "auditRemark": "审核意见（驳回时必填）"
}
```

**响应**:
```json
{
  "code": 0,
  "message": "审核结果已保存"
}
```

**副作用 (PASS)**:
- 创建 TicketAudit 记录
- 如果 `auto_reply_enabled=true`: 状态流转 AUDITING → COMPLETED，发送推送任务
- 如果 `auto_reply_enabled=false`: 状态流转 AUDITING → APPROVED
- 异步通知管理员和提交者

**副作用 (REJECT)**:
- 创建 TicketAudit 记录
- 状态流转 AUDITING → PENDING_REPLY
- 保存 `auditRemark` 到 Ticket.lastAuditRemark
- 发送 MQ 回复任务，AI 下次生成回复时会注入驳回意见

**权限**: `ticket:audit`（AUDITOR、ADMIN）

---

#### POST /tickets/{id}/skip-reply - 跳过回复

标记工单为完成，跳过回复生成（用于特殊情况）。

**响应**:
```json
{
  "code": 0,
  "message": "工单已标记完成"
}
```

**副作用**:
- 工单状态直接流转为 COMPLETED
- 记录跳过原因（如有）

**权限**: `ticket:manage`（ADMIN）

---

#### POST /tickets/{id}/ai-translate - 手动触发翻译

手动触发 AI 翻译（不受工单状态限制，用于重新翻译）。

**请求 Body** (optional):
```json
{
  "targetLang": "zh-CN"
}
```

**副作用**:
- 工单状态流转到 TRANSLATING
- 发送 MQ 翻译任务

**权限**: `ticket:translate`

---

#### POST /tickets/{id}/ai-reply - 手动触发回复

手动触发 AI 生成回复。

**副作用**:
- 工单状态流转到 REPLYING
- 发送 MQ 回复任务

**权限**: `ticket:reply`

---

#### POST /tickets/{id}/push-reply - 手动推送

将 APPROVED 状态的工单回复手动推送到 Freshdesk。

**响应**:
```json
{
  "code": 0,
  "message": "回复已推送到 Freshdesk"
}
```

**副作用**:
- 调用 Freshdesk API 发送回复
- 工单状态流转为 COMPLETED
- 若推送失败，记录到 FailedReplyPush，定时重试

**权限**: `ticket:push`（AUDITOR、ADMIN）

**前置条件**: 工单状态为 APPROVED

---

#### POST /tickets/batch-push - 批量推送

批量推送多个 APPROVED 工单。

**请求 Body**:
```json
{
  "ticketIds": [1, 2, 3]
}
```

**响应**:
```json
{
  "code": 0,
  "message": "已发送推送请求",
  "data": {
    "successCount": 2,
    "failureCount": 1,
    "failedIds": [3]
  }
}
```

**权限**: `ticket:push`（AUDITOR、ADMIN）

---

#### GET /tickets/queue-counts - 队列工单计数

获取各状态工单的计数（用于仪表盘）。

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "PENDING_TRANS": 5,
    "TRANSLATING": 2,
    "PENDING_REPLY": 10,
    "REPLYING": 3,
    "PENDING_AUDIT": 8,
    "AUDITING": 1,
    "APPROVED": 15,
    "COMPLETED": 150
  }
}
```

**权限**: `ticket:read`

---

#### POST /tickets/{id}/valid - 更新有效性标记

标记工单是否有效（用于知识库导出过滤）。

**请求 Body**:
```json
{
  "isValid": true
}
```

**权限**: `ticket:manage`（ADMIN）

---

#### GET /tickets/{id}/audit-token - 获取或生成审核令牌

为指定工单生成或获取一次性审核令牌（用于桌面端生成移动审核链接）。

**路径参数**:
- `id` (long): 工单 ID

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-",
    "expireAt": "2025-02-17T10:30:00Z",
    "auditUrl": "https://fd.example.com/audit/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-"
  }
}
```

**工作流**:
1. 撤销该工单所有旧的 ACTIVE Token
2. 若工单已有 ACTIVE Token，直接返回（复用原 Token）
3. 否则生成新 Token（Base64URL，256bit 熵）
4. 设置过期时间为 24h 后（可配置）

**权限**: `ticket:audit`（AUDITOR、ADMIN）

**前置条件**: 工单状态为 PENDING_AUDIT

---

### SyncController (/api/v1/sync)

#### POST /sync/freshdesk - 手动触发 Freshdesk 同步

立即执行一次 Freshdesk 增量同步。

**响应**:
```json
{
  "code": 0,
  "message": "同步完成",
  "data": {
    "syncedCount": 5,
    "updatedCount": 2,
    "skippedCount": 1,
    "success": true,
    "message": ""
  }
}
```

**副作用**:
- 查询 Freshdesk API 获取增量工单
- 检查内容哈希去重
- 创建或更新 Ticket 记录
- 创建 SyncLog 记录

**权限**: `sync:manage`（ADMIN）

---

#### GET /sync/config - 获取同步配置

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "freshdesk_sync_cron": "0 * * * * ?",
    "freshdesk_sync_enabled": true,
    "freshdesk_last_sync_time": "2025-02-16T10:30:00Z"
  }
}
```

**权限**: `sync:read`（ADMIN）

---

#### PUT /sync/config - 更新同步配置

**请求 Body**:
```json
{
  "freshdesk_sync_cron": "0 */5 * * * ?",
  "freshdesk_sync_enabled": true
}
```

**权限**: `sync:manage`（ADMIN）

---

#### GET /sync/status - 获取同步状态

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "isRunning": false,
    "lastSyncTime": "2025-02-16T10:30:00Z",
    "nextSyncTime": "2025-02-16T11:00:00Z",
    "enabled": true
  }
}
```

---

#### GET /sync/logs - 同步日志

**请求参数**:
- `page` (int, default=0)
- `size` (int, default=20)

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "totalElements": 100,
    "content": [
      {
        "id": 1,
        "startTime": "2025-02-16T10:00:00Z",
        "endTime": "2025-02-16T10:05:00Z",
        "ticketsSynced": 5,
        "ticketsUpdated": 2,
        "status": "SUCCESS",
        "triggerType": "POLLING"
      }
    ]
  }
}
```

---

### ConfigController (/api/v1/config)

#### GET /config/auto-reply - 获取自动推送配置

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "auto_reply_enabled": false
  }
}
```

**权限**: 无限制（提供给前端显示）

---

#### PUT /config/auto-reply - 更新自动推送配置

**请求 Body**:
```json
{
  "auto_reply_enabled": true
}
```

**权限**: `system:config:manage`（ADMIN）

---

#### GET /config/wecom-webhook - 获取企业微信配置

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "wecom_webhook_url": "https://qyapi.weixin.qq.com/...",
    "wecom_notify_enabled": true
  }
}
```

**权限**: `system:config:read`（ADMIN）

---

#### PUT /config/wecom-webhook - 更新企业微信配置

**请求 Body**:
```json
{
  "wecom_webhook_url": "https://qyapi.weixin.qq.com/...",
  "wecom_notify_enabled": true
}
```

**权限**: `system:config:manage`（ADMIN）

---

#### POST /config/wecom-webhook/test - 测试企业微信连通性

发送测试消息到企业微信，验证 Webhook URL 是否可用。

**响应**:
```json
{
  "code": 0,
  "message": "测试消息已发送，请检查企业微信群"
}
```

**权限**: `system:config:manage`（ADMIN）

---

#### GET /config/notify-channel - 获取通知渠道配置

获取当前通知平台配置（企业微信/钉钉）。

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "platform": "wecom",
    "webhookUrl": "https://qyapi.weixin.qq.com/...",
    "enabled": true,
    "auditBaseUrl": "https://fd.example.com"
  }
}
```

**权限**: `system:config:read`（ADMIN）

---

#### PUT /config/notify-channel - 保存通知渠道配置

更新通知渠道配置。

**请求 Body**:
```json
{
  "platform": "wecom" | "dingtalk" | "none",
  "webhookUrl": "https://...",
  "enabled": true,
  "auditBaseUrl": "https://fd.example.com"
}
```

**权限**: `system:config:manage`（ADMIN）

---

#### POST /config/notify-channel/test - 测试通知渠道

发送测试消息到当前配置的通知渠道。

**响应**:
```json
{
  "code": 0,
  "message": "测试消息已发送"
}
```

**权限**: `system:config:manage`（ADMIN）

---

### AuditTokenController (/api/v1/audit-token)

移动审核端点（无需 JWT，Token 自身即认证，支持在移动设备上使用）。

#### GET /audit-token/{token} - 获取工单审核详情

通过一次性审核令牌获取工单的完整审核信息（包括翻译、回复、历史）。

**路径参数**:
- `token` (string): 一次性审核令牌

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "ticketId": 123,
    "externalId": "fd-12345",
    "subject": "工单主题",
    "content": "原文内容",
    "translatedTitle": "翻译的标题",
    "translatedContent": "翻译的内容",
    "zhReply": "中文回复",
    "targetReply": "English reply",
    "replyId": 789,
    "status": "PENDING_AUDIT",
    "lastAuditRemark": "上次驳回意见（若有）",
    "auditHistory": [
      {
        "auditResult": "REJECT",
        "auditRemark": "语气不太友好",
        "createdAt": "2025-02-16T10:00:00Z"
      }
    ],
    "alreadyAudited": false
  }
}
```

**权限**: 无（Token 自身即认证）

**安全约束**:
- Token 有效期 24h（可配置 `audit_token_expire_hours`）
- Token 一次性使用，提交审核后标记 USED，禁止重复使用
- 使用悲观锁 `SELECT ... FOR UPDATE` 防并发提交

**错误处理**:
- 404: Token 不存在
- 410: Token 已过期或已使用（EXPIRED / USED / REVOKED）
- 400: Token 对应的工单不在 PENDING_AUDIT 状态

---

#### POST /audit-token/{token}/submit - 提交审核结果

通过审核令牌提交审核意见（移动端无登录直接审核）。

**路径参数**:
- `token` (string): 一次性审核令牌

**请求 Body**:
```json
{
  "auditResult": "PASS" | "REJECT",
  "auditRemark": "驳回意见（可选，REJECT 时建议填写）"
}
```

**响应**:
```json
{
  "code": 0,
  "message": "审核已提交，工单进入下一阶段"
}
```

**副作用** (同 `/api/v1/tickets/{id}/audit`):
- PASS: 状态流转为 APPROVED 或 COMPLETED（取决于 auto_reply_enabled 配置）
- REJECT: 状态流转为 PENDING_REPLY，保存 auditRemark

**权限**: 无（Token 自身即认证）

**安全约束**:
- 提交前 Token 状态必须为 ACTIVE
- 提交成功后 Token 立即标记 USED，防重复提交
- 悲观锁确保并发安全

**错误处理**:
- 404: Token 不存在
- 409: Token 已被使用（重复提交）
- 410: Token 已过期或已撤销

---

### KnowledgeController (/api/v1/admin/knowledge)

#### GET /admin/knowledge/notes - 知识库注意事项列表

**请求参数**:
- `page` (int, default=0)
- `size` (int, default=20)
- `sortBy` (string, default=`sortOrder`)

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "totalElements": 10,
    "content": [
      {
        "id": 1,
        "title": "注意事项 1",
        "content": "内容",
        "sortOrder": 1,
        "createdAt": "2025-02-01T00:00:00Z"
      }
    ]
  }
}
```

**权限**: `knowledge:read`（ADMIN）

---

#### POST /admin/knowledge/notes - 创建注意事项

**请求 Body**:
```json
{
  "title": "新注意事项",
  "content": "# Markdown 内容",
  "sortOrder": 1
}
```

**权限**: `knowledge:manage`（ADMIN）

---

#### PUT /admin/knowledge/notes/{id} - 编辑注意事项

**权限**: `knowledge:manage`（ADMIN）

---

#### DELETE /admin/knowledge/notes/{id} - 删除注意事项

**权限**: `knowledge:manage`（ADMIN）

---

#### POST /admin/knowledge/batch-valid - 批量标记有效性

**请求 Body**:
```json
{
  "ticketIds": [1, 2, 3],
  "isValid": true
}
```

**权限**: `knowledge:manage`（ADMIN）

---

#### GET /admin/knowledge/export/tickets - 导出工单 CSV

导出所有有效工单（`isValid=true`）的工单号、主题、源语言、内容、翻译、回复等。

**请求参数**:
- `format` (string, default=`csv`): 导出格式

**响应**: CSV 文件（`Content-Type: text/csv`）

**权限**: `knowledge:manage`（ADMIN）

---

#### GET /admin/knowledge/export/notes - 导出注意事项 CSV

**响应**: CSV 文件

**权限**: `knowledge:manage`（ADMIN）

---

### DatabaseController (/api/v1/admin/database)

#### POST /admin/database/query - 执行 SQL 查询

执行只读 SQL 查询，支持 SELECT 语句。**仅 ADMIN 且需提供超级密码**。

**请求 Body**:
```json
{
  "sql": "SELECT id, subject, status FROM ticket WHERE status = 'COMPLETED' LIMIT 10"
}
```

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "success": true,
    "columns": ["id", "subject", "status"],
    "rows": [
      [1, "工单 1", "COMPLETED"],
      [2, "工单 2", "COMPLETED"]
    ],
    "rowCount": 2,
    "executionTimeMs": 25
  }
}
```

**权限**: `database:execute`（ADMIN）

**安全约束**:
- 仅允许 SELECT 语句（SqlValidator 校验）
- 查询超时 30 秒（防 DoS）
- 自动追加 LIMIT 1000（防结果过大）
- 需提供超级密码（SuperPasswordVerifier 校验）

**错误处理**:
- 400: SQL 语法错误或非 SELECT 语句
- 401: 超级密码不匹配
- 503: 查询超时

---

#### GET /admin/database/tables - 获取表元数据

返回所有表及其列定义。

**响应**:
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "name": "ticket",
      "columns": [
        {
          "name": "id",
          "type": "BIGINT",
          "nullable": false,
          "primaryKey": true
        },
        {
          "name": "subject",
          "type": "CLOB",
          "nullable": false,
          "primaryKey": false
        }
      ]
    },
    {
      "name": "ticket_translation",
      "columns": [/* ... */]
    }
  ]
}
```

**权限**: `database:read`（ADMIN）

---

### WebhookController (/api/v1/webhook)

#### POST /webhook/freshdesk - Freshdesk Webhook 回调

接收 Freshdesk 发送的实时事件（工单更新、回复等）。**无需 token**。

**请求 Body** (Freshdesk Webhook 格式):
```json
{
  "action": "ticket_update",
  "ticket": {
    "id": 12345,
    "subject": "...",
    "description": "...",
    ...
  }
}
```

**响应**:
```json
{
  "code": 0,
  "message": "webhook received"
}
```

**副作用**:
- 解析 Webhook 事件
- 更新对应工单或创建新工单
- 创建 SyncLog 记录（`triggerType=WEBHOOK`）
- 若工单需要翻译，发送 MQ 翻译任务

**错误处理**:
- 200: 接收成功（即使处理失败也返回 200，避免 Freshdesk 重试）
- 处理失败写入日志，后续定时同步会补偿

---

## RabbitMQ 消息协议

### 拓扑

```
┌─────────────────────────────────────────────┐
│ Exchange: fd.ticket.task.exchange           │
│ Type: TopicExchange                         │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┼───────┬────────────┐
       │       │       │            │
   (tk.tr) (tk.re) (tk.au)      (DLX)
       │       │       │            │
   ┌───▼──┐ ┌──▼──┐ ┌──▼──┐  ┌──────▼──┐
   │translation│ │ reply │ │ audit  │  │ dlq  │
   │ queue  │ │queue │ │ queue  │  │(DLQ)│
   └────────┘ └──────┘ └───────┘  └──────┘
       ▲         ▲         ▲
       │         │         │
    publish   publish   publish
  (server)  (server)  (server)
```

### Exchange & Queue 绑定

| Exchange | RoutingKey | Queue | 用途 |
|----------|-----------|-------|------|
| `fd.ticket.task.exchange` | `ticket.task.translate` | `q.ticket.translation` | 翻译任务 |
| `fd.ticket.task.exchange` | `ticket.task.reply` | `q.ticket.reply` | 回复任务 |
| `fd.ticket.task.exchange` | `ticket.task.audit` | `q.ticket.audit` | 审核任务 |
| `fd.ticket.task.exchange` | `ticket.task.dlq` | `q.ticket.dlq` | 死信队列 |

### 消息格式

#### 通用消息结构

所有消息均为 JSON，包含以下公共字段：

```json
{
  "msgId": "uuid",
  "ticketId": 123,
  "externalId": "fd-12345",
  "timestamp": "2025-02-16T10:00:00Z",
  "payload": {
    // 任务特定字段
  }
}
```

**字段说明**:
- `msgId`: 消息唯一 ID（UUID），用于去重
- `ticketId`: 工单 ID
- `externalId`: Freshdesk 工单 ID
- `timestamp`: 消息发送时间
- `payload`: 任务特定负载

#### 翻译任务 (ticket.task.translate)

```json
{
  "msgId": "550e8400-e29b-41d4-a716-446655440000",
  "ticketId": 123,
  "externalId": "fd-12345",
  "timestamp": "2025-02-16T10:00:00Z",
  "payload": {
    "subject": "工单主题",
    "content": {
      "html": "<p>HTML content</p>",
      "text": "Plain text content"
    },
    "sourceLang": "en",
    "targetLang": "zh-CN",
    "lastAuditRemark": null  // 若驳回重新翻译，此字段包含驳回意见
  }
}
```

**消费者**: fd-client Rust 后端（`src-tauri/src/ai.rs`）
- 调用 `gemini CLI` 执行翻译
- 完成后 POST `/api/v1/tickets/{id}/translation`

---

#### 回复任务 (ticket.task.reply)

```json
{
  "msgId": "uuid",
  "ticketId": 123,
  "externalId": "fd-12345",
  "timestamp": "2025-02-16T10:00:00Z",
  "payload": {
    "subject": "工单主题",
    "content": {
      "html": "<p>HTML content</p>",
      "text": "Plain text content"
    },
    "translatedTitle": "翻译后的标题",
    "translatedContent": "翻译后的内容",
    "sourceLang": "en",
    "targetLang": "zh-CN",
    "lastAuditRemark": "若是驳回重新回复，此字段包含审核驳回意见"
  }
}
```

**消费者**: fd-client React 前端（`src/services/notebookShadow.ts`）
- 打开 NotebookLM 影子窗口
- 输入 Prompt（参考原内容 + 翻译 + 驳回意见）
- 等待生成完成
- POST `/api/v1/tickets/{id}/reply`

---

#### 审核任务 (ticket.task.audit)

```json
{
  "msgId": "uuid",
  "ticketId": 123,
  "externalId": "fd-12345",
  "timestamp": "2025-02-16T10:00:00Z",
  "payload": {
    "zhReply": "中文回复内容",
    "targetReply": "English reply content",
    "subject": "工单主题",
    "requesterId": 12345
  }
}
```

**消费者**: fd-client React 前端（`src/components/server/AuditTaskTab.tsx`）
- 显示回复内容给 AUDITOR
- AUDITOR 点击"通过"或"驳回"
- 前端 POST `/api/v1/tickets/{id}/audit`

---

### 消息发送保证

**发布端** (MqPublisherService):
- **事务性**: 消息发送位于数据库事务内，确保 Ticket 状态变更和消息发送原子性
- **Publisher Confirm**: 启用 RabbitMQ Publisher Confirm，确保消息到达 Broker
- **重试策略**: 发送失败自动重试，指数退避（500ms → 1s → 2s，最多 3 次）
- **幂等性**: 通过 `msgId` 全局唯一性检查（在消费端实现）

**消费端** (fd-client):
- **幂等性**: 消费消息前检查 `msgId` 是否已处理，避免重复消费
- **死信队列**: 消费失败（异常或超时）自动转入死信队列 `q.ticket.dlq`
- **手动 ACK**: 消费成功后手动发送 ACK，失败或超时则重试

---

## 工作流回调配置（TicketWorkflowCallbackConfig）

工单处理过程中的业务回调通过 `TicketWorkflowCallbackConfig` 注册到 `WorkflowCallbackRegistry`：

| 回调类型 | 触发时机 | 业务行为 | 版本变更 |
|---------|---------|---------|---------|
| `ticket.translationDone` | 翻译完成后 | 更新工单状态为 PENDING_REPLY | 保留 |
| `ticket.bothDone` | **翻译和回复都完成后**（并行汇聚） | 更新工单状态为 PENDING_AUDIT，发送审核通知 | **新增（v0.4.1）** |
| `ticket.replyDone` | 回复完成后 | no-op（由 bothDone 统一处理） | **已弃用（v0.4.1）** |
| `ticket.auditPass` | 审核通过后 | 标记回复、更新工单状态为 APPROVED/COMPLETED | 保留 |
| `ticket.auditReject` | 审核驳回后 | 保存驳回意见、状态回退 | 保留 |

**说明**：
- 从 v0.4.1 起，系统采用并行网关，翻译和回复独立完成后，通过 `bothDone` 统一处理状态转换
- `ticket.replyDone` 回调已不再使用（传统串行模式遗留）

---

## 核心 Service

### TicketService

工单业务编排的核心 Service，负责工单工作流、状态流转、任务分发。

#### 核心方法

**查询**:
- `Page<Ticket> queryTickets(TicketQueryFilter filter, Pageable pageable)` — 分页查询工单（支持状态、主题、有效性过滤）
- `Page<TicketListDTO> queryTicketsAsDTO(TicketQueryFilter filter, Pageable pageable)` — 查询并返回轻量 DTO
- `Ticket getTicketById(Long id)` — 获取单个工单（EntityGraph 加载关联）
- `Optional<Ticket> getTicketByExternalId(String externalId)` — 根据 Freshdesk ID 查询

**工单生命周期**:
- `Ticket submitTranslation(Long id, TranslationRequest req)` — 提交翻译（幂等性 + 状态流转 + MQ）
- `Ticket submitReply(Long id, ReplyRequest req)` — 提交回复（同上）
- `Ticket submitAudit(Long id, AuditRequest req)` — 提交审核（PASS/REJECT 分支）
- `Ticket skipReply(Long id)` — 跳过回复直接完成

**推送**:
- `void pushApprovedReply(Long id)` — 手动推送单个工单
- `Map<Long, Boolean> batchPushApprovedReplies(List<Long> ticketIds)` — 批量推送

**AI 触发**:
- `void triggerAiTranslation(Long id)` — 手动触发翻译
- `void triggerAiReply(Long id)` — 手动触发回复

**维护**:
- `void resetProcessingTickets()` — 回退处理中的工单（应用启动或故障恢复时）

#### 工作流细节

**submitTranslation 工作流**:
```
1. 检查工单是否存在 → 404
2. 检查工单状态是否为 TRANSLATING → 400（幂等性）
3. 创建 TicketTranslation 记录
4. 更新工单状态 TRANSLATING → PENDING_REPLY
5. 发送 MQ 回复任务（ticket.task.reply）
6. 创建 TaskInstance 记录（task 模块，用于前端追踪）
7. 返回更新后的工单
```

**submitReply 工作流**:
```
1. 检查工单是否存在 → 404
2. 检查工单状态是否为 REPLYING → 400（幂等性）
3. 创建 TicketReply 记录
4. 更新工单状态 REPLYING → PENDING_AUDIT
5. 生成审核令牌：auditTokenService.generateToken(ticketId)
6. 发送 MQ 审核任务（ticket.task.audit）
7. 发送审核通知（含审核链接）：notifyService.notifyPendingAudit(ticket, token)
8. 创建 TaskInstance 记录（用于前端追踪）
9. 返回更新后的工单
```

**submitAudit 工作流** (仅限 JWT 认证端点):
```
审核通过 (PASS):
  1. 创建 TicketAudit 记录（auditResult=PASS）
  2. 检查 auto_reply_enabled：
     - ON: 状态流转 AUDITING → COMPLETED，发送推送任务，MQ 推送
     - OFF: 状态流转 AUDITING → APPROVED
  3. 撤销该工单所有 ACTIVE AuditToken（标记为 REVOKED）
  4. 异步通知管理员和提交者：notifyService.notifyAuditPass(ticket)
  5. 返回工单

审核驳回 (REJECT):
  1. 创建 TicketAudit 记录（auditResult=REJECT, auditRemark=req.remark）
  2. 保存驳回意见到 Ticket.lastAuditRemark
  3. 状态流转 AUDITING → PENDING_REPLY
  4. 撤销该工单所有 ACTIVE AuditToken（标记为 REVOKED）
  5. 发送 MQ 回复任务（payload 中包含 lastAuditRemark）
  6. 异步通知管理员：notifyService.notifyAuditReject(ticket, remark)
  7. 返回工单
```

**通过 AuditToken 提交审核** (AuditTokenController.submitByToken):
```
1. 消费 Token：auditTokenService.consumeToken(token) → ticketId
2. 查询工单，验证状态为 PENDING_AUDIT
3. 执行与 submitAudit 相同的审核逻辑（PASS/REJECT）
4. 注意：通过 Token 审核时，auditResult 中的审核人为 "Mobile Auditor"（移动审核）
```

---

### MqPublisherService

消息发布服务，负责向 RabbitMQ 发送工单任务。

#### 核心方法

- `void sendTranslationTask(Ticket ticket)` — 发送翻译任务
- `void sendReplyTask(Ticket ticket)` — 发送回复任务
- `void sendAuditTask(Ticket ticket, TicketReply reply)` — 发送审核任务

**实现细节**:
- 消息格式: JSON 序列化，包含 `msgId`、`timestamp` 等公共字段
- Publisher Confirm: 监听 `CorrelationData` 回调，失败重试
- 事务提交后发送: 使用 `TransactionSynchronizationManager` 确保数据库事务提交后再发送消息

---

### FreshdeskSyncService

Freshdesk 同步服务，负责增量同步和 Webhook 处理。

#### 核心方法

- `SyncResult syncTicketsWithLock()` — 分布式锁保护的增量同步
- `void processSingleTicketFromWebhook(FreshdeskWebhookPayload payload)` — 处理 Webhook 事件

#### 同步逻辑

**增量同步** (syncTicketsWithLock):
```
1. 获取分布式锁（Redis key: `freshdesk_sync_lock`）
2. 读取 SyncConfig.freshdesk_last_sync_time（或 5 分钟前作为回溯）
3. 调用 Freshdesk API: GET /api/v2/tickets?updated_since=<timestamp>&per_page=100（分页）
4. 对每个工单：
   - 计算内容 SHA-256 哈希
   - 若哈希已存在 → skip（内容未变）
   - 否则 → insert 或 update Ticket 记录
   - 若为新工单 → 调用 orchestrator.onNewTicket(ticket) **启动编排流程**
5. 更新 SyncConfig.freshdesk_last_sync_time
6. 创建 SyncLog 记录（syncedCount, updatedCount, status）
7. 释放分布式锁
```

**Webhook 处理** (processSingleTicketFromWebhook):
```
1. 解析 Webhook payload
2. 查询本地是否存在此工单
3. 不存在 → insert；存在 → update
4. 若为新工单 → 调用 orchestrator.onNewTicket(ticket) **启动编排流程**
```

**说明**：`onNewTicket()` 替代了原先的直接 TaskInstance 创建逻辑。在 Flowable 模式下，此方法启动 BPMN 流程实例；在 Legacy 模式下，创建初始翻译任务。

---

### ReplyPushService

回复推送服务，负责将审核通过的回复推送到 Freshdesk。

#### 核心方法

- `void pushReplyToFreshdesk(Ticket ticket, TicketReply reply)` — 推送单个回复

#### 推送流程

```
1. 调用 Freshdesk API: POST /api/v2/tickets/{externalId}/reply
   {
     "body": "<p>中文回复</p><p>English reply</p>",
     "status": 2 (pending)
   }
2. 推送成功 → 工单状态流转为 COMPLETED，删除 FailedReplyPush 记录
3. 推送失败 → 创建或更新 FailedReplyPush 记录，设置 nextRetryAt 为下次重试时间
   - 重试时间: 5min → 10min → 20min → 40min → 80min（共 5 次）
```

---

### SystemConfigService

系统配置服务，提供 CRUD 接口，支持缓存。

#### 核心方法

- `String getConfig(String key)` — 获取配置值
- `void setConfig(String key, String value)` — 更新配置值
- `boolean isAutoReplyEnabled()` — 检查自动推送开关
- `String getWeChatWebhook()` — 获取企业微信 Webhook URL

---

### SyncConfigService

同步配置服务，管理 Freshdesk 同步的 cron、启用开关、上次同步时间。

#### 核心方法

- `SyncConfig getSyncConfig()` — 获取配置
- `void updateSyncConfig(SyncConfig config)` — 更新配置
- `Timestamp getLastSyncTime()` — 获取上次同步时间
- `void updateLastSyncTime(Timestamp time)` — 更新上次同步时间（同步完成后调用）

---

### KnowledgeNoteService

知识库注意事项服务。

#### 核心方法

- `Page<KnowledgeNote> listNotes(Pageable pageable)` — 列表
- `KnowledgeNote create(KnowledgeNoteRequest req)` — 创建
- `KnowledgeNote update(Long id, KnowledgeNoteRequest req)` — 编辑
- `void delete(Long id)` — 删除
- `void batchMarkValid(List<Long> ticketIds, boolean valid)` — 批量标记有效性
- `String exportAsCSV()` — 导出 CSV

---

### AuditTokenService

审核令牌管理服务，负责生成、验证、消费一次性审核令牌。

#### 核心方法

- `AuditToken generateToken(Long ticketId)` — 生成新的审核令牌
  - 撤销该工单所有旧的 ACTIVE Token（标记为 REVOKED）
  - 生成新 Token：SecureRandom(32bytes) + Base64URL，43 字符
  - 设置过期时间为当前时间 + 24h（可配置 `audit_token_expire_hours`）
  - Token 状态初始化为 ACTIVE
  - 返回新生成的 AuditToken

- `AuditToken getOrCreateToken(Long ticketId)` — 获取或创建审核令牌
  - 优先查询工单的 ACTIVE Token
  - 若存在且未过期，直接返回
  - 否则调用 generateToken() 创建新 Token

- `AuditTokenDetail getDetailByToken(String token)` — 获取工单审核详情
  - 查询 Token 对应的工单
  - 验证 Token 状态（ACTIVE，未过期）
  - 加载工单的翻译、回复、审核历史
  - 检查工单状态是否为 PENDING_AUDIT（若否返回错误）

- `Long consumeToken(String token)` — 消费 Token（标记 USED）
  - 使用悲观锁 `SELECT ... FOR UPDATE` 查询 Token
  - 验证 Token 状态为 ACTIVE 且未过期
  - 原子性标记 Token 为 USED，设置 usedAt = now()
  - 返回 ticketId

- `void revokeToken(Long ticketId)` — 撤销指定工单的所有 ACTIVE Token
  - 查询工单的所有 ACTIVE Token
  - 批量更新状态为 REVOKED
  - 用于工单状态变化时自动清理旧 Token

#### 安全设计

**Token 生成**:
- 熵源：`SecureRandom.nextBytes(32)` 生成 256bit 随机数
- 编码：Base64URL 编码（移除 `=` padding），43 字符
- 存储：数据库唯一索引确保 Token 唯一性

**Token 消费**:
- 悲观锁 `SELECT ... FOR UPDATE` 防并发重复使用
- 一旦标记 USED，任何再次提交将被拒绝（409 状态码）
- 过期检查：`expireAt > now()`

**Token 撤销**:
- 工单状态变化时（非 PENDING_AUDIT），自动撤销所有 ACTIVE Token
- 例如：PENDING_AUDIT → APPROVED 时，旧 Token 全部 REVOKED

---

### NotifyService (通知策略模式)

统一的通知服务，支持多种通知平台（企业微信、钉钉等）。

#### 设计：策略模式

```
NotifyStrategy (接口)
  ├── WeChatWorkNotifyStrategy
  └── DingTalkNotifyStrategy

NotifyService (策略路由层)
  └── 根据 SystemConfig.notify_platform 选择具体 Strategy
```

#### NotifyStrategy 接口

```java
public interface NotifyStrategy {
  void sendMarkdown(String title, String content);
  void sendAuditNotify(String title, String content, String auditUrl);
  void sendTestMessage();
  String getPlatformName();
}
```

#### NotifyService 核心方法

- `void notifyPendingAudit(Ticket ticket, String auditToken)` — 发送审核通知（含审核链接）
  - 构造审核链接：`{auditBaseUrl}/audit/{token}`
  - 获取当前平台 Strategy
  - 调用 `sendAuditNotify(title, content, auditUrl)`
  - 异步执行（`@Async`）

- `void notifyAuditPass(Ticket ticket)` — 审核通过通知
  - 通知内容：工单号、主题、审核通过
  - 异步执行

- `void notifyAuditReject(Ticket ticket, String remark)` — 审核驳回通知
  - 通知内容：工单号、主题、驳回原因
  - 异步执行

- `void notifyReplyPushed(Ticket ticket)` — 回复已推送通知
  - 通知内容：工单号、主题、推送时间
  - 异步执行

- `void sendTestMessage()` — 测试当前平台
  - 获取当前平台 Strategy
  - 调用 `sendTestMessage()`
  - 用于验证通知配置是否正确

#### WeChatWorkNotifyStrategy 实现

企业微信群机器人通知。

**Webhook URL**:
```
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<unique_key>
```

**消息格式**: Markdown（包含工单号、主题、链接等）

**示例**:
```markdown
## 工单待审核通知
- **工单号**: fd-12345
- **主题**: 用户无法登录
- **翻译**: 已完成
- **回复**: 已生成

[点击审核](https://fd.example.com/audit/token_abc123)
```

#### DingTalkNotifyStrategy 实现

钉钉 ActionCard 通知（支持审核按钮）。

**Webhook URL**:
```
https://oapi.dingtalk.com/robot/send?access_token=<token>
```

**消息格式**: ActionCard（可包含交互按钮）

**示例**:
```json
{
  "msgtype": "actionCard",
  "actionCard": {
    "title": "工单待审核",
    "text": "工单号: fd-12345\n主题: 用户无法登录",
    "btns": [
      {
        "title": "去审核",
        "actionURL": "https://fd.example.com/audit/token_abc123"
      }
    ]
  }
}
```

---

### WeChatWorkNotifyService (遗留实现)

**注意**: 此 Service 已被 NotifyService + WeChatWorkNotifyStrategy 替代。为保证向后兼容性，保留但内部调用 NotifyService。

#### 核心方法 (委托给 NotifyService)

```java
@Async
public void notifyAuditPass(Ticket ticket, String auditorName) {
  notifyService.notifyAuditPass(ticket);
}

@Async
public void notifyAuditReject(Ticket ticket, TicketAudit audit, String auditorName) {
  notifyService.notifyAuditReject(ticket, audit.getAuditRemark());
}

@Async
public void notifyReplyPushComplete(Ticket ticket, LocalDateTime time) {
  notifyService.notifyReplyPushed(ticket);
}
```

---

## 定时任务

### SyncScheduler - Freshdesk 增量同步

```java
@Scheduled(cron = "${app.freshdesk.sync-cron:0 * * * * ?}")
public void syncFreshdesk() { ... }
```

- **频率**: 默认每分钟（可通过 `SyncConfig.freshdesk_sync_cron` 配置）
- **实现**: 调用 `FreshdeskSyncService.syncTicketsWithLock()`
- **幂等性**: 使用分布式锁防重复执行
- **启用开关**: `SyncConfig.freshdesk_sync_enabled` 控制

---

### ReplyPushRetryScheduler - 失败推送重试

```java
@Scheduled(fixedDelay = 120000)  // 每 2 分钟
public void retryFailedPushes() { ... }
```

- **频率**: 每 2 分钟执行一次
- **逻辑**: 查询 `FailedReplyPush` 表中 `nextRetryAt <= now()` 的记录，逐个重试
- **重试策略**: 指数退避（5min → 10 → 20 → 40 → 80min，最多 5 次）
- **清理**: 成功推送后删除 FailedReplyPush 记录

---

## 权限定义

ticket 模块通过 `TicketPermissionDefinition` 定义权限。

### 权限列表

| 权限 Code | 权限名 | 允许角色 | 功能 |
|----------|-------|--------|------|
| `ticket:read` | 查看工单 | USER, AUDITOR | 查询工单列表、工单详情 |
| `ticket:translate` | 提交翻译 | USER | 上报翻译结果、手动触发翻译 |
| `ticket:reply` | 提交回复 | USER | 上报回复内容、手动触发回复 |
| `ticket:audit` | 审核工单 | AUDITOR | 提交审核结果 |
| `ticket:push` | 推送回复 | AUDITOR | 手动推送、批量推送 |
| `ticket:manage` | 管理工单 | ADMIN | 标记有效性、跳过回复 |
| `sync:read` | 查看同步配置 | ADMIN | 查看同步状态、同步日志 |
| `sync:manage` | 管理同步 | ADMIN | 手动触发同步、修改同步配置 |
| `system:config:read` | 读系统配置 | ADMIN | 查看系统配置 |
| `system:config:manage` | 写系统配置 | ADMIN | 修改系统配置 |
| `database:read` | 查看表结构 | ADMIN | 获取表元数据 |
| `database:execute` | 执行 SQL | ADMIN | 执行只读 SQL 查询 |
| `knowledge:read` | 查看知识库 | ADMIN | 查看注意事项 |
| `knowledge:manage` | 管理知识库 | ADMIN | CRUD 注意事项、批量标记、导出 |

### 审核令牌相关

审核令牌（AuditToken）实现了移动审核的无登录访问能力。以下权限控制令牌生成：

| 权限 Code | 权限名 | 允许角色 | 功能 |
|----------|-------|--------|------|
| `ticket:audit` | 审核工单 | AUDITOR | 生成审核令牌（GET /tickets/{id}/audit-token） |

**无权限端点** (无需 JWT):
- `GET /api/v1/audit-token/{token}` — 任何人可通过有效 Token 获取审核详情
- `POST /api/v1/audit-token/{token}/submit` — 任何人可通过有效 Token 提交审核结果

---

## 外部集成

### Freshdesk API 集成

ticket 模块通过 REST 调用 Freshdesk API 实现同步和推送。

**依赖配置** (`application.yml`):
```yaml
app:
  freshdesk:
    domain: xxxxx.freshdesk.com
    api-key: ${FRESHDESK_API_KEY}
    sync-cron: "0 * * * * ?"
    sync-enabled: true
```

**集成点**:
1. **同步**: GET `/api/v2/tickets?updated_since=<timestamp>` — 增量同步
2. **推送**: POST `/api/v2/tickets/{id}/reply` — 推送回复
3. **Webhook**: POST `/webhook/freshdesk` — 接收实时事件

---

### 企业微信通知集成

通过企业微信群机器人 Webhook 实现异步通知。

**Webhook URL 格式**:
```
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<unique_key>
```

**通知类型**:
1. **审核通过**: 通知管理员和提交者
2. **审核驳回**: 通知管理员和提交者（包含驳回意见）
3. **推送完成**: 通知管理员（推送成功/失败统计）

**实现**: `WeChatWorkNotifyService` 异步发送 Markdown 格式消息

---

## 数据库设计

### 索引策略

```sql
-- Ticket 表索引
CREATE INDEX idx_ticket_status ON ticket(status);
CREATE INDEX idx_ticket_external_id ON ticket(external_id);
CREATE INDEX idx_ticket_created_at ON ticket(created_at DESC);
CREATE INDEX idx_ticket_is_valid ON ticket(is_valid);
CREATE INDEX idx_ticket_status_created_at ON ticket(status, created_at DESC);
CREATE INDEX idx_ticket_status_updated_at ON ticket(status, updated_at DESC);
CREATE UNIQUE INDEX uq_ticket_external_id ON ticket(external_id);

-- TicketTranslation 表索引
CREATE INDEX idx_translation_ticket_id ON ticket_translation(ticket_id, created_at DESC);

-- TicketReply 表索引
CREATE INDEX idx_reply_ticket_id ON ticket_reply(ticket_id, created_at DESC);

-- TicketAudit 表索引
CREATE INDEX idx_audit_ticket_id ON ticket_audit(ticket_id, created_at DESC);

-- SystemConfig 表索引
CREATE UNIQUE INDEX uq_config_key ON system_config(config_key);

-- SyncLog 表索引
CREATE INDEX idx_synclog_status ON sync_log(status);
CREATE INDEX idx_synclog_start_time ON sync_log(start_time DESC);

-- FailedReplyPush 表索引
CREATE INDEX idx_failed_push_retry_at ON failed_reply_push(next_retry_at);
CREATE INDEX idx_failed_push_ticket_id ON failed_reply_push(ticket_id);
```

---

## Maven 多模块现状

当前 fd-server 已采用 Maven 多模块化，ticket 模块已是独立子模块。

### 当前 Artifact 坐标

```xml
<groupId>com.jefflower</groupId>
<artifactId>fd-server-ticket</artifactId>
<version>${project.version}</version>
<packaging>jar</packaging>
```

### 当前依赖声明

**ticket 模块继承 fd-server 的 parent pom**:

```xml
<parent>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server</artifactId>
    <version>${project.version}</version>
    <relativePath>../pom.xml</relativePath>
</parent>

<dependencies>
  <!-- 内部依赖 -->
  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-task</artifactId>
    <version>${project.version}</version>
  </dependency>
  <!-- 注意: fd-server-auth 和 fd-server-common 通过 fd-server-task 的传递依赖自动获得 -->

  <!-- ticket 特有依赖：AMQP (RabbitMQ) -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
  </dependency>

  <!-- 测试 -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

**早期 pom.xml 格式参考**（单独使用时）:

```xml
<dependencies>
  <!-- 公共模块 -->
  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-common</artifactId>
    <version>1.0.0</version>
  </dependency>

  <!-- 认证模块 -->
  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-auth</artifactId>
    <version>1.0.0</version>
  </dependency>

  <!-- 任务模块 -->
  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-task</artifactId>
    <version>1.0.0</version>
  </dependency>

  <!-- Spring Boot -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-scheduling</artifactId>
  </dependency>

  <!-- 测试 -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

### 包结构

```
com/jefflower/fdserver/ticket/
├── controller/        # REST API 层
├── service/          # 业务逻辑层
├── entity/           # JPA Entity
├── repository/       # 数据访问层
├── dto/              # 数据传输对象
├── enums/            # 枚举定义
├── config/           # 配置类（RabbitMQ、权限定义）
├── scheduler/        # 定时任务
└── TicketModule.java # 模块标记类
```

---

## 常见问题

### Q: 审核驳回后，AI 如何知道驳回意见？

**A**: 审核驳回时，`lastAuditRemark` 保存到 Ticket 记录。MQ 回复任务 payload 包含此字段。fd-client 生成回复 Prompt 时，自动追加驳回意见作为约束条件：

```
Please generate a reply considering the following feedback from the previous auditor:
{lastAuditRemark}
```

---

### Q: 如何区分"自动推送"和"待推送"状态？

**A**:
- 审核通过时，检查 `SystemConfig.auto_reply_enabled`：
  - ON: 状态 → COMPLETED（自动推送）
  - OFF: 状态 → APPROVED（待推送）
- 前端仅在 APPROVED 状态展示工单，供管理员手动推送

---

### Q: 推送失败如何处理？

**A**: 推送失败自动创建 FailedReplyPush 记录，`ReplyPushRetryScheduler` 每 2 分钟检查并重试。重试时间间隔：5min → 10min → 20min → 40min → 80min（最多 5 次）。超过 5 次失败后停止重试，管理员可手动重新推送。

---

### Q: 工单同步如何处理重复？

**A**: 通过内容哈希（SHA-256）去重。同一工单内容未变化时，跳过更新。哈希值存储在 `Ticket.contentHash` 字段。

---

### Q: Webhook 和定时轮询冲突时如何处理？

**A**:
- Webhook 优先（实时）
- 定时轮询作为补偿机制（容错）
- Webhook 失败时，定时轮询会重新同步（通过回溯时间）
- 重复工单通过哈希去重，无需担心重复创建

---

### Q: 什么是审核令牌（AuditToken）？

**A**: 审核令牌是一次性的、无须登录的审核凭证。用于支持移动设备上的审核场景：
- 工单进入 PENDING_AUDIT 状态时，自动生成审核令牌
- 系统发送包含审核链接的通知（企业微信/钉钉）
- 审核人可在移动设备上点击链接，无需输入用户名密码
- 令牌有效期 24h（可配置），一次性使用（防重复审核）

---

### Q: 审核令牌如何生成和分发？

**A**:
1. **生成时机**: 工单状态转换到 PENDING_AUDIT 时自动调用 `auditTokenService.generateToken(ticketId)`
2. **Token 格式**: Base64URL 编码的随机数（256bit 熵），43 字符，全局唯一
3. **分发方式**: 通过 NotifyService 发送通知（企业微信/钉钉），包含审核链接
4. **审核链接**: `{auditBaseUrl}/audit/{token}`，点击即可进行无登录审核
5. **TOKEN 复用**: 同一工单的 ACTIVE Token 不会重复生成，优先复用原 Token

---

### Q: 如何防止审核令牌被滥用或重复使用？

**A**:
- **一次性使用**: Token 提交审核后立即标记为 USED，后续请求将被拒绝（409 状态码）
- **悲观锁保护**: 使用数据库 `SELECT ... FOR UPDATE` 确保并发提交时只有一个请求成功
- **过期自动清理**: Token 过期后（默认 24h）无法使用，过期 Token 不可恢复
- **工单状态同步**: 工单状态变化时自动撤销所有 ACTIVE Token，防止状态不一致导致的重复审核
- **Token 格式**: 使用 SecureRandom 生成，攻击者无法猜测或伪造有效 Token

---

### Q: 通知平台如何选择和配置？

**A**:
1. **平台选择**: 通过 SystemConfig.notify_platform 指定（`wecom` / `dingtalk` / `none`）
2. **Webhook 配置**:
   - 企业微信: `wecom_webhook_url` + `wecom_notify_enabled`
   - 钉钉: `dingtalk_webhook_url` + `dingtalk_notify_enabled`
3. **测试通知**: 调用 `POST /config/notify-channel/test` 验证配置是否正确
4. **通知内容**: 根据 Strategy 实现自动适配（Markdown for WeChat, ActionCard for DingTalk）
5. **异步发送**: 所有通知使用 `@Async` 异步执行，不阻塞主流程

---

### Q: 如何在前端生成和显示审核链接？

**A**:
1. **获取令牌**: 调用 `GET /api/v1/tickets/{id}/audit-token`（需要 `ticket:audit` 权限）
2. **响应包含**:
   - `token`: 令牌字符串
   - `expireAt`: 过期时间
   - `auditUrl`: 完整审核链接（自动拼接 `auditBaseUrl` + `/audit/{token}`）
3. **显示方式**:
   - 桌面端可显示 QR 码或链接，供管理员扫描/分享
   - 或直接通过通知发送，管理员点击通知内的链接即可跳转

---

## 相关文档

- [API Reference](../api-reference.md) — 完整 API 参考
- [Server Architecture](../server-architecture.md) — 服务器整体架构
- [System Design](../system-design.md) — 工单状态机详细设计
- [Project Structure](../project-structure.md) — 项目结构地图
