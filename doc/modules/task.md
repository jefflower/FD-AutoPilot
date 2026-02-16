# Task Module (FD-Server)

`task` 是多客户端任务分发模块，负责原子领取、超时回收、定时调度，为 fd-client 客户端提供统一的任务获取和报告接口，同时为 ticket 模块提供任务创建和检查接口。

## 模块概览

### 职责边界

task 模块专注于**任务生命周期管理**和**分布式调度**，被设计为未来微服务化的独立服务。

| 职责 | 说明 |
|------|------|
| **定义管理** | 创建、启用/禁用任务定义（任务类型、执行模式、超时配置） |
| **分布式领取** | 原子性 claim API，多客户端竞争式领取任务，确保不重复 |
| **执行追踪** | 任务状态流转（PENDING → CLAIMED → COMPLETED/FAILED/TIMEOUT） |
| **超时回收** | 周期扫描超期 CLAIMED 任务，自动重置或标记超时 |
| **定时调度** | SERVER_SCHEDULED 模式，基于 Cron 表达式定时执行（含 TaskHandler 接口） |
| **管理 Dashboard** | 统计各任务类型的状态分布、执行历史、性能指标 |

### 执行模式

```
┌────────────────────────────────────────────────────┐
│ 三种执行模式                                         │
├────────────────────────────────────────────────────┤
│                                                    │
│  CLIENT_DISTRIBUTED                               │
│  ├─ 工单翻译 (ticket.translate)                   │
│  ├─ 工单回复 (ticket.reply)                       │
│  └─ 工单审核 (ticket.audit)                       │
│     任务创建后进入 PENDING 队列，                   │
│     fd-client 主动领取（claim API）并执行，        │
│     完成后上报结果（complete API）                 │
│                                                    │
│  SERVER_SCHEDULED                                  │
│  └─ 基于 Cron 定期执行的后端任务                  │
│     Spring TaskScheduler 驱动，无需客户端参与      │
│                                                    │
│  SERVER_TRIGGERED                                  │
│  └─ 手动或事件触发的后端任务                      │
│     管理员通过 trigger API 或系统事件触发          │
│                                                    │
└────────────────────────────────────────────────────┘
```

## 数据模型

### TaskDefinition（任务定义表）

```sql
CREATE TABLE task_definition (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) UNIQUE NOT NULL,        -- 任务类型代码（如 "ticket.translate"）
  name VARCHAR(128) NOT NULL,              -- 任务名称（如 "工单翻译"）
  description VARCHAR(256),                -- 描述
  execution_mode VARCHAR(32) NOT NULL,     -- CLIENT_DISTRIBUTED | SERVER_SCHEDULED | SERVER_TRIGGERED
  cron_expression VARCHAR(64),             -- Cron 表达式（SERVER_SCHEDULED 用）
  timeout_seconds INT DEFAULT 300,         -- 超时秒数（客户端任务）
  max_retries INT DEFAULT 3,               -- 最大重试次数
  max_concurrency INT DEFAULT 5,           -- 最大并发数
  enabled BOOLEAN DEFAULT TRUE,            -- 是否启用
  handler_name VARCHAR(64),                -- Spring Bean 名（SERVER_* 用）
  config CLOB,                             -- JSON 配置（扩展字段）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_task_def_code ON task_definition(code);
```

**ExecutionMode 枚举**:
- `CLIENT_DISTRIBUTED` — fd-client 并发领取执行，有 timeout 和重试机制
- `SERVER_SCHEDULED` — Spring TaskScheduler 基于 Cron 定期执行，调用 `handlerName` 对应的 TaskHandler Bean
- `SERVER_TRIGGERED` — 手动触发或事件驱动，立即调用 handler 执行

### TaskInstance（任务实例表）

```sql
CREATE TABLE task_instance (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_type VARCHAR(64) NOT NULL,          -- 任务类型代码（外键关联 task_definition.code）
  reference_type VARCHAR(64),              -- 业务引用类型（如 "ticket"）
  reference_id VARCHAR(64),                -- 业务引用 ID（如工单 ID）
  status VARCHAR(32) NOT NULL,             -- PENDING | CLAIMED | COMPLETED | FAILED | TIMEOUT | CANCELLED
  trigger_type VARCHAR(32) NOT NULL,       -- EVENT | SCHEDULED | MANUAL
  assigned_to VARCHAR(64),                 -- 领取者 ID（fd-client 的 clientId）
  assigned_at TIMESTAMP,                   -- 领取时间
  payload CLOB,                            -- 任务数据（JSON）
  result CLOB,                             -- 执行结果（JSON）
  error_message CLOB,                      -- 错误信息
  retry_count INT DEFAULT 0,               -- 当前重试次数
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_task_inst_type_status ON task_instance(task_type, status);
CREATE INDEX idx_task_inst_assigned ON task_instance(assigned_to, status);
CREATE INDEX idx_task_inst_ref ON task_instance(reference_type, reference_id);
CREATE INDEX idx_task_inst_created ON task_instance(created_at);
```

