# Server Architecture (FD-Server)

`fd-server` 是集中式 Java Spring Boot 应用，管理工单生命周期、Freshdesk 同步、RabbitMQ 任务分发、RBAC 权限控制。采用 **Maven 多模块**架构（parent POM + 6 个子模块）。

## Technology Stack
- **Language**: Java 21 (Temurin)
- **Framework**: Spring Boot 3.4.1
- **Database**: H2 Database (File-based, persistent), Hibernate DDL `update`
- **ORM**: Spring Data JPA
- **Messaging**: RabbitMQ (via Spring AMQP)
- **Security**: Spring Security + JWT (Dual Token) + RBAC
- **Port**: 9988 (default)

## Maven Multi-Module Architecture

```
fd-server/                              (parent POM, packaging: pom)
├── fd-server-common/                   (jar) 公共基础（通用工具、全局异常、公共配置）
├── fd-server-auth/                     (jar) 认证授权（JWT、RBAC、用户/角色/权限/模块管理、用户设置）
├── fd-server-task/                     (jar) 任务调度（任务定义、任务实例、多客户端分发、定时调度）
├── fd-server-ai/                       (jar) AI Agent 管理（Agent 定义、执行日志、能力绑定、SPI 扩展）
├── fd-server-workflow/                 (jar) 工作流引擎（Flowable BPMN 2.0、JavaDelegate、异步唤醒、双轨模式）
├── fd-server-ticket/                   (jar) 工单业务（Freshdesk 集成、MQ、同步、知识库、通知）
└── fd-server-app/                      (jar) 启动入口 + 资源文件 + 静态前端
```

Java 包名保持 `com.jefflower.fdserver.*` 不变，模块边界由 Maven 依赖在编译期强制执行。编译顺序：common → auth → task → ai → workflow → ticket → app

### 模块间依赖规则

```
common  ←──  auth  ←──  task  ←──  ai  ←──  workflow  ←──  ticket
```
- common 不依赖任何业务模块（最底层）
- auth 只依赖 common
- task 只依赖 auth 和 common（任务定义、用户认证）
- ai 只依赖 task（通过 task 传递获得 auth + common）
- workflow 只依赖 ai, task, auth, common（通过 AgentDispatchService 触发 Agent、TaskDistributionService 创建任务、Flowable 引擎集成）
- ticket 只依赖 workflow, ai, task, auth, common（通过 TicketWorkflowOrchestrator 编排工作流）
- 模块间通过 Service 注入直接调用（允许单向依赖）；workflow 模块仅依赖 ai/task 的公开 Service 接口，不访问内部实现
- ticket 模块仅依赖 workflow/ai 的公开 Service 接口，不访问 auth/task 的内部实现

## Module: auth (42 files)

认证授权模块，管理 JWT、RBAC 权限模型、用户生命周期、用户应用设置。

