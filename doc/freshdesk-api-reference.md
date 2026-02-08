# Freshdesk API v2 参考文档

> 官方文档: https://developers.freshdesk.com/api/
> 本文档整理自官方 API 文档，供 FD-AutoPilot 项目开发参考。

## 认证

所有 API 使用 **Basic Auth**：

```bash
curl -v -u YOUR_API_KEY:X -H "Content-Type: application/json" \
  https://YOUR_DOMAIN.freshdesk.com/api/v2/tickets
```

- API Key 在 Freshdesk 个人设置中获取（Profile Settings → API Key）
- 密码固定为 `X`

## 速率限制

| 计划 | 限制 |
|------|------|
| Trial | 50 次/分钟 |
| 付费计划 | 根据计划不同，通常更高 |

**响应头**：
- `X-RateLimit-Total` — 总限额
- `X-RateLimit-Remaining` — 剩余次数
- `X-RateLimit-Used-CurrentRequest` — 当前请求消耗
- HTTP 429 — 超限，需等待后重试
- `Retry-After` — 429 响应中的等待秒数

**最佳实践**：
- 监控 `X-RateLimit-Remaining`，低于阈值时主动休眠
- 使用 Webhook 替代高频轮询
- 缓存不常变化的数据（agent、字段等）

## 通用规则

- 所有时间戳为 UTC 格式：`YYYY-MM-DDTHH:MM:SSZ`
- 空字段返回 `null`（不省略）
- JSON 格式交互
- `include` 参数每项消耗 +2 API credits

---

## Tickets API

### 列出所有工单

```
GET /api/v2/tickets
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `per_page` | int | 每页数量，最大 100 |
| `page` | int | 页码 |
| `order_by` | string | 排序字段：`created_at`（默认）、`due_by`、`updated_at`、`status` |
| `order_type` | string | `asc`（默认）或 `desc` |
| `updated_since` | datetime | 增量查询：仅返回该时间之后更新的工单 |
| `include` | string | 嵌入额外数据：`description`、`stats`、`requester`、`company` |

**重要限制**：
- 默认只返回最近 **30 天**创建的工单，使用 `updated_since` 可获取更早的
- 最大 **300 页**（30,000 条工单）
- 2018-11-30 之后创建的账户必须用 `include=description` 才能获取 description 字段

**分页**：通过响应头 `Link` 实现

```
Link: <https://domain.freshdesk.com/api/v2/tickets?per_page=100&page=2>; rel="next"
```

遍历方式：检查 `Link` header 是否存在 `rel="next"`，如有则继续请求，直到无 `Link` header。

### 获取单个工单

```
GET /api/v2/tickets/{id}
```

**查询参数**：
- `include`: `conversations`、`requester`、`company`、`stats`

### 工单对象字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | long | 工单 ID |
| `subject` | string | 主题 |
| `description` | string | HTML 描述 |
| `description_text` | string | 纯文本描述 |
| `status` | int | 状态（见下） |
| `priority` | int | 优先级（见下） |
| `source` | int | 来源渠道（见下） |
| `type` | string | 工单类型（如 "Question", "Incident"） |
| `requester_id` | long | 请求者 ID |
| `responder_id` | long | 处理者（Agent）ID |
| `group_id` | long | 组 ID |
| `company_id` | long | 公司 ID |
| `product_id` | long | 产品 ID |
| `email_config_id` | long | 邮件配置 ID |
| `tags` | string[] | 标签数组 |
| `cc_emails` | string[] | 抄送邮箱 |
| `fwd_emails` | string[] | 转发邮箱 |
| `reply_cc_emails` | string[] | 回复抄送 |
| `to_emails` | string[] | 收件人 |
| `due_by` | datetime | 截止时间 |
| `fr_due_by` | datetime | 首次响应截止 |
| `is_escalated` | boolean | 是否已升级 |
| `fr_escalated` | boolean | 首次响应是否已升级 |
| `spam` | boolean | 是否为垃圾 |
| `custom_fields` | object | 自定义字段 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |
| `attachments` | array | 附件列表 |

### Status 状态码

| 值 | 状态 | 说明 |
|----|------|------|
| 2 | Open | 新工单默认状态，客户回复时自动回到 Open |
| 3 | Pending | 等待中（agent 需要更多信息） |
| 4 | Resolved | 已解决 |
| 5 | Closed | 已关闭 |

### Priority 优先级

| 值 | 优先级 |
|----|--------|
| 1 | Low |
| 2 | Medium |
| 3 | High |
| 4 | Urgent |

### Source 来源

| 值 | 来源 |
|----|------|
| 1 | Email |
| 2 | Portal |
| 3 | Phone |
| 7 | Chat |
| 8 | Mobihelp |
| 9 | Feedback Widget |
| 10 | Outbound Email |

### 创建工单

```
POST /api/v2/tickets
Content-Type: application/json

{
  "email": "customer@example.com",
  "subject": "工单标题",
  "description": "工单描述（HTML）",
  "priority": 1,
  "status": 2
}
```

### 更新工单

```
PUT /api/v2/tickets/{id}
Content-Type: application/json