**TaskStatus 枚举**:
- `PENDING` — 等待领取
- `CLAIMED` — 已被客户端领取，执行中
- `COMPLETED` — 执行成功
- `FAILED` — 执行失败（不再重试）
- `TIMEOUT` — 超时未完成（已达最大重试）
- `CANCELLED` — 被取消

**TriggerType 枚举**:
- `EVENT` — 事件触发（如工单提交）
- `SCHEDULED` — 定时触发（Cron）
- `MANUAL` — 手动触发（管理员操作）

## API 规范

### 客户端 API — TaskController

**路由前缀**: `/api/v1/tasks`

所有客户端 API 均需 `Authorization: Bearer <token>` 和权限 `task:claim`（或更高权限）。

#### 1. 领取任务（原子操作）

```http
POST /api/v1/tasks/claim?type=ticket.translate&clientId=client-001&limit=5
Content-Type: application/json

# 无请求体

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1001,
      "taskType": "ticket.translate",
      "referenceType": "ticket",
      "referenceId": "FD-12345",
      "status": "CLAIMED",
      "triggerType": "EVENT",
      "assignedTo": "client-001",
      "assignedAt": "2026-02-16T10:30:00",
      "payload": {
        "ticketId": "FD-12345",
        "content": "Hello world",
        "sourceLanguage": "en",
        "targetLanguage": "zh"
      },
      "result": null,
      "errorMessage": null,
      "retryCount": 0,
      "createdAt": "2026-02-16T10:25:00",
      "updatedAt": "2026-02-16T10:30:00"
    }
  ]
}
```

**说明**:
- 查询参数 `type` 和 `clientId` 必需，`limit` 默认 5
- 先返回该客户端已有的 CLAIMED 任务
- 再从 PENDING 队列原子性领取最多 `limit` 个新任务，受 TaskDefinition.maxConcurrency 限制
- 数据库层面使用排它锁确保不重复分配
- 权限: `task:claim`

**原子性保证**:
```java
// 伪代码逻辑
@Transactional
public List<TaskInstance> claimTasks(String taskType, String clientId, int limit) {
  // 1. 查询已有的 CLAIMED 任务
  List<TaskInstance> myClaimed = findByTaskTypeAndAssignedToAndStatus(
    taskType, clientId, CLAIMED);

  // 2. 获取并发限制
  TaskDefinition def = getDefinition(taskType);
  int remaining = def.maxConcurrency - myClaimed.size();
  if (remaining <= 0) return myClaimed;

  // 3. 使用 FOR UPDATE 锁定 PENDING 任务，原子性领取
  int toTake = Math.min(remaining, limit);
  List<TaskInstance> pending = findPendingForUpdate(taskType, toTake);
  pending.forEach(t -> t.assignedTo(clientId).status(CLAIMED));

  return concat(myClaimed, pending);
}
```

#### 2. 完成任务

```http
POST /api/v1/tasks/{id}/complete
Content-Type: application/json
Authorization: Bearer <token>

{
  "clientId": "client-001",
  "success": true,
  "message": "翻译完成：Hello -> 你好"
}

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1001,
    "status": "COMPLETED",
    "result": {
      "translatedContent": "你好"
    },
    "updatedAt": "2026-02-16T10:35:00"
  }
}
```

**说明**:
- `clientId` 必须与 task.assignedTo 一致（权限检查）
- `success=true` → status = COMPLETED，result 取 message 的内容
- `success=false` → status = FAILED，retryCount < maxRetries 则在下次 claim 时重新获取
- 权限: `task:claim`

#### 3. 释放任务

```http
POST /api/v1/tasks/{id}/release?clientId=client-001
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1001,
    "status": "PENDING",
    "assignedTo": null,
    "updatedAt": "2026-02-16T10:36:00"
  }
}
```

**说明**:
- CLAIMED → PENDING，重置 assignedTo 和 assignedAt
- 权限: `task:claim`

#### 4. 我的任务列表

```http
GET /api/v1/tasks/mine?clientId=client-001&status=CLAIMED
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1001,
      "taskType": "ticket.translate",
      "status": "CLAIMED",
      "assignedTo": "client-001",
      "assignedAt": "2026-02-16T10:30:00",
      "payload": { ... },
      "createdAt": "2026-02-16T10:25:00"
    },
    {
      "id": 1002,
      "taskType": "ticket.reply",
      "status": "CLAIMED",
      "assignedTo": "client-001",
      "assignedAt": "2026-02-16T10:31:00",
      "payload": { ... },
      "createdAt": "2026-02-16T10:26:00"
    }
  ]
}
```

**说明**:
- 查询参数 `status` 可选，默认仅返回 PENDING + CLAIMED
- 权限: `task:claim`

### 管理 API — TaskAdminController