```
auth/
├── config/
│   ├── AuthDataInitializer.java       # 数据初始化（增量同步模式）
│   ├── AuthPermissionDefinition.java  # auth 模块权限定义（实现 ModulePermissionDefinition）
│   ├── RedisConfig.java               # Redis 配置（Token 黑名单）
│   └── SecurityConfig.java            # Spring Security + JWT + CORS
├── controller/
│   ├── AuthController.java            # 登录/注册/刷新 Token/登出
│   ├── RolePermissionController.java  # 角色权限 CRUD（SUPER_ADMIN）
│   ├── UserManageController.java      # 用户管理（审批/角色/密码/列表）
│   └── UserSettingsController.java    # 用户应用设置 CRUD
├── dto/
│   ├── LoginRequest.java
│   ├── LoginResponse.java             # 含 accessToken + refreshToken + 双过期时间
│   ├── RegisterRequest.java
│   ├── RefreshTokenRequest.java
│   ├── TokenPair.java
│   ├── ApproveRequest.java
│   ├── InitAdminRequest.java
│   └── SuperResetPasswordRequest.java
├── entity/
│   ├── SysUser.java                   # 用户（username, password, status）
│   ├── SysRole.java                   # 角色（code, name, builtIn）
│   ├── SysPermission.java             # 权限（code, name, moduleCode）
│   ├── SysModule.java                 # 模块（code, name, icon, routePath, enabled）
│   ├── SysUserRole.java               # 用户-角色关联
│   ├── SysRolePermission.java         # 角色-权限关联
│   └── UserAppSettings.java           # 用户应用设置（appCode, settingsJson）
├── enums/
│   └── UserStatus.java                # PENDING, APPROVED, REJECTED
├── repository/
│   ├── SysUserRepository.java
│   ├── SysRoleRepository.java
│   ├── SysPermissionRepository.java
│   ├── SysModuleRepository.java
│   ├── SysUserRoleRepository.java
│   ├── SysRolePermissionRepository.java
│   └── UserAppSettingsRepository.java
├── security/
│   ├── JwtUtil.java                   # JWT 生成/验证（双 Token）
│   ├── JwtAuthenticationFilter.java   # 请求拦截 + Token 校验
│   ├── RequiresPermission.java        # @RequiresPermission 注解
│   ├── PermissionAspect.java          # AOP 权限拦截切面
│   └── Logical.java                   # 权限逻辑运算符（AND/OR）
└── service/
    ├── AuthService.java               # 认证核心（登录/注册/用户管理）
    ├── TokenService.java              # Token 生成/刷新/吊销
    ├── TokenBlacklistService.java     # Token 黑名单（Redis/内存）
    ├── ModuleService.java             # 模块查询（用户可访问模块）
    ├── ModulePermissionDefinition.java # 模块权限定义接口
    ├── RolePermissionService.java     # 角色-权限 CRUD
    ├── PermissionCacheService.java    # 权限缓存
    └── UserAppSettingsService.java    # 用户应用设置管理
```

### RBAC 五表模型

```
SysUser ──(N:M)──→ SysRole ──(N:M)──→ SysPermission ──(N:1)──→ SysModule
         SysUserRole        SysRolePermission
```

- **SysUser**: 用户（status: PENDING/APPROVED/REJECTED）
- **SysRole**: 角色（内置: SUPER_ADMIN, ADMIN, USER, AUDITOR）
- **SysPermission**: 权限（如 `ticket:list`, `auth:user:manage`），关联 moduleCode
- **SysModule**: 模块（如 auth, ticket, system），控制前端菜单可见性
- **SysUserRole**: 用户-角色多对多关联
- **SysRolePermission**: 角色-权限多对多关联

### 权限自注册机制

**ModulePermissionDefinition 接口**：各模块实现此接口声明权限。

```java
public interface ModulePermissionDefinition {
    String getModuleCode();
    Map<String, String> getPermissions();              // code → name
    Map<String, List<String>> getDefaultRoleAssignments(); // code → [roleCode]
}
```

实现类：
- `AuthPermissionDefinition` — auth 模块 4 个权限
- `AiPermissionDefinition` — ai 模块 3 个权限（ai:manage, ai:execute, ai:view_logs）
- `TicketPermissionDefinition` — ticket 模块 6 个权限
- `SystemPermissionDefinition` — system 模块 8 个权限

**AuthDataInitializer**（增量同步模式）：
1. 确保基础角色存在（SUPER_ADMIN, ADMIN, USER, AUDITOR）
2. 扫描所有 `ModulePermissionDefinition` 实现，确保模块存在
3. 增量同步权限：新增自动创建 + 分配默认角色 + SUPER_ADMIN 拥有全部
4. 已有权限保持不变

### JWT 双 Token 机制

- **accessToken**: 短期有效，携带 userId + username
- **refreshToken**: 长期有效，用于刷新 accessToken
- **Token 黑名单**: 登出时将 Token 加入黑名单（支持 Redis 或内存）
- **LoginResponse**: 返回 `accessToken`, `refreshToken`, `accessTokenExpireAt`, `refreshTokenExpireAt`, `user`

### @RequiresPermission 注解

```java
@RequiresPermission(value = {"ticket:list"}, logical = Logical.OR)
public ResponseEntity<?> listTickets(...) { ... }
```

`PermissionAspect` 通过 AOP 拦截，从 JWT 提取用户 → 查询权限 → 校验。

## Module: task (支持中)

任务调度模块，负责多客户端任务分发、任务生命周期管理、定时调度。

