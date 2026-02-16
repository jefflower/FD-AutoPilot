# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**FD-AutoPilot** 是一个智能工单处理系统，集成 Freshdesk 与 AI 能力（Google NotebookLM + Gemini CLI）来自动化翻译和回复生成。

### 核心架构
- **fd-server**: Spring Boot 3.4.1 后端（Java 21），负责工单生命周期管理、Freshdesk 同步、RabbitMQ 任务分发、RBAC 权限控制、SPA 前端托管
- **fd-web**: React 19 前端（Vite 7 + TypeScript + TailwindCSS + React Router 7），独立 Web 应用，可在浏览器直接运行或嵌入 Tauri WebView
- **fd-client**: Tauri v2 桌面客户端（纯 Rust），提供 Gemini CLI 翻译和 NotebookLM Shadow Window 功能，WebView 加载 fd-web
- **消息队列**: RabbitMQ 用于服务端内部异步消息（翻译、回复、审核状态变更触发），客户端通过 REST 轮询 task claim API 获取任务
- **数据库**: 服务端使用 H2 文件数据库

## 开发命令

### 服务端 (fd-server)
```bash
cd fd-server
mvn spring-boot:run                    # 运行（端口 9988）
mvn test                               # 运行所有测试
mvn test -Dtest=TicketServiceTest       # 运行单个测试类
mvn test -Dtest=TicketServiceTest#testMethod  # 运行单个测试方法
mvn clean package                      # 构建
mvn clean package -DskipTests          # 跳过测试构建
```

### 前端 (fd-web)
```bash
cd fd-web
npm install                            # 安装依赖
npm run dev                            # Vite 开发服务器（端口 5173，代理 /api → localhost:9988）
npm run build                          # TypeScript 编译 + Vite 打包（输出 dist/）
npm test                               # 运行所有前端测试（Vitest）
npm run test:watch                     # 开发模式（监听文件变更自动重跑）
npm run test:coverage                  # 覆盖率报告
npx tsc --noEmit                       # 仅类型检查
```

### 客户端 (fd-client) — 纯 Rust
```bash
cd fd-client
npm run tauri dev                      # Tauri 完整开发模式（WebView 加载 fd-web dev server）
npm run tauri build                    # 生产构建（生成安装包，从 fd-web/dist 加载前端）

# Rust 部分单独编译/测试
cd src-tauri
cargo build                            # 编译 Rust
cargo test                             # Rust 测试
```

### 构建带前端的 Server 包
```bash
cd fd-server
mvn clean package -Pwith-frontend      # 自动构建 fd-web 并嵌入 jar（浏览器访问 localhost:9988）
```

**注意**: 前端没有配置 ESLint、Prettier。也没有 CI/CD 流水线。测试框架使用 Vitest + React Testing Library（`npm test`）。

## 核心技术架构

### 端到端数据流
```
Freshdesk API ──(cron 15min)──→ fd-server ──(TaskInstance)──→ REST claim API
                                  ↑                              │
                                  │                    fd-web (REST 轮询 claim)
                                  │                              │
                                  │                    ┌─────────┴──────────┐
                                  │                    │                    │
                                  │              浏览器模式           Tauri 桌面模式
                                  │              (手动翻译)          (Gemini CLI + Shadow Window)
                                  │                    │                    │
                                  └──── POST /api/v1/tickets/{id}/* ───────┘
```

### 工单状态流转
状态流转是整个系统的核心，每次转换都通过 RabbitMQ 消息触发下一阶段：
```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
```

审核分支逻辑：
- **PASS + 自动推送关闭** → `APPROVED`（进入待推送队列，手动推送到 Freshdesk）
- **PASS + 自动推送开启** → `COMPLETED`（直接推送到 Freshdesk）
- **REJECT** → `PENDING_REPLY`（保存 `lastAuditRemark`，MQ 重新回复，AI 注入审核反馈）

对应的 MQ 队列和路由键：
- `q.ticket.translation` → `ticket.task.translate`
- `q.ticket.reply` → `ticket.task.reply`
- `q.ticket.audit` → `ticket.task.audit`
- `q.ticket.dlq`（死信队列）

Exchange: `fd.ticket.task.exchange` (TopicExchange)

### 任务分发机制
工单状态变更时同时创建 TaskInstance（任务实例），客户端通过 REST API 原子领取任务：
- `POST /api/v1/tasks/claim?type=ticket.translate&clientId=xxx&limit=5` — 原子领取
- `POST /api/v1/tasks/{id}/complete` — 完成/失败上报
- 超时回收：每 30 秒检查，超时任务自动重试或标记 TIMEOUT
- 支持多客户端并发消费，通过数据库事务防重

### 混合 AI 工作流
系统对翻译和回复使用不同的 AI 策略：

1. **翻译**: Rust 后端直接调用 `gemini` CLI 工具（`src-tauri/src/ai.rs`），无头执行，速度快
2. **回复**: 使用 Shadow Window 技术操作 NotebookLM（`fd-web/src/tauri/services/notebookShadow.ts`），因为 NotebookLM 无公开 API
   - 创建隐藏 Webview 窗口（`label: notebook_shadow`），通过 `initialization_script` 注入 Tauri IPC 桥接
   - **混合 observer + relay 架构**（v3）：
     1. `mainScript`（IIFE）：清理历史 → 输入 prompt → 点击发送 → 建立 in-page observer（setInterval）
     2. Observer 仅写 `window.__SHADOW_LATEST_RESULT` 全局变量（不在 setInterval 中调用 invoke，避免 IPC 不稳定）
     3. Generator 定期注入 relay 脚本，读取全局变量并通过 `forward_shadow_event` 中继到主窗口
   - DOM 选择器：集中在 `SELECTORS` 常量对象中管理（NotebookLM 更新 UI 后只需修改一处），通过 `JSON.stringify` 注入 mainScript
   - 完成检测：复制按钮出现 + `isJsonBalanced` + `botIdle` + `botResponded` 多重校验
   - 全局互斥锁确保同时只有一个查询在执行