**路由前缀**: `/api/v1/task-admin`

所有管理 API 需权限 `task:manage` 或 `task:read`。

#### 1. Dashboard — 任务统计

```http
GET /api/v1/task-admin/dashboard
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "ticket.translate": {
      "PENDING": 12,
      "CLAIMED": 3,
      "COMPLETED": 1024,
      "FAILED": 5,
      "TIMEOUT": 2,
      "CANCELLED": 0
    },
    "ticket.reply": {
      "PENDING": 5,
      "CLAIMED": 1,
      "COMPLETED": 512,
      "FAILED": 3,
      "TIMEOUT": 1,
      "CANCELLED": 0
    },
    "ticket.audit": {
      "PENDING": 2,
      "CLAIMED": 0,
      "COMPLETED": 256,
      "FAILED": 0,
      "TIMEOUT": 0,
      "CANCELLED": 0
    }
  }
}
```

**说明**:
- 权限: `task:read`
- 返回各任务类型的状态计数
- 可用于实时监控任务队列健康度

#### 2. 任务定义列表

```http
GET /api/v1/task-admin/definitions
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "code": "ticket.translate",
      "name": "工单翻译",
      "description": "将工单内容翻译为目标语言",
      "executionMode": "CLIENT_DISTRIBUTED",
      "cronExpression": null,
      "timeoutSeconds": 300,
      "maxRetries": 3,
      "maxConcurrency": 5,
      "enabled": true,
      "handlerName": null,
      "config": null,
      "createdAt": "2026-02-01T00:00:00",
      "updatedAt": "2026-02-01T00:00:00"
    },
    {
      "id": 2,
      "code": "ticket.reply",
      "name": "工单回复",
      "description": "生成工单的 AI 回复",
      "executionMode": "CLIENT_DISTRIBUTED",
      "cronExpression": null,
      "timeoutSeconds": 600,
      "maxRetries": 3,
      "maxConcurrency": 1,
      "enabled": true,
      "handlerName": null,
      "config": null,
      "createdAt": "2026-02-01T00:00:00",
      "updatedAt": "2026-02-01T00:00:00"
    }
  ]
}
```

**说明**:
- 权限: `task:read`
- 返回所有任务定义（已启用和禁用）

#### 3. 创建任务定义

```http
POST /api/v1/task-admin/definitions
Content-Type: application/json
Authorization: Bearer <token>

{
  "code": "custom.batch-export",
  "name": "批量导出",
  "description": "导出工单数据为 CSV",
  "executionMode": "SERVER_SCHEDULED",
  "cronExpression": "0 2 * * *",
  "timeoutSeconds": 3600,
  "maxRetries": 1,
  "maxConcurrency": 1,
  "enabled": true,
  "handlerName": "customBatchExportHandler",
  "config": {
    "format": "csv",
    "includeAttachments": false
  }
}

# 响应 201 Created
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 10,
    "code": "custom.batch-export",
    ...
  }
}
```

**说明**:
- 权限: `task:manage`
- 创建新的任务定义
- 若 executionMode 为 SERVER_*，handlerName 必填，对应的 Spring Bean 必须存在

#### 4. 启用/禁用任务定义

```http
PUT /api/v1/task-admin/definitions/{id}/toggle
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "code": "ticket.translate",
    "enabled": false,
    "updatedAt": "2026-02-16T11:00:00"
  }
}
```

**说明**:
- 权限: `task:manage`
- 禁用后，不再创建新的 PENDING 实例，也不再恢复超期任务

#### 5. 手动触发任务

```http
POST /api/v1/task-admin/definitions/{code}/trigger
Content-Type: application/json
Authorization: Bearer <token>

{
  "payload": {
    "ticketId": "FD-99999",
    "customData": "some-value"
  }
}

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "taskType": "ticket.translate",
    "executionMode": "CLIENT_DISTRIBUTED",
    "taskId": 1234,
    "status": "PENDING",
    "message": "任务已创建，等待领取"
  }
}
```

**说明**:
- 权限: `task:manage`（部分任务可能降级到 `task:trigger`）
- 对于 CLIENT_DISTRIBUTED：创建 PENDING 实例，等待 fd-client 领取
- 对于 SERVER_SCHEDULED/TRIGGERED：立即调用对应 handler，返回执行结果

#### 6. 执行历史（分页）

```http
GET /api/v1/task-admin/history?type=ticket.translate&page=0&size=20&status=COMPLETED
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "content": [
      {
        "id": 1001,
        "taskType": "ticket.translate",
        "referenceType": "ticket",
        "referenceId": "FD-12345",
        "status": "COMPLETED",
        "triggerType": "EVENT",
        "assignedTo": "client-001",
        "assignedAt": "2026-02-16T10:30:00",
        "payload": { ... },
        "result": { "translatedContent": "你好" },
        "errorMessage": null,
        "retryCount": 0,
        "createdAt": "2026-02-16T10:25:00",
        "updatedAt": "2026-02-16T10:35:00"
      }
    ],
    "pageable": {
      "pageNumber": 0,
      "pageSize": 20,
      "totalElements": 1024,
      "totalPages": 52
    }
  }
}
```