```
task/
├── config/
│   └── TaskPermissionDefinition.java  # task 模块权限定义
├── controller/
│   ├── TaskClaimController.java       # 任务领取/完成/释放（客户端 API）
│   └── TaskAdminController.java       # 任务管理后台（定义、历史、统计）
├── dto/
│   ├── TaskClaimRequest.java          # 领取请求（taskCode）
│   ├── TaskCompleteRequest.java       # 完成请求（taskId, result）
│   ├── TaskHistoryDTO.java            # 任务执行历史
│   └── TaskDashboardDTO.java          # 仪表板统计
├── entity/
│   ├── TaskDefinition.java            # 任务定义（code, name, handler, cronExpression）
│   ├── TaskInstance.java              # 任务实例（userId, taskCode, status, claimedAt, completedAt）
│   └── TaskExecutionLog.java          # 执行日志（result, errorMsg）
├── enums/
│   ├── TaskStatus.java                # PENDING, CLAIMED, COMPLETED, FAILED, TIMEOUT
│   └── TaskType.java                  # MANUAL, SCHEDULED, CRON
├── repository/
│   ├── TaskDefinitionRepository.java
│   ├── TaskInstanceRepository.java
│   └── TaskExecutionLogRepository.java
├── scheduler/
│   ├── TaskRecoveryScheduler.java     # 超时任务回收（15分钟未完成自动释放）
│   └── TaskCronScheduler.java         # Cron 定时调度（触发新任务实例创建）
└── service/
    ├── TaskDefinitionService.java     # 任务定义管理
    ├── TaskClaimService.java          # 任务领取/完成/释放核心逻辑
    ├── TaskExecutionService.java      # 任务执行（创建、取消、查询）
    └── TaskStatisticsService.java     # 统计和报表
```

### 任务工作流

1. **创建 TaskDefinition**: 后台定义任务（如"翻译", "回复", "审核"），设置 `handler` 和 `cronExpression`（可选）
2. **定时触发** (TaskCronScheduler): 按 cron 创建 `TaskInstance`（状态: PENDING），发送通知给所有连接的客户端
3. **客户端领取** (`POST /api/v1/tasks/claim`): 客户端轮询或通过 Webhook 领取任务（状态转为 CLAIMED，设置 `claimedBy` 和 `claimedAt`）
4. **执行任务**: 客户端执行任务逻辑（翻译/回复/审核）
5. **上报完成** (`POST /api/v1/tasks/{id}/complete`): 客户端上报结果（状态转为 COMPLETED/FAILED，设置 `completedAt` 和 `result`），自动创建 `TaskExecutionLog`
6. **释放任务** (`POST /api/v1/tasks/{id}/release`): 客户端可主动释放未完成的任务（状态转为 PENDING，清除 `claimedBy`），或由 `TaskRecoveryScheduler` 自动释放超时任务
7. **统计和审计**: `TaskExecutionLog` 记录所有执行历史，用于审计和优化

## Module: ai

AI Agent 管理模块，提供统一的 AI Agent 定义、执行日志、能力绑定和服务端 Provider SPI。

```
ai/
├── config/
│   ├── AiPermissionDefinition.java    # ai 模块权限定义（ai:manage, ai:execute, ai:view_logs）
│   └── AiDataInitializer.java         # 内置 Agent 初始化（gemini-translate, notebooklm-reply, tracking-query）
├── controller/
│   ├── AgentDefinitionController.java # Agent 定义 CRUD + 启用/禁用
│   ├── AgentExecutionController.java  # 执行、上报、日志查询、统计
│   └── AgentBindingController.java    # 能力绑定配置
├── dto/
│   ├── AgentExecuteRequest.java       # 执行请求（input, referenceType, referenceId）
│   ├── AgentExecuteResult.java        # 执行结果（success, output, tokenCount）
│   ├── AgentExecutionReport.java      # 客户端执行上报
│   └── AgentStats.java               # 统计数据（成功率、平均耗时）
├── entity/
│   ├── AgentDefinition.java           # Agent 定义（code, name, providerType, capability, config）
│   ├── AgentExecution.java            # 执行日志（agentCode, status, duration, tokenCount）
│   └── AgentBinding.java             # 能力绑定（capability → agentCode）
├── enums/
│   ├── ProviderType.java              # LOCAL_CLI, HTTP_API, SHADOW_WINDOW, LOCAL_FUNCTION
│   ├── ExecutionEnv.java              # CLIENT_ONLY, SERVER_ONLY, BOTH
│   └── ExecutionStatus.java           # RUNNING, SUCCESS, FAILED, TIMEOUT, CANCELLED
├── repository/
│   ├── AgentDefinitionRepository.java
│   ├── AgentExecutionRepository.java
│   └── AgentBindingRepository.java
├── service/
│   ├── AgentDefinitionService.java    # Agent 定义 CRUD
│   ├── AgentExecutionService.java     # 执行日志记录与统计
│   ├── AgentDispatchService.java      # 调度核心（服务端执行 + 客户端定义查询）
│   ├── AgentBindingService.java       # 能力绑定管理
│   └── AgentProvider.java            # SPI 接口（服务端 Provider）
└── provider/
    └── HttpApiAgentProvider.java      # 通用 HTTP API Provider（OpenAI/Claude 兼容）
```