### Rust ↔ React 通信机制（仅 Tauri 桌面模式）
Rust 后端通过 Tauri Event 与 React 前端通信（浏览器模式下这些功能不可用）：
- **Rust → React Events**: `notebook-window-visibility-changed`, `shadow-result`, `shadow-log`
- **React → Rust Commands**: 通过 `tauriInvoke()` 条件调用（Web 模式降级）

保留的 Tauri 命令（`lib.rs` 中注册）：
- AI 翻译: `translate_ticket_direct_cmd`, `sync_translate_reply_cmd`
- 文件操作: `select_folder`, `save_text_file_cmd`
- Shadow Window: `open_shadow_window`, `execute_shadow_js`, `toggle_shadow_window`, `get_shadow_window_visibility`, `close_shadow_window`, `open_notebook_window`, `execute_notebook_js`, `get_shadow_result`, `forward_shadow_event`, `toggle_notebook_window`, `get_notebook_window_visibility`

### 前端状态管理
使用 React Hooks + Context 模式（无 Redux），代码位于 `fd-web/src/`：
- `shared/context/createMQTaskContext.tsx` — **通用任务 Context 工厂函数**，通过 REST 轮询 task claim API 获取任务（不依赖 Tauri），翻译/回复/审核 Context 通过配置参数差异化。`taskProcessor` 通过 Provider prop 注入
- `shared/context/MQTranslationContext` — 并发模式（batchSize=5，pollInterval=3s）
- `shared/context/MQReplyContext` — 串行模式（batchSize=1，任务间延迟 1s）
- `shared/context/MQAuditContext` — 串行模式（batchSize=1，人工审核模式）
- `shared/hooks/useTicketProcess` — 全局工单处理状态，模块级变量 + listener 模式跨组件共享
- `shared/hooks/useSettings` — 用户设置（translationLang, notebookLMConfig），通过 UserAppSettings API 存储到服务端
- **AI Provider 抽象层**（`shared/ai/`）：
  - `types.ts` — 定义 `AiTranslationProvider` 和 `AiReplyProvider` 接口
  - `providers/geminiTranslationProvider.ts` — Gemini CLI 翻译（仅 Tauri 模式，Web 模式友好降级）
  - `providers/notebookLMReplyProvider.ts` — NotebookLM 回复（仅 Tauri 模式）
  - `index.ts` — 工厂函数 `getTranslationProvider(name)` / `getReplyProvider(name, config)`
- **统一 AI Hooks**（`shared/hooks/`）：`useAiReply`, `useAiTranslation`
- **共享 Hooks**（`shared/hooks/`）：`useAuth`, `useToast`
- **Tauri 桥接层**（`tauri/bridge.ts`）：`isTauriEnv()` 检测 + `tauriInvoke()` / `tauriListen()` 条件调用
- **Tauri Hooks**（`tauri/hooks/`）：`useNotebookShadow`（仅 Tauri 环境可用）
- **Tauri 服务**（`tauri/services/`）：`notebookShadow.ts`, `trackingShadow.ts`
- 共享常量: `shared/constants/agentMap.ts` — Freshdesk Agent ID → 名称映射

## 关键文件位置

### 后端 — auth 模块 (fd-server/.../auth/)
- **认证控制器**: `controller/AuthController.java` — 登录、注册、Token 刷新、`GET /me/modules`、`GET /me/permissions`
- **用户管理**: `controller/UserManageController.java` — 用户 CRUD、审批、角色修改、密码重置
- **RBAC 管理**: `controller/RolePermissionController.java` — 角色权限分配
- **核心服务**: `service/AuthService.java` — 认证/授权逻辑 + `service/ModuleService.java` — 模块权限查询
- **权限自注册**: `service/ModulePermissionDefinition.java`（接口），`config/AuthPermissionDefinition.java`（auth 模块 4 个权限）
- **数据初始化**: `config/AuthDataInitializer.java` — 增量同步模式（扫描所有 ModulePermissionDefinition 实现，自动注册模块和权限）
- **实体**: `entity/SysUser.java`, `entity/SysRole.java`, `entity/SysPermission.java`, `entity/SysUserRole.java`, `entity/SysRolePermission.java`, `entity/SysModule.java`
- **安全**: `security/JwtUtil.java`, `security/JwtAuthenticationFilter.java`, `config/SecurityConfig.java`
- **AOP 权限**: `annotation/RequiresPermission.java`, `aspect/PermissionAspect.java`

### 后端 — ticket 模块 (fd-server/.../ticket/)
- **工单服务**: `service/TicketService.java` — 工单工作流编排核心
- **MQ 发布**: `service/MqPublisherService.java`
- **Freshdesk 同步**: `service/FreshdeskSyncService.java` + `scheduler/SyncScheduler.java`
- **权限定义**: `config/TicketPermissionDefinition.java`（6 个权限）, `config/SystemPermissionDefinition.java`（8 个权限）
- **控制器**: `controller/TicketController.java`, `controller/SyncController.java`（同步管理）, `controller/QueueController.java`（队列/DLQ）, `controller/ConfigController.java`, `controller/KnowledgeController.java`, `controller/DatabaseController.java`, `controller/WebhookController.java`, `controller/RequestController.java`
- **实体**: Ticket, TicketTranslation, TicketReply, TicketAudit, SystemConfig, KnowledgeNote, SyncLog, SyncConfig, FailedReplyPush, RequestRecord

### 后端 — common 模块 (fd-server/.../common/)
- `config/RestTemplateConfig.java`, `config/SpaWebConfig.java`（SPA 路由，`@ConditionalOnResource` 仅在有前端时激活）
- `dto/ApiResponse.java`, `util/SqlValidator.java`, `util/SuperPasswordVerifier.java`