**说明**:
- 权限: `task:read`
- 查询参数 `type`、`status`、`page`、`size` 均可选
- 默认按 createdAt 降序排列

#### 7. 清理历史

```http
DELETE /api/v1/task-admin/history/cleanup?daysOld=30
Authorization: Bearer <token>

# 响应 200 OK
{
  "code": 0,
  "message": "success",
  "data": {
    "deletedCount": 2345,
    "message": "已删除 2345 条 30 天前的历史记录"
  }
}
```

**说明**:
- 权限: `task:manage`
- 删除 30 天前的已完成/失败/超时任务
- 仅删除非 PENDING/CLAIMED 状态的任务

## 模块间 Service 接口

### TaskDistributionService

task 模块对 ticket 等业务模块的公开 Service 接口。

```java
public interface TaskDistributionService {

  /**
   * 创建或返回已有的任务实例
   *
   * @param taskType 任务类型代码（如 "ticket.translate"）
   * @param referenceType 业务引用类型（如 "ticket"）
   * @param referenceId 业务引用 ID
   * @param payload 任务数据（JSON 序列化）
   * @param triggerType 触发类型
   * @return 新创建或已有的 TaskInstance
   *
   * 幂等性：同一 taskType + referenceId 已存在 PENDING/CLAIMED 任务则返回已有任务
   */
  TaskInstance createTask(
    String taskType,
    String referenceType,
    String referenceId,
    String payload,
    TriggerType triggerType
  );

  /**
   * 多客户端竞争式领取任务（原子操作）
   *
   * @param taskType 任务类型
   * @param clientId 客户端 ID
   * @param limit 最多领取数量
   * @return 领取到的任务列表（可能为空）
   *
   * 过程：
   * 1. 先返回该 clientId 已有的 CLAIMED 任务
   * 2. 再从 PENDING 队列原子性领取最多 limit 个新任务
   * 3. 受 TaskDefinition.maxConcurrency 限制
   */
  List<TaskInstance> claimTasks(
    String taskType,
    String clientId,
    int limit
  );

  /**
   * 完成任务
   *
   * @param taskId 任务 ID
   * @param clientId 客户端 ID（权限校验）
   * @param success 是否成功
   * @param resultOrError 结果或错误信息
   *
   * success=true → COMPLETED
   * success=false → FAILED（若 retryCount < maxRetries，
   *                下次 claim 时仍可获取）
   */
  void completeTask(
    Long taskId,
    String clientId,
    boolean success,
    String resultOrError
  );

  /**
   * 通过业务引用完成任务（后端服务内部调用）
   *
   * @param taskType 任务类型
   * @param referenceId 业务引用 ID
   *
   * 使用 SQL UPDATE 原子性将 PENDING/CLAIMED 状态更新为 COMPLETED
   * 被 TicketService.submitTranslation/submitReply/submitAudit 等调用
   */
  void completeByReference(String taskType, String referenceId);

  /**
   * 释放任务（CLAIMED → PENDING）
   *
   * @param taskId 任务 ID
   * @param clientId 客户端 ID（权限校验）
   */
  void releaseTask(Long taskId, String clientId);

  /**
   * 获取客户端的任务列表
   *
   * @param clientId 客户端 ID
   * @param statuses 过滤的状态（可选）
   * @return 任务列表
   */
  List<TaskInstance> getMyTasks(String clientId, TaskStatus... statuses);

  /**
   * 获取 Dashboard 统计数据
   *
   * @return Map<taskType, Map<status, count>>
   */
  Map<String, Map<String, Long>> getDashboardStats();
}
```

### 典型调用示例

**TicketService 中的集成**:

```java
@Service
public class TicketService {

  @Autowired
  private TaskDistributionService taskDistributionService;

  /**
   * 提交翻译结果，创建后续回复任务
   */
  public void submitTranslation(Long ticketId, String translation) {
    // 1. 更新工单翻译内容
    Ticket ticket = ticketRepository.findById(ticketId).orElseThrow();
    ticket.setTranslation(translation);

    // 2. 完成翻译任务（原子性）
    taskDistributionService.completeByReference(
      "ticket.translate",
      ticketId.toString()
    );

    // 3. 创建回复任务
    taskDistributionService.createTask(
      "ticket.reply",
      "ticket",
      ticketId.toString(),
      JSON.toJSONString(Map.of(
        "ticketId", ticketId,
        "translation", translation,
        "customerName", ticket.getCustomerName()
      )),
      TriggerType.EVENT
    );

    // 4. 更新工单状态流转
    ticket.setStatus(TicketStatus.PENDING_REPLY);
    ticketRepository.save(ticket);
  }

  /**
   * 提交审核结果，判断下一步处理
   */
  public void submitAudit(Long ticketId, AuditResult result, String remark) {
    Ticket ticket = ticketRepository.findById(ticketId).orElseThrow();

    if (result == AuditResult.PASS) {
      // 通过审核 → 完成审核任务
      taskDistributionService.completeByReference(
        "ticket.audit",
        ticketId.toString()
      );
      ticket.setStatus(TicketStatus.APPROVED);
    } else {
      // 驳回 → 完成审核任务 + 重新创建回复任务
      taskDistributionService.completeByReference(
        "ticket.audit",
        ticketId.toString()
      );

      ticket.setLastAuditRemark(remark);  // 保存审核意见
      taskDistributionService.createTask(
        "ticket.reply",
        "ticket",
        ticketId.toString(),
        JSON.toJSONString(Map.of(
          "ticketId", ticketId,
          "auditRemark", remark  // 注入审核反馈
        )),
        TriggerType.EVENT
      );
      ticket.setStatus(TicketStatus.PENDING_REPLY);
    }

    ticketRepository.save(ticket);
  }

  /**
   * 手动触发翻译（管理员操作）
   */
  public void triggerAiTranslation(Long ticketId) {
    Ticket ticket = ticketRepository.findById(ticketId).orElseThrow();

    taskDistributionService.createTask(
      "ticket.translate",
      "ticket",
      ticketId.toString(),
      JSON.toJSONString(Map.of(
        "ticketId", ticketId,
        "content", ticket.getContent()
      )),
      TriggerType.MANUAL
    );
  }
}
```

## 扩展点：TaskHandler 接口

用于实现 SERVER_SCHEDULED 和 SERVER_TRIGGERED 模式的自定义处理器。

```java
/**
 * 任务处理器接口
 * 实现此接口的 Spring Bean 可在 TaskDefinition.handlerName 中指定
 */
public interface TaskHandler {

  /**
   * 执行任务
   *
   * @param taskInstance 任务实例
   * @return 执行结果（字符串）
   * @throws Exception 处理异常（framework 会自动捕获并标记为 FAILED）
   */
  String execute(TaskInstance taskInstance) throws Exception;
}
```

**实现示例**:

```java
@Component("customBatchExportHandler")
public class CustomBatchExportHandler implements TaskHandler {

  @Autowired
  private TicketRepository ticketRepository;

  @Override
  public String execute(TaskInstance taskInstance) throws Exception {
    // 解析任务参数
    Map<String, Object> payload = JSON.parseObject(
      taskInstance.getPayload(),
      Map.class
    );

    String format = (String) payload.get("format");

    if ("csv".equals(format)) {
      // 执行 CSV 导出
      String filePath = exportToCSV();
      return JSON.toJSONString(Map.of(
        "filePath", filePath,
        "recordCount", 1024,
        "status", "success"
      ));
    }

    throw new UnsupportedOperationException("不支持的导出格式: " + format);
  }

  private String exportToCSV() {
    // 实现导出逻辑
    return "/data/export_20260216_110000.csv";
  }
}
```

## 调度器

### TaskRecoveryScheduler — 超时回收

每 30 秒执行一次，扫描所有启用的任务定义，处理超期 CLAIMED 任务。

```java
@Service
@Slf4j
public class TaskRecoveryScheduler {

  @Autowired
  private TaskDefinitionRepository taskDefinitionRepository;

  @Autowired
  private TaskInstanceRepository taskInstanceRepository;

  @Scheduled(fixedDelay = 30000)  // 每 30 秒
  public void recoverTimeoutTasks() {
    List<TaskDefinition> definitions = taskDefinitionRepository
      .findByEnabledTrue();

    for (TaskDefinition def : definitions) {
      // 跳过 SERVER_* 模式（它们有自己的调度机制）
      if (!ExecutionMode.CLIENT_DISTRIBUTED.equals(def.getExecutionMode())) {
        continue;
      }

      // 查找超时任务：assignedAt < now - timeoutSeconds
      LocalDateTime threshold = LocalDateTime.now()
        .minusSeconds(def.getTimeoutSeconds());

      List<TaskInstance> timeoutTasks = taskInstanceRepository
        .findByTaskTypeAndStatusAndAssignedAtBefore(
          def.getCode(),
          TaskStatus.CLAIMED,
          threshold
        );

      for (TaskInstance task : timeoutTasks) {
        if (task.getRetryCount() < def.getMaxRetries()) {
          // 重试：重置为 PENDING
          task.setStatus(TaskStatus.PENDING);
          task.setAssignedTo(null);
          task.setAssignedAt(null);
          task.setRetryCount(task.getRetryCount() + 1);

          log.info(
            "Task {} timeout recovered. Retry count: {}",
            task.getId(),
            task.getRetryCount()
          );
        } else {
          // 超过最大重试：标记为 TIMEOUT
          task.setStatus(TaskStatus.TIMEOUT);

          log.warn(
            "Task {} marked as TIMEOUT after {} retries",
            task.getId(),
            task.getRetryCount()
          );
        }

        taskInstanceRepository.save(task);
      }
    }
  }
}
```