### Agent 定义模型

| 字段 | 类型 | 说明 |
|------|------|------|
| code | String (unique) | Agent 唯一标识，如 "gemini-translate" |
| name | String | 显示名 |
| providerType | ProviderType | LOCAL_CLI / HTTP_API / SHADOW_WINDOW / LOCAL_FUNCTION |
| executionEnv | ExecutionEnv | CLIENT_ONLY / SERVER_ONLY / BOTH |
| capability | String | 能力标签，如 "translation" / "reply" / "tracking" |
| providerConfig | TEXT (JSON) | Provider 特有配置 |
| enabled | boolean | 启用/禁用 |
| builtIn | boolean | 内置不可删除 |

### 能力绑定

通过 `ai_agent_binding` 表实现 capability → agentCode 的映射。系统通过 `resolveByCapability()` 查找：先查绑定表，再按 capability 匹配第一个启用的 Agent。

### 内置 Agent

| Code | ProviderType | Capability | 说明 |
|------|-------------|-----------|------|
| gemini-translate | LOCAL_CLI | translation | Gemini CLI 翻译 |
| notebooklm-reply | SHADOW_WINDOW | reply | NotebookLM 回复 |
| tracking-query | SHADOW_WINDOW | tracking | 17track 物流查询 |

## Module: workflow (Flowable BPMN 2.0 集成)

工作流引擎模块，基于 Flowable BPMN 2.0 实现声明式工单处理流程编排。支持双轨模式（Flowable vs Legacy），通过 BPMN 定义实现 Agent 调度、人工审核、业务回调。**v0.4.1+ 默认启用** (`fd.workflow.enabled=true`)。

```
workflow/
├── config/
│   ├── FlowableConfig.java              # Flowable 引擎配置
│   └── WorkflowPermissionDefinition.java # workflow 模块权限定义（workflow:manage, workflow:view）
├── controller/
│   └── WorkflowController.java          # 流程定义/实例管理 API
├── delegate/
│   ├── AgentTaskDelegate.java           # BPMN ServiceTask Delegate（Agent 执行节点）
│   ├── HumanTaskDelegate.java           # 人工审核任务节点
│   └── BusinessCallbackDelegate.java    # 业务回调节点
├── listener/
│   └── WorkflowTaskCompletionListener.java # 应用事件监听器（parallelJoinGw 后触发）
├── dto/
│   ├── WorkflowStartRequest.java        # 流程启动请求
│   └── WorkflowInstanceInfo.java        # 流程实例信息
├── service/
│   ├── WorkflowService.java             # 流程部署、启动、查询、终止
│   ├── WorkflowTaskBridge.java          # 任务完成 signal 唤醒 ReceiveTask（与 task 模块通信）
│   └── WorkflowCallbackRegistry.java    # 业务回调注册表（解耦 workflow ↔ ticket）
└── resources/
    └── bpmn/
        └── ticket-standard-flow.bpmn20.xml # 工单标准 BPMN 流程（并行网关+Agent+审核）
```

### 双轨工作流编排模式

系统支持两种编排方式，通过配置开关 `fd.workflow.enabled` 控制：