### 前端 (fd-web/src/)
- **主入口**: `App.tsx` — 全局布局、Context Provider 包裹、Tab 路由（`React.lazy` 懒加载 + `Suspense`）
- **路由**: `router/routes.ts`（路由定义 + requiredPermission）, `router/guards.tsx`（权限守卫）, `router/index.tsx`（懒加载组件导出）
- **共享层** (`shared/`):
  - `services/serverApi.ts` — 后端 REST API 封装（含 JWT Token 自动刷新、userSettingsApi、taskApi）
  - `hooks/` — useAuth, useToast, useSettings, useTicketProcess, useAiTranslation, useAiReply
  - `context/` — createMQTaskContext（REST 轮询）, MQTranslation/Reply/AuditContext
  - `ai/` — AI Provider 抽象层（Gemini 翻译 + NotebookLM 回复）
  - `components/` — SidebarNew, Common, ErrorBoundary, Toast, FloatingTaskWidget
  - `types/server.ts` — 所有后端类型定义（含 TaskDefinition, TaskInstance, ClientSettings）
  - `i18n/`, `constants/`, `utils/`
- **业务模块** (`modules/`):
  - `auth/pages/` — AuthLoginTab, AuthRegisterTab
  - `ticket/pages/` — ServerTicketsTab, TranslationTasksTab, ReplyTasksTab, AuditTasksTab, ApprovedTasksTab, ServerTaskWorkspace
  - `ticket/components/` — ServerTicketDetail, ServerTicketList, ticket-detail/（TranslationPreviewBar, AiReplyPanel, ReplyHistoryPanel）
  - `admin/pages/` — AdminUsersTab, ManualSyncTab, KnowledgeTab, DatabaseTab, ServerLogsTab
  - `system/pages/` — SettingsTab, UserProfileTab
- **Tauri 桥接层** (`tauri/`):
  - `bridge.ts` — `isTauriEnv()` + `tauriInvoke()` + `tauriListen()` 条件调用
  - `hooks/useNotebookShadow.ts` — Shadow Window 窗口控制 Hook（Web 模式 no-op）
  - `services/notebookShadow.ts` — NotebookLM Shadow Window 核心（Web 模式抛出友好错误）
  - `services/trackingShadow.ts` — 物流查询 Shadow Window

### 客户端 Rust 后端 (fd-client/src-tauri/src/)
- **Tauri 命令注册**: `lib.rs` — 16 个 Tauri command（AI 翻译 2 + 文件系统 2 + Shadow Window 12）
- **AI 翻译**: `ai.rs` — Gemini CLI 调用封装（prompt 构造、JSON 解析、语言代码映射）
- **数据模型**: `models.rs` — Ticket, Conversation, TicketStatus 类型定义（ai.rs 依赖）
- **Freshdesk API**: `api.rs` — 本地直连 Freshdesk 的 HTTP 客户端

## API 规范

所有 API 前缀: `/api/v1`，除登录/注册外需携带 `Authorization: Bearer <token>`

### 核心端点

**认证**（无需 token）：
- `POST /auth/login` | `POST /auth/register` — 登录、注册
- `GET /auth/me/modules` — 当前用户可访问的模块列表（含权限）
- `GET /auth/me/permissions` — 当前用户全部权限 code 列表

**RBAC 管理**（需 SUPER_ADMIN 权限）：
- `GET /auth/roles` — 角色列表（含权限）
- `POST /auth/roles` | `PUT /auth/roles/{id}` | `DELETE /auth/roles/{id}` — 角色 CRUD
- `GET /auth/permissions` — 权限列表
- `PUT /auth/roles/{roleId}/permissions` — 角色权限分配

**工单操作**：
- `GET /tickets` — 查询工单（分页、状态/主题/有效性/时间过滤）
- `GET /tickets/{id}` — 获取单个工单详情
- `POST /tickets/{id}/translation` — 上报翻译结果
- `POST /tickets/{id}/reply` — 上报回复内容
- `PUT /tickets/{id}/reply/{replyId}` — 更新回复内容
- `POST /tickets/{id}/audit` — 上报审核结果（PASS → APPROVED/COMPLETED，REJECT → PENDING_REPLY + 保存审核意见）
- `POST /tickets/{id}/skip-reply` — 跳过回复，标记完成
- `POST /tickets/{id}/push-reply` — 手动推送 APPROVED 工单回复到 Freshdesk
- `POST /tickets/batch-push` — 批量推送 APPROVED 工单
- `POST /tickets/{id}/ai-translate` | `POST /tickets/{id}/ai-reply` — 手动触发 AI 任务
- `GET /tickets/queue-counts` — 获取各队列工单计数
- `POST /tickets/{id}/valid` — 更新工单有效性标记（ADMIN）

**同步管理**（ADMIN）：
- `POST /sync/freshdesk` — 手动触发 Freshdesk 同步
- `GET /sync/config` | `PUT /sync/config` — 同步配置（cron、启用开关）
- `GET /sync/status` — 获取同步状态
- `GET /sync/logs` — 获取同步日志（分页）

**用户管理**（ADMIN）：
- `GET /admin/users` — 用户列表（分页、状态过滤、用户名搜索）
- `GET /admin/users/pending` — 待审核用户列表
- `POST /admin/users/{id}/approve` — 批准/拒绝用户
- `PUT /admin/users/{id}/role` — 修改用户角色
- `POST /admin/users/{id}/reset-password` — 重置用户密码

**知识库**（ADMIN）：
- `GET /admin/knowledge/notes` — 获取注意事项列表
- `POST /admin/knowledge/notes` — 创建注意事项
- `PUT /admin/knowledge/notes/{id}` — 更新注意事项
- `DELETE /admin/knowledge/notes/{id}` — 删除注意事项
- `POST /admin/knowledge/batch-valid` — 批量标记工单有效性
- `GET /admin/knowledge/export/tickets` | `GET /admin/knowledge/export/notes` — CSV 导出

**数据库**：
- `POST /admin/database/query` — 执行 SQL 查询
- `GET /admin/database/tables` — 获取表元数据

**系统配置**：
- `GET /config/auto-reply` | `PUT /config/auto-reply` — 自动推送开关
- `GET /config/wecom-webhook` | `PUT /config/wecom-webhook` — 企业微信 Webhook 配置
- `POST /config/wecom-webhook/test` — 测试企业微信 Webhook