{
  "priority": 3,
  "status": 3
}
```

仅需包含要更新的字段。

---

## Conversations API

### 列出工单对话

```
GET /api/v2/tickets/{id}/conversations
```

**分页**：同样通过 `Link` header，支持 `per_page` 参数。

### 对话对象字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | long | 对话 ID |
| `body` | string | HTML 内容 |
| `body_text` | string | 纯文本内容 |
| `incoming` | boolean | true=客户发的，false=agent 发的 |
| `private` | boolean | 是否为私有笔记 |
| `user_id` | long | 发送者 ID |
| `support_email` | string | 支持邮箱 |
| `source` | int | 来源 |
| `to_emails` | string[] | 收件人 |
| `cc_emails` | string[] | 抄送 |
| `bcc_emails` | string[] | 密送 |
| `attachments` | array | 附件 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

### 回复工单

```
POST /api/v2/tickets/{id}/reply
Content-Type: application/json

{
  "body": "<p>回复内容（HTML）</p>"
}
```

可选字段：`cc_emails`, `bcc_emails`, `attachments`

### 添加笔记

```
POST /api/v2/tickets/{id}/notes
Content-Type: application/json

{
  "body": "内部笔记内容",
  "private": true
}
```

---

## 搜索 API

### 搜索工单

```
GET /api/v2/search/tickets?query="status:2 AND priority:3"
```

**限制**：
- 每页固定 30 条，`per_page` 不可用
- 最多 10 页（300 条结果）
- `Link` header 不返回（已知问题）
- 不支持搜索 description/conversation 内容
- query 必须 URL 编码
- 最长 512 字符

**可搜索字段**：`agent_id`, `group_id`, `priority`, `status`, `tag`, `type`, `due_by`, `fr_due_by`, `created_at`, `updated_at` 及自定义字段。

**运算符**：
- 逻辑：`AND`, `OR`, 括号 `()`
- 关系：`:>` (>=), `:<` (<=)

**对比 List Tickets API**：

| 特性 | `/api/v2/tickets` | `/api/v2/search/tickets` |
|------|-------------------|--------------------------|
| 最大结果 | 30,000（300页） | 300（10页） |
| `per_page` | 支持（最大100） | 不支持（固定30） |
| `Link` header | 支持 | 不支持 |
| `updated_since` | 支持 | 用 query 中的 `updated_at` |
| 复杂查询 | 不支持 | 支持 AND/OR |

**结论**：大规模同步用 `/api/v2/tickets` + `updated_since`，复杂条件查询用 Search API。

---

## Webhook 自动化

Freshdesk 支持通过 **Automation Rules** 发送 Webhook：

### 配置路径

Admin > Automations > 选择规则类型：
- **Ticket Creation** — 工单创建时触发
- **Ticket Updates** — 工单更新时触发（状态变更、收到回复等）

### Webhook 配置

1. 创建新规则 → 设置条件
2. 动作选择 **Trigger Webhook**
3. 配置：
   - **Method**: POST
   - **URL**: `https://your-server.com/api/v1/webhook/freshdesk`
   - **Encoding**: JSON
   - **Content**: 自定义 JSON，支持占位符
   - **Custom Headers**: 可添加验签 header
   - **Authentication**: 可配置 Basic Auth

### 可用占位符

| 占位符 | 说明 |
|--------|------|
| `{{ticket.id}}` | 工单 ID |
| `{{ticket.subject}}` | 主题 |
| `{{ticket.status}}` | 状态 |
| `{{ticket.priority}}` | 优先级 |
| `{{ticket.requester.name}}` | 请求者姓名 |
| `{{ticket.requester.email}}` | 请求者邮箱 |
| `{{ticket.group.name}}` | 组名 |
| `{{ticket.agent.name}}` | Agent 名 |

### 推荐配置示例

**Ticket Creation Rule**:
```json
{
  "ticket_id": "{{ticket.id}}",
  "event": "ticket_created"
}
```

**Ticket Update Rule**:
```json
{
  "ticket_id": "{{ticket.id}}",
  "event": "ticket_updated"
}
```

### 限制

- 每小时最多 **1000 次** webhook 调用
- 失败自动重试：每 30 分钟一次，最多 48 次
- Webhook 异步执行，不能用响应数据做后续自动化
- 使用 Agent API，计为 agent 操作

---

## 其他常用 API

### Contacts（联系人）

```
GET /api/v2/contacts/{id}           # 获取联系人
GET /api/v2/contacts                # 列出联系人
POST /api/v2/contacts               # 创建联系人
PUT /api/v2/contacts/{id}           # 更新联系人
```

### Agents

```
GET /api/v2/agents/{id}             # 获取 Agent
GET /api/v2/agents                  # 列出 Agents
```

### Groups

```
GET /api/v2/groups/{id}             # 获取组
GET /api/v2/groups                  # 列出组
```

### Ticket Fields

```
GET /api/v2/ticket_fields           # 获取所有工单字段定义
```

---

## API Credits

不同操作消耗不同 credits：

| 操作 | Credits |
|------|---------|
| List Tickets | 1 per page |
| List Tickets + include | 1 + 2 per include |
| Get Ticket | 1 |
| Get Ticket + include | 1 + 2 per include |
| Create/Update Ticket | 1 |
| Conversations | 1 |
| Search | 1 per page |

---

*文档版本: 2025-01 | 基于 Freshdesk API v2*
*官方文档: https://developers.freshdesk.com/api/*