- **`true` (v0.4.1+ 默认)**: 使用 FlowableTicketOrchestrator，BPMN 驱动工单流转，支持并行网关、条件分支、定时器等高级功能
- **`false` (Legacy)**: 使用 LegacyTicketOrchestrator，传统硬编码编排，MQ 驱动串行执行

### 并行网关流程设计（v0.4.1+）

BPMN 流程定义使用 `parallelForkGw`（分叉）和 `parallelJoinGw`（汇聚）实现翻译与回复的**并行执行**：

```
START → PENDING_TRANS → parallelForkGw
    ├─ 翻译分支: AgentTask(gemini-translate) ReceiveTask → 接收 translation 事件
    └─ 回复分支: AgentTask(notebooklm-reply) ReceiveTask → 接收 reply 事件
    → parallelJoinGw (两分支都完成时触发)
    → bothDone 回调 (WorkflowTaskCompletionListener)
    → audit_create ServiceTask → PENDING_AUDIT
    → ...
```

### 核心组件说明

| 组件 | 职责 |
|------|------|
| **AgentTaskDelegate** | BPMN ServiceTask Delegate，检查 agent executionEnv（CLIENT_ONLY/SERVER_ONLY/BOTH），决定服务端直接执行还是创建 TaskInstance 等待客户端 |
| **WorkflowTaskCompletionListener** | Spring ApplicationEventListener，监听 WorkflowTaskCompletedEvent，parallelJoinGw 汇聚后触发 bothDone 回调处理两分支统一完成 |
| **WorkflowTaskBridge** | 与 task 模块通信的桥接，TaskDistributionService.completeTask() 完成任务时调用 signal ReceiveTask，唤醒 BPMN 暂停的任务 |
| **WorkflowCallbackRegistry** | 业务模块（ticket）注册回调，workflow 模块的 BusinessCallbackDelegate 通过注册表调用，实现解耦 |
| **TicketWorkflowOrchestrator** | 接口，定义工单工作流编排契约（onNewTicket/onTranslationDone/onReplyDone/onAuditDone） |
| **FlowableTicketOrchestrator** | 实现 TicketWorkflowOrchestrator，通过 WorkflowService 启动 BPMN 流程实例 |
| **LegacyTicketOrchestrator** | 实现 TicketWorkflowOrchestrator，传统 MQ 驱动编排（fd.workflow.enabled=false 时使用） |

### AgentTaskDelegate 参数配置

AgentTaskDelegate 支持通过 BPMN FieldExtension 配置 `taskType`（可选，默认 `workflow.agent.{agentCode}`）：

```xml
<serviceTask id="translate_agent" name="翻译 Agent" class="com.jefflower.fdserver.workflow.delegate.AgentTaskDelegate">
  <extensionElements>
    <flowable:field name="agentCode" stringValue="gemini-translate" />
    <flowable:field name="taskType" stringValue="ticket.translate" />  <!-- 可选，覆盖默认值 -->
  </extensionElements>
</serviceTask>
```

## Module: ticket (59 files)

工单业务模块，处理 Freshdesk 集成、MQ 任务分发、同步管理、知识库、通知。