### TaskCronScheduler — 定时调度

启动时加载所有 SERVER_SCHEDULED 定义，使用 Spring TaskScheduler 注册定时任务。

```java
@Service
@Slf4j
public class TaskCronScheduler {

  @Autowired
  private TaskDefinitionRepository taskDefinitionRepository;

  @Autowired
  private TaskInstanceRepository taskInstanceRepository;

  @Autowired
  private ApplicationContext applicationContext;

  @Autowired
  private TaskScheduler taskScheduler;  // 4 线程池

  private final Map<String, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();

  @PostConstruct
  public void initializeCronTasks() {
    List<TaskDefinition> cronDefs = taskDefinitionRepository
      .findByExecutionModeAndEnabledTrue(
        ExecutionMode.SERVER_SCHEDULED
      );

    for (TaskDefinition def : cronDefs) {
      registerCronTask(def);
    }

    log.info("Initialized {} cron tasks", cronDefs.size());
  }

  /**
   * 注册单个 Cron 任务
   */
  public void registerCronTask(TaskDefinition definition) {
    if (!ExecutionMode.SERVER_SCHEDULED.equals(definition.getExecutionMode())) {
      throw new IllegalArgumentException(
        "Only SERVER_SCHEDULED tasks can be registered as cron"
      );
    }

    String handlerName = definition.getHandlerName();
    if (handlerName == null) {
      throw new IllegalArgumentException(
        "handlerName must be set for SERVER_SCHEDULED task: " + definition.getCode()
      );
    }

    TaskHandler handler = (TaskHandler) applicationContext.getBean(handlerName);
    CronTrigger trigger = new CronTrigger(definition.getCronExpression());

    ScheduledFuture<?> future = taskScheduler.schedule(
      () -> {
        try {
          // 创建任务实例
          TaskInstance instance = new TaskInstance();
          instance.setTaskType(definition.getCode());
          instance.setStatus(TaskStatus.PENDING);
          instance.setTriggerType(TriggerType.SCHEDULED);
          instance.setPayload("{}");

          taskInstanceRepository.save(instance);

          // 立即执行 handler
          String result = handler.execute(instance);
          instance.setStatus(TaskStatus.COMPLETED);
          instance.setResult(result);

          log.info(
            "Cron task {} executed successfully",
            definition.getCode()
          );
        } catch (Exception e) {
          log.error(
            "Cron task {} failed: {}",
            definition.getCode(),
            e.getMessage(),
            e
          );
        }
      },
      trigger
    );

    ScheduledFuture<?> previous = scheduledTasks.put(
      definition.getCode(),
      future
    );

    if (previous != null) {
      previous.cancel(false);
    }
  }

  /**
   * 每 5 分钟刷新 Cron 注册表（支持动态修改定义）
   */
  @Scheduled(fixedDelay = 300000)  // 5 分钟
  public void refreshCronTasks() {
    List<TaskDefinition> cronDefs = taskDefinitionRepository
      .findByExecutionMode(ExecutionMode.SERVER_SCHEDULED);

    Set<String> registeredCodes = scheduledTasks.keySet();

    for (TaskDefinition def : cronDefs) {
      if (def.isEnabled()) {
        if (registeredCodes.contains(def.getCode())) {
          // 已注册，跳过（简单起见，不检查 cron 表达式变更）
          continue;
        }
        // 新增或重新启用的定义，注册之
        registerCronTask(def);
      } else {
        // 已禁用，取消调度
        ScheduledFuture<?> future = scheduledTasks.remove(def.getCode());
        if (future != null) {
          future.cancel(false);
          log.info("Cron task {} cancelled", def.getCode());
        }
      }
    }
  }
}
```

## 权限模型

task 模块定义的权限（通过 `TaskPermissionDefinition` 实现 `ModulePermissionDefinition`）:

| 权限 Code | 权限名称 | 描述 | 默认角色 |
|----------|--------|------|---------|
| task:read | 任务查询 | 读取任务统计、历史、定义 | ADMIN, USER, AUDITOR |
| task:claim | 任务领取 | 领取、完成、释放任务 | ADMIN, USER, AUDITOR |
| task:manage | 任务管理 | 创建定义、启用/禁用、手动触发、清理历史 | ADMIN |
| task:trigger | 任务触发 | 手动触发任务（较低权限，可配给 PowerUser） | ADMIN |

## ticket 模块集成

task 模块被 ticket 模块使用，支持工单的分布式处理流程。

### 任务定义初始化

启动时，`TicketTaskDefinitionInitializer` 自动创建 3 个任务定义：