**用户设置**：
- `GET /user/settings/{appCode}` — 获取当前用户指定应用的设置 JSON
- `PUT /user/settings/{appCode}` — 保存/更新设置（body = JSON 字符串）
- `DELETE /user/settings/{appCode}` — 删除设置
- `GET /user/settings` — 获取当前用户所有应用设置

**任务调度**：
- `POST /tasks/claim?type={taskType}&clientId={id}&limit={n}` — 原子领取任务
- `POST /tasks/{id}/complete` — 完成任务（body: `{clientId, success, message}`）
- `POST /tasks/{id}/release?clientId={id}` — 释放任务
- `GET /tasks/mine?clientId={id}` — 查询我的任务

**任务管理**（ADMIN）：
- `GET /task-admin/dashboard` — 各类型任务统计
- `GET /task-admin/definitions` — 任务定义列表
- `POST /task-admin/definitions` — 创建任务定义
- `PUT /task-admin/definitions/{id}/toggle` — 启用/禁用
- `POST /task-admin/definitions/{code}/trigger` — 手动触发
- `GET /task-admin/history` — 执行历史（分页）
- `DELETE /task-admin/history/cleanup` — 清理旧历史

**Webhook**（无需 token）：
- `POST /webhook/freshdesk` — 接收 Freshdesk Webhook 回调

## 数据模型

- **Ticket** (1) → (N) **TicketTranslation**（EAGER 加载，通常只保留最新一条）
- **Ticket** (1) → (N) **TicketReply**（EAGER 加载，通常只有一个活跃草稿）
- **Ticket** (1) → (N) **TicketAudit**
- **Ticket.lastAuditRemark** — 最近一次审核驳回意见（注入 AI 回复提示词）
- **Ticket.isValid** — 知识库有效性标记（用于数据导出和筛选）
- **RBAC 五表模型**: SysUser → SysUserRole → SysRole → SysRolePermission → SysPermission，SysModule（模块实体，一对多关联 Permission）
- **SysUser** — 状态: PENDING/APPROVED/REJECTED，`password` 字段 `@JsonIgnore`。启动时自动创建默认 admin 用户（admin/admin123），角色 SUPER_ADMIN
- **SysModule** — 内置 3 个模块：auth（认证授权）、ticket（工单管理）、system（系统管理），code/name/icon/routePath/sortOrder/enabled/builtIn
- **SysRole** — 内置角色：SUPER_ADMIN（全部权限）、ADMIN、USER、AUDITOR
- **SysPermission** — 通过 `ModulePermissionDefinition` 接口自动注册，启动时增量同步
- **SystemConfig** — 系统配置键值对（auto_reply_enabled, wecom_webhook_url, wecom_notify_enabled）
- **KnowledgeNote** — 知识库注意事项（title, content, sortOrder）
- **SyncLog** — 同步日志（startTime, endTime, ticketsSynced, ticketsUpdated, status, triggerType）
- **SyncConfig** — 同步配置（cron 表达式、启用开关、上次同步时间）
- **FailedReplyPush** — 推送失败重试记录（retryCount, maxRetries, nextRetryAt, lastError）
- **TaskDefinition** — 任务类型定义（code[唯一], name, executionMode[CLIENT_DISTRIBUTED/SERVER_SCHEDULED/SERVER_TRIGGERED], cronExpression, timeoutSeconds, maxRetries, maxConcurrency, enabled, handlerName）
- **TaskInstance** — 任务执行实例（taskType, referenceType, referenceId, status[PENDING/CLAIMED/COMPLETED/FAILED/TIMEOUT/CANCELLED], assignedTo, assignedAt, payload, result, retryCount）
- **UserAppSettings** — 用户应用设置（userId + appCode 唯一约束, settingsJson TEXT）

## 配置

### 服务端
- 配置文件: `fd-server/src/main/resources/application.yml`（已在 .gitignore 中）
- 数据库: H2 文件数据库，Hibernate DDL `update` 自动建表
- H2 控制台: `/h2-console`（开发启用）

### 前端 (fd-web)
- Vite 配置: `fd-web/vite.config.ts`，端口 5173，代理 `/api` → `localhost:9988`
- 代码分割: `React.lazy` + `Suspense` 懒加载，`manualChunks` 分离 react-vendor + i18n-vendor

### 客户端 (fd-client)
- Tauri 配置: `fd-client/src-tauri/tauri.conf.json`
- 开发 URL: `http://localhost:5173`（fd-web dev server），生产前端: `../../fd-web/dist`
- CSP: 关闭（`"csp": null`）以支持 Shadow Window
- DevTools: 通过右键菜单打开（`Cargo.toml` 中 `features = ["devtools"]`）

### Server SPA 托管
- `SpaWebConfig.java` + `@ConditionalOnResource("classpath:static/index.html")`，非 API 路径转发到 index.html
- Maven `with-frontend` Profile: `mvn clean package -Pwith-frontend` 自动构建 fd-web 并复制到 `src/main/resources/static/`

## 文档参考

详细文档位于 `doc/` 目录：`project-documentation.md`（总览）、`system-design.md`（状态流转图）、`client-architecture.md`、`server-architecture.md`、`api-reference.md`、`project-structure.md`

## Agent Teams 配置

本项目使用分层模型策略：开发用 opus（最强推理），测试编写和代码审查用 sonnet（平衡），测试执行和文档用 haiku（高性价比）。

### fd-server 模块化架构

fd-server 采用**单体内模块化**架构——在同一个 Spring Boot 应用内按业务域划分包结构，为后续拆分微服务做准备。

#### 模块划分