```
ticket/
├── config/
│   ├── RabbitMQConfig.java            # 队列/交换机/绑定定义
│   ├── MqInitializer.java            # MQ 启动初始化
│   ├── TicketPermissionDefinition.java # ticket 模块权限定义
│   └── SystemPermissionDefinition.java # system 模块权限定义
├── client/
│   └── FreshdeskApiClient.java       # Freshdesk REST API 客户端
├── controller/
│   ├── TicketController.java          # 工单 CRUD + AI 触发 + 推送
│   ├── SyncController.java           # 同步管理（手动触发、配置、状态、日志）
│   ├── QueueController.java          # MQ 队列计数 + DLQ 管理
│   ├── ConfigController.java         # 自动推送 + 企业微信配置
│   ├── KnowledgeController.java      # 知识库 CRUD + CSV 导出
│   ├── DatabaseController.java       # SQL 查询 + 表元数据
│   ├── WebhookController.java        # Freshdesk Webhook 回调
│   └── RequestController.java        # 客户端请求日志
├── dto/ (11)
│   ├── TicketListDTO.java, TicketContent.java
│   ├── TranslationRequest.java, ReplyRequest.java, AuditRequest.java
│   ├── ValidRequest.java, BatchValidRequest.java
│   ├── KnowledgeNoteRequest.java
│   └── SqlQueryRequest.java, SqlQueryResult.java, TableInfo.java
├── entity/ (10)
│   ├── Ticket.java                   # 工单主表（含 lastAuditRemark, isValid）
│   ├── TicketTranslation.java        # 翻译结果
│   ├── TicketReply.java              # 回复草稿
│   ├── TicketAudit.java              # 审核记录
│   ├── SystemConfig.java             # 系统配置键值对
│   ├── KnowledgeNote.java            # 知识库注意事项
│   ├── SyncLog.java                  # 同步日志
│   ├── SyncConfig.java               # 同步配置
│   ├── FailedReplyPush.java          # 推送失败重试
│   └── ClientRequest.java            # 客户端请求记录
├── enums/
│   ├── TicketStatus.java             # PENDING_TRANS → ... → COMPLETED
│   ├── AuditResult.java              # PASS / REJECT
│   ├── SyncStatus.java               # RUNNING / SUCCESS / FAILED
│   └── TriggerType.java              # MANUAL / SCHEDULED
├── repository/ (10)
│   └── (对应各 Entity 的 JpaRepository)
├── scheduler/
│   ├── SyncScheduler.java            # Freshdesk 定时同步
│   └── ReplyPushRetryScheduler.java  # 推送失败重试
└── service/
    ├── TicketService.java            # 工单工作流核心
    ├── MqPublisherService.java       # MQ 消息发布
    ├── MqQueueService.java           # MQ 队列管理
    ├── DlqConsumerService.java       # 死信队列消费
    ├── FreshdeskSyncService.java     # Freshdesk 增量同步
    ├── SyncConfigService.java        # 同步配置管理
    ├── ReplyPushService.java         # 回复推送到 Freshdesk
    ├── SystemConfigService.java      # 系统配置读写
    ├── KnowledgeService.java         # 知识库服务
    ├── WeChatWorkNotifyService.java  # 企业微信通知
    └── DatabaseQueryService.java     # SQL 查询执行
```

### Business Logic

#### Ticket Synchronization (`FreshdeskSyncService.java` + `SyncScheduler.java`)
- **Cron Job**: 基于 `SyncConfig.cronExpression` 触发（可配置，默认每分钟）
- **Incremental Sync**: 通过 `updated_since` 参数查询 Freshdesk 增量更新
- **Task Generation**: 新 Open 工单 → `PENDING_TRANS` → 发送 MQ 翻译消息
- **Sync Logs**: 每次同步记录到 `SyncLog`

#### Task Distribution (`TicketService.java` + `MqPublisherService.java`)
状态变更触发 MQ 消息：
- `PENDING_TRANS` → `q.ticket.translation` (routing key: `ticket.task.translate`)
- `PENDING_REPLY` → `q.ticket.reply` (routing key: `ticket.task.reply`, 含 `auditRemark`)
- `PENDING_AUDIT` → `q.ticket.audit` (routing key: `ticket.task.audit`)

#### Audit & Push Flow
- **PASS + auto-reply OFF** → `APPROVED`（进入待推送队列）
- **PASS + auto-reply ON** → `COMPLETED`（直接推送 Freshdesk）
- **REJECT** → `PENDING_REPLY`（保存 `lastAuditRemark`，MQ 重新回复）
- **Push**: `pushApprovedReply()` / `batchPushApprovedReplies()` → Freshdesk → `COMPLETED`

#### WeChat Work Notifications (`WeChatWorkNotifyService.java`)
异步 Webhook 通知：审核通过/驳回、回复推送完成

#### Sync Configuration (`SyncConfigService.java`)
- cron 表达式、启用开关持久化于 `SyncConfig`
- 同步锁机制防止并发同步
- 默认: `0 0/1 * * * ?` (每分钟), 启用 `true`

#### System Configuration (`SystemConfigService.java`)
运行时配置存于 `SystemConfig` 键值对：
- `auto_reply_enabled` — 审核通过后自动推送（默认 `false`）
- `wecom_webhook_url` — 企业微信 Webhook URL
- `wecom_notify_enabled` — 启用企业微信通知（默认 `false`）

## Module: common (8 files)

