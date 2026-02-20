# Server Architecture (FD-Server)

`fd-server` 是集中式 Java Spring Boot 应用，管理工单生命周期、Freshdesk 同步、RabbitMQ 任务分发、RBAC 权限控制。采用 **Maven 多模块**架构（parent POM + 5 个子模块）。

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
├── fd-server-ticket/                   (jar) 工单业务（Freshdesk 集成、MQ、同步、知识库、通知）
└── fd-server-app/                      (jar) 启动入口 + 资源文件 + 静态前端
```

Java 包名保持 `com.jefflower.fdserver.*` 不变，模块边界由 Maven 依赖在编译期强制执行。

### 模块间依赖规则

```
common  ←──  auth  ←──  task  ←──  ticket
```
- common 不依赖任何业务模块（最底层）
- auth 只依赖 common
- task 只依赖 auth 和 common（任务定义、用户认证）
- ticket 可依赖 auth、task、common（创建任务、获取当前用户）
- 模块间通过 Service 注入直接调用（允许单向依赖）

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
- 内置模块: auth (认证授权), ticket (工单管理), system (系统管理)
- Sync cron: `0 0/1 * * * ?` (每分钟), 启用 `true`
- Auto-reply: `false`
- WeChat notifications: `false`