| 模块 | 包路径 | 职责 | 可依赖 |
|------|--------|------|--------|
| **auth** | `com.jefflower.fdserver.auth.*` | 用户认证授权（JWT、RBAC、用户生命周期、安全配置、权限注解/接口） | common |
| **task** | `com.jefflower.fdserver.task.*` | 任务调度与分发（多客户端任务分发、定时任务调度、执行历史、Dashboard） | common, auth |
| **ticket** | `com.jefflower.fdserver.ticket.*` | 工单业务（含 Freshdesk 集成、MQ 分发、知识库、通知、管理后台） | common, auth, task |
| **common** | `com.jefflower.fdserver.common.*` | 公共基础（通用工具、全局异常处理、公共 DTO、公共配置） | 无（最底层） |

#### 模块间依赖规则

```
common  ←──  auth  ←──  task  ←──  ticket
```
- 箭头方向 = 依赖方向（A ← B 表示 B 可依赖 A）
- common 不依赖任何业务模块
- auth 只依赖 common（提供权限注解 `@RequiresPermission`、权限定义接口 `ModulePermissionDefinition`）
- task 可依赖 auth（使用权限注解和权限自注册）和 common
- ticket 可依赖 auth、task（通过 TaskDistributionService 创建/完成任务）和 common
- 模块内部子包可互相调用，不需要额外隔离
- 模块间通过注入 Service 直接调用（允许单向依赖），不做过度抽象

#### auth 模块内部结构

```
auth/
├── controller/    AuthController（登录/注册/me端点）, UserManageController, RolePermissionController
├── service/       AuthService（认证/授权）, ModuleService（模块权限查询）, ModulePermissionDefinition（权限自注册接口）
├── entity/        SysUser, SysRole, SysPermission, SysUserRole, SysRolePermission, SysModule
├── repository/    对应各 Entity 的 JpaRepository
├── dto/           LoginRequest, LoginResponse, RegisterRequest, ApproveRequest 等
├── enums/         UserRole, UserStatus
├── annotation/    RequiresPermission（方法级权限注解）
├── aspect/        PermissionAspect（AOP 权限切面）
├── security/      JwtUtil, JwtAuthenticationFilter
├── config/        SecurityConfig, AuthDataInitializer（增量同步模式）, AuthPermissionDefinition
└── util/          PasswordValidator, SuperPasswordVerifier
```

#### task 模块内部结构

```
task/
├── controller/    TaskController（客户端 claim/complete/release API）, TaskAdminController（Dashboard/定义管理/历史/触发）
├── service/       TaskDistributionService（任务分发核心）, TaskScheduleService（定时任务调度）, TaskHandler（服务端任务处理器接口）
├── entity/        TaskDefinition（任务类型定义）, TaskInstance（任务执行实例）
├── repository/    TaskDefinitionRepository, TaskInstanceRepository
├── dto/           TaskCompleteRequest
├── enums/         TaskStatus, ExecutionMode, TriggerType
├── scheduler/     TaskRecoveryScheduler（超时回收）, TaskCronScheduler（Cron 调度器）, TaskSchedulerRegistry（动态 Cron 注册表）
└── config/        TaskConfig（线程池/调度器配置）, TaskPermissionDefinition（权限自注册）
```

#### ticket 模块内部结构

```
ticket/
├── controller/    TicketController, SyncController, QueueController, ConfigController, KnowledgeController, WebhookController, DatabaseController, RequestController
├── service/       TicketService, MqPublisherService, FreshdeskSyncService, ReplyPushService, SystemConfigService, KnowledgeNoteService, WeChatWorkNotifyService, DatabaseQueryService, DlqConsumerService, MqQueueService, SyncConfigService, RequestService
├── entity/        Ticket, TicketTranslation, TicketReply, TicketAudit, SystemConfig, KnowledgeNote, SyncLog, SyncConfig, FailedReplyPush, RequestRecord
├── repository/    对应各 Entity 的 JpaRepository
├── dto/           工单相关所有 DTO
├── enums/         TicketStatus, AuditResult, SyncStatus, TriggerType
├── scheduler/     SyncScheduler, ReplyPushRetryScheduler
└── config/        RabbitMQConfig, MqInitializer, TicketPermissionDefinition, SystemPermissionDefinition
```

#### common 模块内部结构

```
common/
├── config/        RestTemplateConfig, SpaWebConfig（SPA 路由支持，@ConditionalOnResource）
├── dto/           ApiResponse（通用响应结构）
└── util/          SqlValidator, SuperPasswordVerifier
```

### 模型分配规则

当使用 Task 工具启动子代理时，**必须**根据任务类型指定 `model` 参数：

| 任务类型 | model 参数 | 适用场景 |
|----------|-----------|----------|
| 开发 | `opus` | 编写/修改业务代码、架构设计、复杂调试、性能优化 |
| 代码审查 | `sonnet` | 代码质量分析、安全审查、PR Review、模块边界合规检查 |
| 测试编写 | `sonnet` | 编写测试用例（需要理解业务逻辑） |
| 测试执行 | `haiku` | 运行测试、生成覆盖率报告 |
| 文档 | `haiku` | 编写/更新文档、API 文档、注释 |
| 探索 | `haiku` | 代码库搜索、文件查找、结构分析 |

### 角色 → 实际调用映射

每个角色对应 Task 工具的具体参数，主代理**必须**按此表构造调用：