```
common/
├── config/
│   ├── RestTemplateConfig.java    # RestTemplate 配置
│   └── SpaWebConfig.java         # SPA 路由转发（@ConditionalOnResource）
├── dto/
│   └── ApiResponse.java          # 统一 API 响应结构
├── exception/
│   ├── BusinessException.java    # 业务异常
│   └── GlobalExceptionHandler.java # 全局异常处理
└── util/
    ├── PasswordValidator.java    # 密码强度校验
    ├── SqlValidator.java         # SQL 安全校验
    └── SuperPasswordVerifier.java # 超级密码验证
```

### SPA 路由转发 (`SpaWebConfig.java`)
- `@ConditionalOnResource("classpath:static/index.html")` — 仅当 static/ 目录存在时激活
- 非 `/api/`、非 `/h2-console` 路径转发到 `index.html`
- 支持 fd-web 发布后直接通过 fd-server 访问 SPA 页面

## API Layer

### Auth Endpoints (`AuthController.java`)
- `POST /api/v1/auth/login` — 登录（返回双 Token）
- `POST /api/v1/auth/register` — 注册（初始状态 PENDING）
- `POST /api/v1/auth/refresh` — 刷新 Token
- `POST /api/v1/auth/logout` — 登出（Token 加入黑名单）
- `GET /api/v1/auth/me/modules` — 当前用户可访问模块
- `GET /api/v1/auth/me/permissions` — 当前用户全部权限

### User Management (`UserManageController.java`)
- `GET /api/v1/admin/users` — 用户列表（分页，状态/用户名过滤）
- `GET /api/v1/admin/users/pending` — 待审核用户
- `POST /api/v1/admin/users/{id}/approve` — 批准/拒绝
- `PUT /api/v1/admin/users/{id}/role` — 修改角色
- `POST /api/v1/admin/users/{id}/reset-password` — 重置密码

### Role & Permission (`RolePermissionController.java`)
- `GET /api/v1/auth/roles` — 角色列表
- `GET /api/v1/auth/permissions` — 权限列表
- `GET /api/v1/auth/modules` — 模块列表
- CRUD 角色、权限分配

### User Settings (`UserSettingsController.java`)
- `GET /api/v1/user/settings/{appCode}` — 获取用户应用设置
- `PUT /api/v1/user/settings/{appCode}` — 保存用户应用设置
- `DELETE /api/v1/user/settings/{appCode}` — 删除用户应用设置
- `GET /api/v1/user/settings` — 获取当前用户全部应用设置

### Ticket (`TicketController.java`)
- `GET /api/v1/tickets` — 查询工单（分页，状态/主题/有效性/时间过滤）
- `GET /api/v1/tickets/{id}` — 工单详情
- `POST /api/v1/tickets/{id}/translation` — 上报翻译
- `POST /api/v1/tickets/{id}/reply` — 上报回复
- `POST /api/v1/tickets/{id}/audit` — 上报审核
- `POST /api/v1/tickets/{id}/push-reply` — 手动推送
- `POST /api/v1/tickets/batch-push` — 批量推送
- `POST /api/v1/tickets/{id}/ai-translate` | `ai-reply` — 手动触发 AI
- `POST /api/v1/tickets/{id}/valid` — 更新有效性

### Sync Management (`SyncController.java`)
- `POST /api/v1/sync/freshdesk` — 手动触发同步
- `GET /api/v1/sync/config` | `PUT /api/v1/sync/config` — 同步配置
- `GET /api/v1/sync/status` — 同步状态
- `GET /api/v1/sync/logs` — 同步日志（分页）

### Queue Management (`QueueController.java`)
- `GET /api/v1/tickets/queue-counts` — 各队列工单计数
- DLQ 管理端点

### Config (`ConfigController.java`)
- `GET/PUT /api/v1/config/auto-reply` — 自动推送开关
- `GET/PUT /api/v1/config/wecom-webhook` — 企业微信 Webhook
- `POST /api/v1/config/wecom-webhook/test` — 测试通知

### Knowledge (`KnowledgeController.java`)
- CRUD `/api/v1/admin/knowledge/notes`
- `POST /api/v1/admin/knowledge/batch-valid` — 批量标记有效性
- CSV 导出