```java
@Component
@Slf4j
public class TicketTaskDefinitionInitializer {

  @Autowired
  private TaskDefinitionRepository taskDefinitionRepository;

  @PostConstruct
  public void initializeTicketTasks() {
    // 1. 工单翻译任务
    createIfNotExists(
      "ticket.translate",
      "工单翻译",
      "将工单内容翻译为目标语言",
      ExecutionMode.CLIENT_DISTRIBUTED,
      null,
      300,      // timeout
      3,        // maxRetries
      5,        // maxConcurrency（并发翻译多个工单）
      null
    );

    // 2. 工单回复任务
    createIfNotExists(
      "ticket.reply",
      "工单回复",
      "生成工单的 AI 回复",
      ExecutionMode.CLIENT_DISTRIBUTED,
      null,
      600,      // timeout（回复可能耗时长）
      3,        // maxRetries
      1,        // maxConcurrency（回复一个一个来，避免 NotebookLM 冲突）
      null
    );

    // 3. 工单审核任务
    createIfNotExists(
      "ticket.audit",
      "工单审核",
      "人工审核工单回复",
      ExecutionMode.CLIENT_DISTRIBUTED,
      null,
      3600,     // timeout（审核可能需要较长时间）
      1,        // maxRetries
      1,        // maxConcurrency（审核仍是串行）
      null
    );

    log.info("Ticket task definitions initialized");
  }

  private void createIfNotExists(
    String code, String name, String description,
    ExecutionMode executionMode, String cronExpression,
    int timeoutSeconds, int maxRetries, int maxConcurrency,
    String handlerName
  ) {
    if (taskDefinitionRepository.existsByCode(code)) {
      return;  // 幂等：已存在则跳过
    }

    TaskDefinition def = new TaskDefinition();
    def.setCode(code);
    def.setName(name);
    def.setDescription(description);
    def.setExecutionMode(executionMode);
    def.setCronExpression(cronExpression);
    def.setTimeoutSeconds(timeoutSeconds);
    def.setMaxRetries(maxRetries);
    def.setMaxConcurrency(maxConcurrency);
    def.setEnabled(true);
    def.setHandlerName(handlerName);

    taskDefinitionRepository.save(def);

    log.debug("Created task definition: {}", code);
  }
}
```

### 工单状态流转与任务流转

```
┌──────────────────────────────────────────────────────────────┐
│ 工单状态流转 ↔ 任务流转                                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ① PENDING_TRANS                                              │
│    ↓ triggerAiTranslation()                                  │
│    → Task(ticket.translate) 创建为 PENDING                   │
│    → fd-client claim → 调用 Gemini CLI 翻译                 │
│    → 上报完成 complete API                                   │
│    ↓ submitTranslation()                                     │
│    → Task(ticket.translate) 完成                             │
│    → Task(ticket.reply) 创建为 PENDING                       │
│    → Status: PENDING_REPLY                                   │
│                                                               │
│ ② PENDING_REPLY                                              │
│    ↓ triggerAiReply()                                        │
│    → Task(ticket.reply) 创建为 PENDING (MANUAL)             │
│    → fd-client claim → NotebookLM Shadow Window 生成回复     │
│    → 上报完成 complete API                                   │
│    ↓ submitReply()                                           │
│    → Task(ticket.reply) 完成                                 │
│    → Task(ticket.audit) 创建为 PENDING                       │
│    → Status: PENDING_AUDIT                                   │
│                                                               │
│ ③ PENDING_AUDIT                                              │
│    ↓ 人工审核（管理员 UI）                                     │
│    ↓ submitAudit(PASS)                                       │
│    → Task(ticket.audit) 完成                                 │
│    → Status: APPROVED (等待推送)                             │
│    ↓ submitAudit(REJECT)                                     │
│    → Task(ticket.audit) 完成                                 │
│    → Task(ticket.reply) 重新创建为 PENDING + 审核意见注入     │
│    → Status: PENDING_REPLY (循环)                            │
│                                                               │
│ ④ APPROVED / COMPLETED                                       │
│    ↓ pushReply()                                             │
│    → 回复推送到 Freshdesk                                     │
│    → Status: COMPLETED                                       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## 数据流时序图

```
fd-client                Task Module            TicketService
    │                        │                         │
    │ ④ claim(type,id,limit) │                         │
    ├──────────────────────→ │                         │
    │                 [原子领取]                        │
    │  ← TaskInstance[]       │                         │
    │                        │                         │
    │ ⑤ 执行任务（翻译/回复）   │                         │
    │   (NotebookLM/Gemini)   │                         │
    │                        │                         │
    │ ⑥ complete(taskId, success) │                    │
    ├──────────────────────→ │ ⑦ completeByReference() │
    │                        ├───────────────────────→ │
    │                        │   [幂等更新 COMPLETED]   │
    │  ← success              │                         │
    │                        │ ⑧ createTask(next)      │
    │                        │ ← [下一阶段任务]         │
    │                        │                         │
    │ ⑨ 拉取下一个任务        │                         │
    ├────── loop──────────→ │                         │
    │                        │                         │