| 角色 | subagent_type | model | prompt 关键指令 |
|------|--------------|-------|----------------|
| auth-dev | `general-purpose` | `opus` | "你是认证授权模块开发。范围限定 `fd-server/**/auth/**`。关注 JWT 安全、RBAC 权限模型、用户生命周期、密码策略、会话管理。不得直接依赖 ticket 模块的任何类。" |
| task-dev | `general-purpose` | `opus` | "你是任务调度模块开发。范围限定 `fd-server/**/task/**`。关注多客户端并发安全、原子任务领取、超时回收、定时任务调度。可依赖 auth 模块的权限注解/接口和 common 模块。不得依赖 ticket 模块。" |
| ticket-dev | `general-purpose` | `opus` | "你是工单业务模块开发。范围限定 `fd-server/**/ticket/**`。关注工单状态流转正确性、MQ 消息可靠投递、事务一致性。可依赖 auth 模块的公开 Service/DTO 和 task 模块的 TaskDistributionService，不得操作 auth/task 内部实现。" |
| common-dev | `general-purpose` | `opus` | "你是公共模块开发。范围限定 `fd-server/**/common/**`。关注通用工具类、公共配置、全局异常处理。不得依赖任何业务模块（auth/ticket）。" |
| frontend-dev | `general-purpose` | `opus` | "你是 React/TypeScript 前端开发。范围限定 `fd-web/src/**`。关注：1) `shared/` 目录（REST 轮询任务 Context、AI Provider、Hooks、API 封装）为跨平台通用代码；2) `tauri/` 目录仅 4 个文件（bridge.ts + NotebookLM Shadow）为 Tauri 桌面专属；3) `isTauriEnv()` + `tauriInvoke()` 条件桥接模式；4) `createMQTaskContext` 工厂函数基于 REST 轮询 claim API（非 Tauri 事件）；5) `useSettings` 通过 UserAppSettings API 存储到服务端。" |
| rust-dev | `general-purpose` | `opus` | "你是 Tauri/Rust 客户端后端开发。范围限定 `fd-client/src-tauri/src/**`（仅 4 个文件：lib.rs, ai.rs, models.rs, api.rs）。Rust 层已精简为纯壳子：16 个 Tauri command（AI 翻译 2 + 文件系统 2 + Shadow Window 12），无 MQ 消费、无本地数据库、无设置存储。关注 Gemini CLI 调用可靠性、Shadow Window 生命周期管理。" |
| architect | `Plan` | `opus` | （Plan 模式自动获取上下文，用于跨模块设计、数据流优化、技术选型、状态机扩展、模块边界设计） |
| debugger | `general-purpose` | `opus` | "你是跨层调试专家。负责定位 Rust↔React↔Server 问题、MQ 消息丢失排查、Shadow Window 时序问题、模块间依赖错误。输出：根因分析 + 修复建议。" |
| code-reviewer | `general-purpose` | `sonnet` | "你是代码审查者。重点关注 OWASP Top 10（JWT 安全、SQL 注入、XSS）、最佳实践、重复代码。**额外关注模块边界合规**：检查 import 是否违反依赖规则（common ← auth ← task ← ticket），auth 模块是否引用了 ticket 的类，common 是否引用了业务模块的类。输出：问题列表（按严重级别排序）+ 修复建议。" |
| module-guardian | `general-purpose` | `sonnet` | "你是模块化守护者。检查 fd-server 的模块边界合规性。检查项：1) 依赖方向合规（common ← auth ← task ← ticket，不可反向）；2) 无循环依赖；3) auth 模块的 import 不包含 ticket 包的类；4) common 模块的 import 不包含 auth/ticket 包的类；5) 包结构是否正确归属模块。输出：违规列表 + 修复建议。" |
| test-runner | `Bash` | `haiku` | 直接执行测试命令（见下方测试命令表） |
| test-writer | `general-purpose` | `sonnet` | "你是测试工程师。后端用 JUnit 5 + Spring Boot Test（`fd-server/src/test/java/**`），Rust 用 `#[cfg(test)]`，前端用 Vitest + RTL。关注工单状态流转边界、MQ 序列化/反序列化、API 权限校验。测试类的包结构应与源码模块结构一致（auth/ticket/common）。" |
| doc-writer | `general-purpose` | `haiku` | "你是文档工程师。范围 `doc/**` + 代码内注释。中文撰写，遵循 `doc/` 目录现有风格。" |

**测试命令表**（test-runner 使用）：

| 模块 | 命令 |
|------|------|
| 后端全量 | `cd fd-server && mvn test` |
| 后端 auth 模块 | `cd fd-server && mvn test -Dtest="com.jefflower.fdserver.auth.**"` |
| 后端 ticket 模块 | `cd fd-server && mvn test -Dtest="com.jefflower.fdserver.ticket.**"` |
| 后端 task 模块 | `cd fd-server && mvn test -Dtest="com.jefflower.fdserver.task.**"` |
| Rust | `cd fd-client/src-tauri && cargo test` |
| 前端 | `cd fd-web && npm test` |
| 前端覆盖率 | `cd fd-web && npm run test:coverage` |
| 前端构建 | `cd fd-web && npm run build` |
| 前端类型检查 | `cd fd-web && npx tsc --noEmit` |

### 主代理编排协议

主代理（即对话中的顶层 Claude 实例）同时承担**管理者**角色，在调度子代理执行之前和之后，**必须**完成以下管理职责：

#### Phase 0: 需求受理（每次用户请求必经）

收到用户请求后，主代理**必须先完成以下分析**，再进入决策树：

1. **需求澄清** — 请求是否明确？若存在歧义，用 `AskUserQuestion` 澄清，不得假设
2. **范围评估** — 判断涉及哪些层（server / React / Rust / 跨层），**以及涉及哪些业务模块（auth / ticket / common / 跨模块）**
3. **复杂度判断** — 按以下标准分级：
   - **简单**: 单文件改动、逻辑清晰、无依赖 → 直接执行，跳过任务拆解
   - **中等**: 2-5 个文件、单层单模块、有明确模式可参考 → 创建 TaskCreate 跟踪，走流程B
   - **复杂**: 跨层/跨模块、模糊需求、需要设计决策 → 完整任务拆解，走流程A/C/D/E
4. **任务拆解**（中等及以上）— 使用 `TaskCreate` 将需求拆解为可执行任务，每个任务须包含：
   - 明确的完成标准（什么状态算"做完"）
   - 涉及的文件/模块范围
   - 依赖关系（通过 `addBlockedBy` 设定）
5. **风险识别** — 是否涉及：状态机变更、MQ 消息格式变更、数据库 Schema 变更、安全相关改动、**模块边界变更**？若是，标记为高风险，流程中必须经过 architect 设计 + 用户确认

#### 后端 dev agent 选择规则

根据变更涉及的模块选择对应 dev agent：