### Database (`DatabaseController.java`)
- `POST /api/v1/admin/database/query` — SQL 查询
- `GET /api/v1/admin/database/tables` — 表元数据

### Webhook (`WebhookController.java`)
- `POST /api/v1/webhook/freshdesk` — Freshdesk Webhook 回调

### Agent Management
- `GET /api/v1/agents/definitions` — 获取已启用的 Agent 定义（登录用户）
- `GET /api/v1/agents/definitions/all` — 获取全部 Agent 定义（ai:manage）
- `POST /api/v1/agents/definitions` — 创建 Agent 定义（ai:manage）
- `PUT /api/v1/agents/definitions/{id}` — 更新 Agent 定义（ai:manage）
- `PUT /api/v1/agents/definitions/{id}/toggle` — 启用/禁用（ai:manage）
- `DELETE /api/v1/agents/definitions/{id}` — 删除 Agent 定义（ai:manage）
- `POST /api/v1/agents/execute/{code}` — 服务端执行 Agent（ai:execute）
- `POST /api/v1/agents/executions/report` — 客户端上报执行结果（登录用户）
- `GET /api/v1/agents/executions` — 执行日志列表（ai:view_logs）
- `GET /api/v1/agents/stats` — 统计仪表盘（ai:view_logs）
- `GET /api/v1/agents/bindings` — 获取能力绑定
- `PUT /api/v1/agents/bindings/{capability}` — 设置能力绑定（ai:manage）
- `DELETE /api/v1/agents/bindings/{capability}` — 删除能力绑定（ai:manage）

## Security (`SecurityConfig.java`)

- **JWT Authentication**: Stateless，`Authorization: Bearer <token>`
- **Dual Token**: accessToken (短期) + refreshToken (长期)
- **Filter**: `JwtAuthenticationFilter` 校验每个请求
- **RBAC**: `@RequiresPermission` 注解 + AOP 切面
- **CORS**: 允许 `http://localhost:1420`（fd-web dev）和 `http://localhost:9988`
- **Public Endpoints**: `/api/v1/auth/login`, `/api/v1/auth/register`, `/h2-console/**`, `/api/v1/webhook/**`
- **SPA 资源**: `/*.html`, `/assets/**` 等静态资源路径放行

## Configuration

`application.yml` 主要配置：

```yaml
server:
  port: 9988

spring:
  datasource:
    url: jdbc:h2:file:./data/fdserver
  jpa:
    hibernate:
      ddl-auto: update
  h2:
    console:
      enabled: true
  rabbitmq:
    host: your-host
    port: 5672
    username: guest
    password: guest

jwt:
  secret: your-256-bit-secret
  access-token-expiration-hours: 24
  refresh-token-expiration-hours: 168

freshdesk:
  domain: your-domain.freshdesk.com
  api-key: your-api-key
  webhook:
    secret: optional-webhook-secret
```

## State Transitions

```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → (APPROVED or COMPLETED)
```
- **APPROVED**: 待手动推送（auto-push 关闭时）
- **COMPLETED**: 已推送到 Freshdesk（auto-push 开启时）
- **REJECT → PENDING_REPLY**: 保存审核意见，重新进入 AI 回复

## MQ Queue Mapping

| Queue | Routing Key | Purpose |
|-------|-------------|---------|
| `q.ticket.translation` | `ticket.task.translate` | 翻译任务 |
| `q.ticket.reply` | `ticket.task.reply` | 回复生成 |
| `q.ticket.audit` | `ticket.task.audit` | 人工审核 |
| `q.ticket.dlq` | — | 死信队列 |

Exchange: `fd.ticket.task.exchange` (TopicExchange)

## Default Initialization

- Default admin: `admin/admin123`, role=SUPER_ADMIN, status=APPROVED
- 内置角色: SUPER_ADMIN, ADMIN, USER, AUDITOR
- 内置模块: auth (认证授权), ai (AI Agent 管理), ticket (工单管理), system (系统管理)
- 内置 Agent: gemini-translate (Gemini CLI 翻译), notebooklm-reply (NotebookLM 回复), tracking-query (17track 物流查询)
- Sync cron: `0 0/1 * * * ?` (每分钟), 启用 `true`
- Auto-reply: `false`
- WeChat notifications: `false`