```

## 模块依赖

### 依赖树

```
task (模块级)
  ├── auth (权限注解: @RequiresPermission)
  ├── common (通用工具、全局异常)
  └── Spring Boot 核心
      ├── spring-data-jpa
      ├── spring-data-redis (Token 黑名单、缓存）
      ├── spring-context （TaskScheduler）
      └── spring-amqp （可选，后续集成 MQ）
```

### 被依赖的模块

```
ticket
  ├── task (TaskDistributionService)
  ├── auth (权限检查)
  └── common
```

## Maven 多模块化建议

当 fd-server 演化为微服务架构时，task 模块可独立为 Maven 子模块。

### 推荐 POM 坐标

```xml
<groupId>com.jefflower</groupId>
<artifactId>fd-server-task</artifactId>
<version>1.0.0</version>
<packaging>jar</packaging>

<name>FD Server - Task Distribution Module</name>
<description>Multi-client task distribution, scheduling, and execution framework</description>
```

### 依赖声明（fd-server-task/pom.xml）

```xml
<dependencies>
  <!-- 内部依赖 -->
  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-common</artifactId>
    <version>1.0.0</version>
  </dependency>

  <dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-auth</artifactId>
    <version>1.0.0</version>
  </dependency>

  <!-- Spring 依赖 -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
  </dependency>

  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-context</artifactId>
  </dependency>

  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-data-redis</artifactId>
  </dependency>

  <!-- 数据库驱动 -->
  <dependency>
    <groupId>com.h2database</groupId>
    <artifactId>h2</artifactId>
    <scope>runtime</scope>
  </dependency>

  <!-- 测试 -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

### 导出的 API（供其他模块 import）

fd-server-task 暴露以下公开接口（ticket 模块 import）：

```
com.jefflower.fdserver.task.service.TaskDistributionService
com.jefflower.fdserver.task.entity.TaskInstance
com.jefflower.fdserver.task.entity.TaskDefinition
com.jefflower.fdserver.task.enums.TaskStatus
com.jefflower.fdserver.task.enums.ExecutionMode
com.jefflower.fdserver.task.enums.TriggerType
com.jefflower.fdserver.task.handler.TaskHandler
```

**不应暴露**（内部实现细节）:

```
com.jefflower.fdserver.task.repository.*
com.jefflower.fdserver.task.scheduler.*  (仅 @PostConstruct 启动）
com.jefflower.fdserver.task.config.*
```

## 配置示例

### application.yml

```yaml
# Task 模块配置
app:
  task:
    # 恢复超时任务的扫描周期（毫秒）
    recovery-interval: 30000

    # Cron 任务刷新周期（毫秒）
    cron-refresh-interval: 300000

    # 任务执行历史保留期（天）
    history-retention-days: 30

    # TaskScheduler 线程池大小
    scheduler-pool-size: 4

# 数据库（H2）
spring:
  datasource:
    url: jdbc:h2:file:./data/fd-server;MODE=MySQL
    driver-class-name: org.h2.Driver
    username: sa
    password:

  jpa:
    hibernate:
      ddl-auto: update
    show-sql: false

# Redis（可选，用于 Token 黑名单）
  redis:
    host: localhost
    port: 6379
    timeout: 2000
```

## 常见问题

### Q: 如何保证 claim 操作的原子性？

**A**: 使用数据库排它锁（FOR UPDATE）和事务隔离。

```sql
SELECT * FROM task_instance
  WHERE task_type = ? AND status = 'PENDING'
  ORDER BY created_at ASC
  LIMIT ?
  FOR UPDATE;  -- 排它锁，持有至事务提交
```

Hibernate 通过 `@Transactional` + `@Lock(LockModeType.PESSIMISTIC_WRITE)` 自动处理。

### Q: 重试逻辑如何工作？

**A**:
- 每次超时扫描时，若 `retryCount < maxRetries`，则重置为 PENDING 并增加 retryCount
- 客户端再次 claim 时可获取同一任务
- 超过 maxRetries 后标记为 TIMEOUT，不再重试

### Q: 如何避免 CLAIMED 任务泄漏（客户端崩溃）？

**A**: TaskRecoveryScheduler 每 30 秒扫描一次，自动回收超期任务。

### Q: CLIENT_DISTRIBUTED 和 SERVER_SCHEDULED 任务可以混合吗？

**A**: 可以。同一个 fd-server 应用可以同时运行两种模式。task 模块会自动区分处理。

### Q: 如何监控任务队列健康度？

**A**: Dashboard API 返回各任务类型的状态计数，实时展示 PENDING/CLAIMED/COMPLETED 等分布。结合日志聚合工具（ELK）可实现完整监控。

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-16
**贡献者**: Claude Code (Architectural Design)