| 变更范围 | 选择的 agent |
|---------|-------------|
| 仅 auth 模块 | auth-dev |
| 仅 task 模块 | task-dev |
| 仅 ticket 模块 | ticket-dev |
| 仅 common 模块 | common-dev |
| 跨 auth + task | auth-dev → task-dev（按依赖顺序串行） |
| 跨 task + ticket | task-dev → ticket-dev（按依赖顺序串行） |
| 跨 auth + ticket | auth-dev → ticket-dev（按依赖顺序串行） |
| 新模块创建 | architect 先设计 → 对应模块 dev |

#### Phase 1-N: 执行与跟踪

在各流程（A/B/C/D/E）执行期间，主代理**必须**：

- **阶段推进前**: 检查当前阶段的门控条件是否满足（见下方阶段门控表）
- **子代理返回后**: 用 `TaskUpdate` 更新任务状态，记录产出摘要
- **异常发生时**: 按「失败回退规则」处理，不得静默跳过

#### Phase Final: 完成确认

所有任务完成后，主代理**必须**：

1. 用 `TaskList` 确认所有任务状态为 `completed`
2. 向用户汇报：完成了什么、改了哪些文件、测试是否通过、是否有遗留风险
3. 若有遗留项（如文档未更新、测试覆盖不足），明确告知用户

#### 阶段门控表

每个阶段之间设置门控条件，**不满足则不得进入下一阶段**：

| 门控点 | 准入条件 | 适用流程 |
|--------|---------|---------|
| 探索 → 设计 | Explore 产出了涉及模块的文件清单和现有模式总结 | A, D, E |
| 设计 → 开发 | architect 方案已获用户确认；API 契约、数据结构已明确 | A, D, E |
| 开发 → 验证 | 所有 dev agent 已返回；代码已写入文件系统 | A, B, C, D, E |
| 验证 → 补充测试 | 现有测试全部通过；code-reviewer 无 P0/P1 问题 | A |
| 测试 → 文档 | 全部测试通过（含新增测试） | A, D |
| 诊断 → 修复 | debugger 输出了根因分析和涉及文件清单 | C |
| 模块抽取 → 依赖验证 | 代码已移动 + 编译通过 | E |
| 依赖验证 → 完成 | module-guardian 无违规 + 全量测试通过 | E |

### 工作流决策树

完成 Phase 0 需求受理后，主代理按以下逻辑选择工作流：

```
用户请求 → Phase 0 需求受理（澄清 + 范围 + 复杂度 + 拆解 + 风险）
  │
  ├─ 简单任务？ ──→ 直接执行，无需子代理
  │
  ├─ 是 Bug/异常？ ──→ 流程C: Bug 修复
  │
  ├─ 是模块化重构？ ──→ 流程E: 模块化重构
  │
  ├─ 是其他重构/优化？ ──→ 流程D: 重构优化
  │
  ├─ 判断变更范围
  │   ├─ 跨层（涉及 server + client 或 React + Rust）──→ 流程A: 全栈新功能
  │   └─ 单层 ──→ 流程B: 单层变更
  │
  └─ 无法判断？ ──→ Explore(haiku) 先探索，再重新进入决策树
```

### 流程A: 全栈新功能（跨层 + 新功能/需求）

```
Step 1: 探索
  Explore(haiku) × N 并行探索涉及模块（如 TicketService、TicketController、serverApi.ts）
  ── 门控 ──→ 产出文件清单 + 现有模式总结，否则补充探索

Step 2: 设计
  architect(opus/Plan) 设计方案，输出必须包含：
  - API 契约（端点、请求/响应结构）
  - MQ 消息格式（如涉及）
  - 数据模型变更（如涉及）
  - 各层任务分工和接口约定
  - **变更涉及的业务模块及依赖方向**
  → 用户确认方案
  ── 门控 ──→ 用户已确认 + 契约已明确，否则不得进入开发

Step 3: 并行开发（前提：Step 2 的契约已确定）
  主代理用 TaskCreate 为每个子任务创建跟踪项，然后同时启动（单条消息多个 Task 调用）：
  - auth-dev / ticket-dev / common-dev(opus) — 按模块分工实现后端（参照"后端 dev agent 选择规则"）
  - frontend-dev(opus) — 实现组件 + Hooks + API 调用
  - rust-dev(opus) — 实现 Tauri 命令（仅涉及 Rust 层时，如 AI 翻译或 Shadow Window 变更）
  子代理返回后，主代理用 TaskUpdate 更新各任务状态
  ── 门控 ──→ 所有 dev agent 已返回 + 代码已写入，否则等待

Step 4: 并行验证
  同时启动：
  - test-runner(haiku/Bash) — 运行现有测试确保无回归
  - code-reviewer(sonnet) — 审查代码质量、安全和模块边界合规
  ── 门控 ──→ 测试全通过 + 无 P0/P1 审查问题，否则进入「失败回退规则」

Step 5: 补充测试
  test-writer(sonnet) — 为新功能编写测试
  test-runner(haiku/Bash) — 运行新测试
  ── 门控 ──→ 新测试全部通过

Step 6: 文档（仅涉及 API 变更时）
  doc-writer(haiku) — 更新 API 文档

Step Final: 主代理用 TaskList 确认全部完成，向用户汇报产出摘要
```

### 流程B: 单层变更（仅后端 / 仅前端 / 仅 Rust）

```
Step 1: Explore(haiku) 探索相关文件
Step 2: 对应 dev agent(opus) 直接实现（简单变更可跳过 architect）
  后端变更按模块选择 auth-dev / ticket-dev / common-dev
  主代理用 TaskCreate 创建跟踪项
  ── 门控 ──→ 代码已写入
Step 3: test-runner(haiku/Bash) 验证
  ── 门控 ──→ 测试通过，否则 dev agent 修复（最多 2 轮）
Step 4: 若涉及 API 变更 → doc-writer(haiku)
Step Final: 主代理确认完成，向用户汇报
```

### 流程C: Bug 修复

```
Step 1: 诊断
  debugger(opus) 定位根因
  输出：根因分析 + 涉及文件 + 涉及模块 + 修复方向
  ── 门控 ──→ 根因已明确 + 涉及文件已列出，否则补充诊断

Step 2: 修复
  按模块选择对应 dev agent(opus) 实施修复
  主代理用 TaskCreate/TaskUpdate 跟踪
  ── 门控 ──→ 修复代码已写入

Step 3: 防回归
  并行启动：
  - test-writer(sonnet) — 补充回归测试（覆盖此 Bug 场景）
  - test-runner(haiku/Bash) — 运行全量测试
  ── 门控 ──→ 全量测试通过 + 回归测试覆盖了 Bug 场景

Step 4: 验证
  code-reviewer(sonnet) — 审查修复是否引入新问题
  ── 门控 ──→ 无新问题，否则回到 Step 2

Step Final: 主代理确认完成，向用户汇报（含根因、修复方案、测试覆盖）
```

### 流程D: 重构优化

```
Step 1: 全面分析
  Explore(haiku) × N 并行分析现有实现
  ── 门控 ──→ 产出现有实现的结构总结和问题点

Step 2: 设计
  architect(opus/Plan) 设计重构方案
  → 用户确认方案（重构风险较高，必须确认）
  ── 门控 ──→ 用户已确认方案

Step 3: 执行
  按模块选择对应 dev agent(opus) 实施重构
  主代理用 TaskCreate/TaskUpdate 跟踪
  ── 门控 ──→ 重构代码已写入

Step 4: 全量验证（重构必须跑全量测试）
  并行启动：
  - test-runner(haiku/Bash) — 后端 + 前端 + Rust 全部测试
  - module-guardian(sonnet) — 检查模块边界合规
  ── 门控 ──→ 全量测试通过 + 无模块边界违规，否则 dev agent 修复后重跑（最多 2 轮）

Step 5: 审查
  code-reviewer(sonnet) — 重点关注行为一致性 + 模块边界
  ── 门控 ──→ 无行为变更问题

Step Final: 主代理确认完成，向用户汇报（含重构范围、行为一致性确认、测试结果）
```

### 流程E: 模块化重构（将现有代码拆分到模块）

```
Step 1: 探索
  Explore(haiku) × N 分析待抽取模块的代码分布和依赖关系
  输出：涉及文件清单、当前 import 依赖图、耦合点
  ── 门控 ──→ 产出文件清单 + 依赖分析，否则补充探索

Step 2: 设计
  architect(opus/Plan) 设计模块边界 + 依赖规则 + 迁移步骤
  输出必须包含：
  - 哪些类移入新模块
  - 模块公开接口（哪些 Service/DTO 可被外部依赖）
  - 需要解耦的耦合点及解耦方案
  - 迁移顺序（先 common → 再目标模块 → 最后调整引用方）
  → 用户确认方案
  ── 门控 ──→ 用户已确认方案

Step 3: 公共基础
  common-dev(opus) — 建立/完善公共模块（通用异常、公共 DTO、工具类）
  ── 门控 ──→ 公共模块就绪 + 编译通过

Step 4: 模块抽取
  对应模块 dev agent(opus) 执行抽取（如 auth-dev 抽取认证模块）
  - 移动文件到新包结构
  - 修正所有 import
  - 调整引用方代码
  ── 门控 ──→ 代码已移动 + 编译通过

Step 5: 依赖验证
  并行启动：
  - module-guardian(sonnet) — 检查模块边界合规（import 方向、循环依赖）
  - test-runner(haiku/Bash) — 全量测试（确保行为不变）
  ── 门控 ──→ 无依赖违规 + 全量测试通过，否则对应 dev agent 修复（最多 2 轮）

Step 6: 审查
  code-reviewer(sonnet) — 重点关注行为一致性 + 模块边界 + import 清洁度
  ── 门控 ──→ 无问题

Step Final: 主代理确认完成，向用户汇报（含迁移范围、模块边界验证结果、测试结果）
```

### 失败回退规则

主代理在验证步骤遇到失败时，**必须**按以下规则处理，不得跳过：

| 失败类型 | 处理方式 | 最大重试 |
|---------|---------|---------|
| 测试失败 | 原 dev agent(opus) 修复 → test-runner 重跑 | 2 轮 |
| 审查发现安全问题 | 立即停止流程，原 dev agent(opus) 修复 → code-reviewer 重审 | 2 轮 |
| 构建失败 | debugger(opus) 定位 → dev agent(opus) 修复 | 2 轮 |
| 模块边界违规 | module-guardian 输出违规详情 → 对应 dev agent(opus) 修复 → module-guardian 重检 | 2 轮 |
| 并行产出冲突 | architect(opus/Plan) 协调合并策略 → dev agent 调整 | 1 轮 |
| 超过最大重试 | 停止自动流程，向用户报告问题详情，等待人工决策 | — |

### 并行执行约束

以下规则约束何时可以并行、何时必须串行：

**可以并行的组合：**
- 多个 Explore agent（探索不同模块）
- 不同层的 dev agents（如 auth-dev + frontend-dev + rust-dev）
- test-runner + code-reviewer + module-guardian（互不依赖）
- doc-writer + test-writer（互不依赖）

**必须串行的依赖：**
- architect → dev agents（开发必须基于确认后的设计方案）
- dev agents → test-runner（测试必须在代码写完后）
- debugger → dev agent（修复必须基于诊断结论）
- 所有开发/测试 → doc-writer（文档必须反映最终实现）
- **模块化重构中**：common-dev → auth-dev → task-dev → ticket-dev（按依赖层级顺序，底层先行）

**特殊约束：**
- debugger 是阻塞性的：触发后暂停其他工作流，直到诊断完成
- 全量测试失败后，不得启动 doc-writer（代码未稳定，文档会过时）
- 并行启动多个 dev agent 时，必须在同一条消息中发送多个 Task 调用
- **模块化重构中**，同一模块的抽取不可并行（避免包移动冲突），不同模块可并行
