# 项目结构地图

本文档提供了 `FD-AutoPilot` 代码库的详细地图，帮助 AI 代理和开发人员理解文件和目录的组织结构。

## 根目录（`/`）
- `data/`: 持久化数据存储目录（H2 数据库文件）。
- `doc/`: 项目文档。
    - `api-reference.md`: HTTP API 端点和用法说明。
    - `client-architecture.md`: Tauri + React 客户端详细说明。
    - `project-documentation.md`: 高层概览和项目入口。
    - `project-structure.md`: 本文件。
    - `server-architecture.md`: Spring Boot 服务端详细说明。
    - `system-design.md`: 综合系统设计文档（数据库模式、状态流转、MQ 设计）。
- `fd-client/`: 前端/客户端应用（Tauri + React）。
- `fd-server/`: 后端/服务端应用（Spring Boot）。

## 客户端应用（`fd-client/`）
基于 **Tauri v2**、**React 19**、**TypeScript** 和 **TailwindCSS** 构建。

### `src-tauri/` Rust 后端
- `src/lib.rs`: 主入口点。注册所有 Tauri 命令（`#[tauri::command]`）。`MqConsumerHolder` 共用结构体和 `MqTranslateState`/`MqReplyState` 新类型包装器。通用辅助函数：`start_consumer_inner`、`stop_consumer_inner`、`get_consumer_status_inner`、`complete_task_inner`。
- `src/main.rs`: 应用程序引导。
- `src/mq_consumer.rs`: 统一 RabbitMQ 消费者。`handle_message()` 框架支持 `parse_fn`/`build_payload` 闭包。`submit_via_frontend()` 通用函数。`RunGuard` 用于安全的 `is_running` 清理和多级停止检查。
- `src/ai.rs`: Gemini CLI 翻译引擎（`GeminiClient::translate_ticket`）。
- `src/api.rs`: Freshdesk HTTP 客户端（本地直连用于同步）。
- `src/models.rs`: 共享数据模型（Ticket、Conversation 等）。
- `src/settings.rs`: 设置管理（持久化到磁盘 JSON 文件）。
- `tauri.conf.json`: Tauri 配置（窗口、权限、CSP、bundles）。
- `Cargo.toml`: Rust 依赖（lapin、reqwest、serde、tokio）。

### `src/` 前端源代码

#### 入口点
- `main.tsx`: React 入口点。
- `App.tsx`: 主布局、Context Provider 包裹（`MQTranslationProvider`、`MQReplyProvider`、`MQAuditProvider`）、Tab 路由、侧边栏。

#### 组件（`components/`）
- `Common.tsx`: 共用 UI 组件库。
- `SidebarNew.tsx`: 主导航侧边栏。
- `SettingsTab.tsx`: 设置管理（MQ 配置、NotebookLM 配置）。
- **`server/`** — 服务端模式任务组件：
    - `ServerTicketDetail.tsx`: 工单详情工作区，包含 AI 操作按钮（~600 行）。
    - **`ticket-detail/`** — 从 ServerTicketDetail 提取的子组件：
        - `TranslationPreviewBar.tsx`: 翻译确认条。
        - `AiReplyPanel.tsx`: AI 回复流式显示 + 双语切换 + 保存/丢弃。
        - `ReplyHistoryPanel.tsx`: 回复历史列表 + 内联审核控件。
    - `ServerTicketList.tsx`: 分页工单列表，带过滤器。
    - `ServerTicketsTab.tsx`: 工单 Tab 容器。
    - `ServerTaskWorkspace.tsx`: 多标签页任务工作区（自动关闭成功标签页，保留失败标签页）。
    - `TranslationTasksTab.tsx`: MQ 翻译任务管理（左面板 + 工作区）。
    - `ReplyTasksTab.tsx`: MQ 回复任务管理（无并发配置，仅串行模式）。
    - `AuditTasksTab.tsx`: 审核任务管理（卡片内联审核，一键通过/驳回）。
    - `ApprovedTasksTab.tsx`: 已批准工单队列（手动/批量推送到 Freshdesk，自动推送切换）。
- **`common/`** — 共享组件：
    - `FloatingTaskWidget.tsx`: 浮动任务状态指示器（显示活跃 MQ 任务）。
- **`admin/`** — 仅管理员组件：
    - `AdminUsersTab.tsx`: 用户管理（分页列表，状态/用户名过滤，批准、角色修改、密码重置、确认对话框）。
    - `ManualSyncTab.tsx`: 手动触发 Freshdesk 同步 + 自动推送切换。
    - `ServerLogsTab.tsx`: 服务端日志查看器。
    - `DatabaseTab.tsx`: 数据库查询面板。
    - `KnowledgeTab.tsx`: 知识库管理面板。
    - `SqlQueryPanel.tsx`: SQL 查询执行面板。
    - `H2ConsolePanel.tsx`: H2 数据库控制台面板。
- **`auth/`** — 身份验证：
    - `AuthLoginTab.tsx`: 登录表单。
    - `AuthRegisterTab.tsx`: 注册表单。
- **`user/`** — 用户组件：
    - `UserProfileTab.tsx`: 用户个人资料。

#### Context 提供者（`context/`）
- `createMQTaskContext.tsx`: 通用工厂函数，从 `MQTaskConfig` 生成 Context + Provider + Hook。处理事件监听、去重、任务调度（并行/串行）、完成历史、消费者控制。
- `MQTranslationContext.tsx`: 基于工厂创建的薄层包装，使用 `concurrencyMode: 'parallel'`、`defaultBatchSize: 5`。
- `MQReplyContext.tsx`: 基于工厂创建的薄层包装，使用 `concurrencyMode: 'serial'`、`defaultBatchSize: 1`，通过 `onStreamChunk` 实现流式文本桥接。
- `MQAuditContext.tsx`: 基于工厂创建的薄层包装，用于审核任务管理。

#### Hooks（`hooks/`）
- `useAuth.ts`: JWT 身份验证状态（登录、注册、Token 存储）。
- `useSettings.ts`: 应用程序设置（MQ、NotebookLM、API 密钥）。
- `useAiReply.ts`: AI 回复生成 Hook（Shadow Window → NotebookLM）。支持 `onStreamChunk`、`onParsed`、`onPromptReady` 回调。
- `useAiTranslation.ts`: AI 翻译 Hook（Rust Gemini CLI）。支持 `onStatusChange`、`onError` 回调。
- `useNotebookShadow.ts`: Shadow 窗口可见性状态。
- `useTicketProcess.ts`: 全局工单处理状态（`status`、`tempTranslation`、`tempAiReply`、`streamingText`）。模块级变量 + 监听器模式。
- 相关测试文件：`useAuth.test.ts`。

#### AI 提供者抽象（`ai/`）
- `types.ts`: 提供者接口（`AiTranslationProvider`、`AiReplyProvider`）和共享类型。
- `index.ts`: 工厂函数（`getTranslationProvider`、`getReplyProvider`）+ 重新导出。
- `parseUtils.ts`: 共享 JSON 解析工具（后向 `]` 搜索、正则表达式回退）。
- **`providers/`**:
    - `geminiTranslationProvider.ts`: `GeminiTranslationProvider` — 包装 Rust `translate_ticket_direct_cmd` 调用。
    - `notebookLMReplyProvider.ts`: `NotebookLMReplyProvider` — 使用流式处理和 JSON 解析包装 `NotebookShadowService`。
- 相关测试文件：`index.test.ts`、`parseUtils.test.ts`。

#### 服务（`services/`）
- `notebookShadow.ts`: **核心服务**。NotebookLM Shadow Window（混合 observer + relay 架构 v3）。DOM 选择器集中在 `SELECTORS` 常量中管理。
- `serverApi.ts`: `fd-server` 的 REST API 客户端。
- 相关测试文件：`serverApi.test.ts`。

#### 常量（`constants/`）
- `agentMap.ts`: Freshdesk Agent ID → 名称映射（单一真实来源）。

#### 类型（`types/`）
- `types.ts`: 本地数据类型（工单、对话用于离线模式）。
- `server.ts`: 服务端 API 类型（ServerTicket、TicketTranslation、TicketReply 等）。

#### 工具函数（`utils/`）
- `statusLabels.ts`: 工单状态标签和显示名称映射。
- 相关测试文件：`statusLabels.test.ts`。

#### 国际化（`i18n/`）
- `config.ts`: i18n 配置文件。
- `types.ts`: 国际化类型定义。
- `locales/{zh-CN,en-US}/`: 语言包目录，包含 `common.json`、`auth.json`、`tickets.json`、`tasks.json`、`admin.json`、`settings.json`。

#### 测试（`test/`）
- `setup.ts`: 测试环境设置。
- `tauriMock.ts`: Tauri API 模拟。
- `renderHelper.tsx`: React 测试工具函数。

#### 其他
- `index.css`: 全局样式。
- `main.tsx`: TypeScript 入口配置。
- `vite-env.d.ts`: Vite 环境类型定义。

## 服务端应用（`fd-server/`）
基于 **Spring Boot 3.4**、**Java 21**、**H2 数据库** 和 **RabbitMQ** 构建。

### `src/main/java/com/jefflower/fdserver/`
- `FdServerApplication.java`: 主 Spring Boot 应用程序类。

#### 配置（`config/`）
- `RabbitMQConfig.java`: 队列、交换机、路由键、DLQ 设置。
- `SecurityConfig.java`: Spring Security 设置（JWT 过滤器、CORS、端点权限）。
- `RestTemplateConfig.java`: HTTP 客户端配置。

#### 客户端（`client/`）
- `FreshdeskApiClient.java`: Freshdesk API 调用封装。

#### 控制器（`controller/`）
- `AuthController.java`: 登录/注册端点。
- `TicketController.java`: 工单 CRUD、翻译/回复/审核提交、AI 触发、推送回复、批量推送。
- `AdminController.java`: Freshdesk 同步、用户管理（分页查询、批准、角色修改、密码重置）、同步配置管理。
- `ConfigController.java`: 系统配置端点（自动推送切换、企业微信 Webhook）。
- `DatabaseController.java`: 数据库查询和管理端点。
- `KnowledgeController.java`: 知识库管理端点。
- `WebhookController.java`: Webhook 接收端点（用于外部事件触发）。
- `RequestController.java`: 调试端点（记录原始客户端请求）。

#### 数据传输对象（`dto/`）
- `LoginRequest.java`, `LoginResponse.java`: 身份验证 DTO。
- `RegisterRequest.java`: 注册 DTO。
- `TranslationRequest.java`: 翻译提交（`targetLang`、`translatedTitle`、`translatedContent`）。
- `ReplyRequest.java`: 回复提交（`zhReply`、`targetReply`）。
- `AuditRequest.java`: 审核提交（`replyId`、`auditResult`、`auditRemark`）。
- `ValidRequest.java`: 工单有效性切换（`isValid`）。
- `BatchValidRequest.java`: 批量工单有效性切换。
- `ApproveRequest.java`: 用户批准请求。
- `ApiResponse.java`: 通用 API 响应包装器。
- `TicketContent.java`: 解析的工单内容 DTO。
- `KnowledgeNoteRequest.java`: 知识库笔记请求。
- `SqlQueryRequest.java`: SQL 查询请求。
- `SqlQueryResult.java`: SQL 查询结果。
- `TableInfo.java`: 表信息 DTO。

#### 实体（`entity/`）
- `Ticket.java`: 主工单记录（与翻译和回复有 `@OneToMany` 关系）。
- `TicketTranslation.java`: 翻译详情。
- `TicketReply.java`: 草稿回复。
- `TicketAudit.java`: 审核历史记录。
- `SysUser.java`: 用户账户（`password` 字段 `@JsonIgnore`）。
- `SystemConfig.java`: 系统配置键值对（自动推送、企业微信 Webhook）。
- `SyncConfig.java`: 同步配置（cron 表达式、启用标志）。
- `SyncLog.java`: 同步执行历史日志。
- `KnowledgeNote.java`: 知识库笔记。
- `FailedReplyPush.java`: 失败的回复推送记录。

#### 仓库（`repository/`）
- `TicketRepository.java`, `TicketTranslationRepository.java`, `TicketReplyRepository.java`, `TicketAuditRepository.java`
- `SysUserRepository.java`, `SystemConfigRepository.java`
- `SyncConfigRepository.java`, `SyncLogRepository.java`
- `KnowledgeNoteRepository.java`, `FailedReplyPushRepository.java`
- `ClientRequestRepository.java`

#### 服务（`service/`）
- `TicketService.java`: 工单工作流编排（状态转换、MQ 消息触发、APPROVED 推送逻辑）。
- `FreshdeskService.java`: Freshdesk API 同步（通过 `updated_since` 增量同步）。
- `FreshdeskSyncService.java`: Freshdesk 同步服务（新同步架构）。
- `MqPublisherService.java`: RabbitMQ 消息发布（回复负载中包含 `auditRemark`）。
- `MqQueueService.java`: MQ 队列管理服务。
- `AuthService.java`: 用户身份验证、注册、分页用户查询（状态/用户名过滤）、角色管理、密码重置。
- `SyncConfigService.java`: 同步配置管理。
- `SystemConfigService.java`: 系统配置 CRUD（自动推送切换、企业微信 Webhook）。
- `WeChatWorkNotifyService.java`: 企业微信 Webhook 通知（审核通过/驳回、回复已推送）。
- `KnowledgeService.java`: 知识库服务。
- `DatabaseQueryService.java`: 数据库查询服务。
- `ReplyPushService.java`: 回复推送服务。

#### 调度器（`scheduler/`）
- `SyncScheduler.java`: Cron-based Freshdesk 同步调度器。
- `ReplyPushRetryScheduler.java`: 回复推送重试调度器。

#### 安全（`security/`）
- `JwtUtil.java`: JWT 令牌生成和验证。
- `JwtAuthenticationFilter.java`: Spring Security JWT 身份验证过滤器。

#### 模型（`model/`）
- `ClientRequest.java`: 客户端请求模型（用于调试和审计）。

## 关键配置文件
- `fd-server/src/main/resources/application.yml`: 服务端配置（H2 路径、RabbitMQ、Freshdesk、JWT）。
- `fd-client/src-tauri/tauri.conf.json`: 客户端窗口和能力配置。
- `fd-client/src-tauri/Cargo.toml`: Rust 依赖。
- `fd-client/package.json`: Node.js 依赖和前端脚本。
- `fd-client/vite.config.ts`: Vite 构建配置。
- `fd-client/tsconfig.json`: TypeScript 配置。
- `fd-client/vitest.config.ts`: Vitest 测试框架配置。

## Enums（枚举）

### 后端 Enums（`enums/`）
- `TicketStatus.java`: 工单状态（`PENDING_TRANS`、`TRANSLATING`、`PENDING_REPLY`、`REPLYING`、`PENDING_AUDIT`、`AUDITING`、`APPROVED`、`COMPLETED`）。
- `UserRole.java`: 用户角色（`ADMIN`、`USER`）。
- `UserStatus.java`: 用户状态（`PENDING`、`APPROVED`、`REJECTED`）。
- `AuditResult.java`: 审核结果（`PASS`、`REJECT`）。
- `SyncStatus.java`: 同步执行状态。
- `TriggerType.java`: 同步触发类型（`CRON`、`MANUAL`）。

## 前端项目结构概览

### 目录树
```
fd-client/
├── src/                                    # 前端 React 源代码
│   ├── App.tsx                             # 主应用程序（入口、路由、Provider 包裹）
│   ├── main.tsx                            # React 应用启动
│   ├── index.css                           # 全局样式
│   ├── vite-env.d.ts                       # Vite 类型定义
│   ├── types.ts                            # 本地数据类型
│   ├── types/
│   │   └── server.ts                       # 服务端 API 类型
│   ├── ai/                                 # AI 提供者抽象层
│   │   ├── types.ts                        # 接口定义
│   │   ├── index.ts                        # 工厂函数
│   │   ├── parseUtils.ts                   # JSON 解析工具
│   │   ├── providers/
│   │   │   ├── geminiTranslationProvider.ts
│   │   │   └── notebookLMReplyProvider.ts
│   │   └── *.test.ts                       # 单元测试
│   ├── context/                            # React Context + Provider
│   │   ├── createMQTaskContext.tsx         # 工厂函数
│   │   ├── MQTranslationContext.tsx        # 翻译 Context
│   │   ├── MQReplyContext.tsx              # 回复 Context
│   │   └── MQAuditContext.tsx              # 审核 Context
│   ├── hooks/                              # React Custom Hooks
│   │   ├── useAuth.ts
│   │   ├── useSettings.ts
│   │   ├── useAiTranslation.ts
│   │   ├── useAiReply.ts
│   │   ├── useNotebookShadow.ts
│   │   ├── useTicketProcess.ts
│   │   └── *.test.ts
│   ├── services/
│   │   ├── notebookShadow.ts               # NotebookLM Shadow Window 核心
│   │   ├── serverApi.ts                    # 后端 API 客户端
│   │   └── *.test.ts
│   ├── constants/
│   │   └── agentMap.ts                     # Agent ID 映射
│   ├── utils/
│   │   ├── statusLabels.ts                 # 状态标签工具
│   │   └── *.test.ts
│   ├── i18n/                               # 国际化
│   │   ├── config.ts
│   │   ├── types.ts
│   │   └── locales/
│   │       ├── zh-CN/
│   │       └── en-US/
│   ├── components/
│   │   ├── Common.tsx                      # 共用 UI 组件
│   │   ├── SidebarNew.tsx                  # 导航侧边栏
│   │   ├── SettingsTab.tsx                 # 设置标签页
│   │   ├── auth/                           # 身份验证组件
│   │   │   ├── AuthLoginTab.tsx
│   │   │   └── AuthRegisterTab.tsx
│   │   ├── user/
│   │   │   └── UserProfileTab.tsx
│   │   ├── admin/                          # 管理员组件
│   │   │   ├── AdminUsersTab.tsx
│   │   │   ├── ManualSyncTab.tsx
│   │   │   ├── ServerLogsTab.tsx
│   │   │   ├── DatabaseTab.tsx
│   │   │   ├── KnowledgeTab.tsx
│   │   │   ├── SqlQueryPanel.tsx
│   │   │   └── H2ConsolePanel.tsx
│   │   ├── server/                         # 服务端模式组件
│   │   │   ├── ServerTicketsTab.tsx
│   │   │   ├── ServerTicketList.tsx
│   │   │   ├── ServerTicketDetail.tsx
│   │   │   ├── ServerTaskWorkspace.tsx
│   │   │   ├── TranslationTasksTab.tsx
│   │   │   ├── ReplyTasksTab.tsx
│   │   │   ├── AuditTasksTab.tsx
│   │   │   ├── ApprovedTasksTab.tsx
│   │   │   └── ticket-detail/
│   │   │       ├── TranslationPreviewBar.tsx
│   │   │       ├── AiReplyPanel.tsx
│   │   │       └── ReplyHistoryPanel.tsx
│   │   └── common/
│   │       └── FloatingTaskWidget.tsx
│   └── test/                               # 测试配置
│       ├── setup.ts
│       ├── tauriMock.ts
│       └── renderHelper.tsx
├── src-tauri/                              # Tauri/Rust 后端
│   ├── src/
│   │   ├── lib.rs                          # Tauri 命令主入口
│   │   ├── main.rs                         # 应用引导
│   │   ├── ai.rs                           # Gemini CLI 翻译
│   │   ├── api.rs                          # Freshdesk HTTP 客户端
│   │   ├── models.rs                       # 数据模型
│   │   ├── mq_consumer.rs                  # RabbitMQ 消费者
│   │   └── settings.rs                     # 设置管理
│   ├── tauri.conf.json                     # Tauri 配置
│   └── Cargo.toml                          # Rust 依赖
├── package.json                            # Node.js 依赖和脚本
├── tsconfig.json                           # TypeScript 配置
├── vite.config.ts                          # Vite 构建配置
├── vitest.config.ts                        # Vitest 测试配置
└── index.html                              # HTML 入口
```

## 后端项目结构概览

### 目录树
```
fd-server/
├── src/main/java/com/jefflower/fdserver/
│   ├── FdServerApplication.java            # Spring Boot 应用主类
│   ├── config/
│   │   ├── RabbitMQConfig.java
│   │   ├── SecurityConfig.java
│   │   └── RestTemplateConfig.java
│   ├── client/
│   │   └── FreshdeskApiClient.java
│   ├── controller/
│   │   ├── AuthController.java
│   │   ├── TicketController.java
│   │   ├── AdminController.java
│   │   ├── ConfigController.java
│   │   ├── DatabaseController.java
│   │   ├── KnowledgeController.java
│   │   ├── WebhookController.java
│   │   └── RequestController.java
│   ├── dto/
│   │   ├── LoginRequest.java
│   │   ├── LoginResponse.java
│   │   ├── RegisterRequest.java
│   │   ├── TranslationRequest.java
│   │   ├── ReplyRequest.java
│   │   ├── AuditRequest.java
│   │   ├── ValidRequest.java
│   │   ├── BatchValidRequest.java
│   │   ├── ApproveRequest.java
│   │   ├── ApiResponse.java
│   │   ├── TicketContent.java
│   │   ├── KnowledgeNoteRequest.java
│   │   ├── SqlQueryRequest.java
│   │   ├── SqlQueryResult.java
│   │   └── TableInfo.java
│   ├── entity/
│   │   ├── Ticket.java
│   │   ├── TicketTranslation.java
│   │   ├── TicketReply.java
│   │   ├── TicketAudit.java
│   │   ├── SysUser.java
│   │   ├── SystemConfig.java
│   │   ├── SyncConfig.java
│   │   ├── SyncLog.java
│   │   ├── KnowledgeNote.java
│   │   └── FailedReplyPush.java
│   ├── enums/
│   │   ├── TicketStatus.java
│   │   ├── UserRole.java
│   │   ├── UserStatus.java
│   │   ├── AuditResult.java
│   │   ├── SyncStatus.java
│   │   └── TriggerType.java
│   ├── repository/
│   │   ├── TicketRepository.java
│   │   ├── TicketTranslationRepository.java
│   │   ├── TicketReplyRepository.java
│   │   ├── TicketAuditRepository.java
│   │   ├── SysUserRepository.java
│   │   ├── SystemConfigRepository.java
│   │   ├── SyncConfigRepository.java
│   │   ├── SyncLogRepository.java
│   │   ├── KnowledgeNoteRepository.java
│   │   ├── FailedReplyPushRepository.java
│   │   └── ClientRequestRepository.java
│   ├── service/
│   │   ├── TicketService.java
│   │   ├── FreshdeskService.java
│   │   ├── FreshdeskSyncService.java
│   │   ├── MqPublisherService.java
│   │   ├── MqQueueService.java
│   │   ├── AuthService.java
│   │   ├── SyncConfigService.java
│   │   ├── SystemConfigService.java
│   │   ├── WeChatWorkNotifyService.java
│   │   ├── KnowledgeService.java
│   │   ├── DatabaseQueryService.java
│   │   └── ReplyPushService.java
│   ├── scheduler/
│   │   ├── SyncScheduler.java
│   │   └── ReplyPushRetryScheduler.java
│   ├── security/
│   │   ├── JwtUtil.java
│   │   └── JwtAuthenticationFilter.java
│   └── model/
│       └── ClientRequest.java
├── src/main/resources/
│   └── application.yml                     # 应用配置（H2、RabbitMQ、Freshdesk）
├── pom.xml                                 # Maven 依赖配置
└── mvn test                                # 运行测试命令
```

## 关键职责分配

### 前端源代码（`fd-client/src/`）
- **路由与布局**: `App.tsx` → `SidebarNew.tsx` + 各标签页组件
- **身份验证**: `AuthLoginTab.tsx`, `AuthRegisterTab.tsx` + `useAuth.ts`
- **AI 工作流**:
  - 翻译: `TranslationTasksTab.tsx` → `MQTranslationContext` → `useAiTranslation` → `GeminiTranslationProvider`
  - 回复: `ReplyTasksTab.tsx` → `MQReplyContext` → `useAiReply` → `NotebookLMReplyProvider` → `notebookShadow.ts`（Shadow Window）
  - 审核: `AuditTasksTab.tsx` → `MQAuditContext` → 内联审核卡片
- **管理功能**: `AdminUsersTab.tsx` + `ManualSyncTab.tsx` + `DatabaseTab.tsx` + `ServerLogsTab.tsx`

### 后端源代码（`fd-server/src/`）
- **工单流程**: `TicketService.java` → 状态转换 → `MqPublisherService` → RabbitMQ
- **Freshdesk 同步**: `FreshdeskSyncService.java` / `FreshdeskService.java` → `FreshdeskApiClient`
- **MQ 任务分发**: `RabbitMQConfig` → 队列配置 + `MqQueueService`
- **用户管理**: `AuthService.java` + `AdminController` → 分页、批准、角色修改
- **系统配置**: `SystemConfigService.java` → 自动推送、企业微信

### Rust 后端（`fd-client/src-tauri/src/`）
- **Tauri 命令入口**: `lib.rs` → 注册所有命令、`MqConsumerHolder`
- **MQ 消费**: `mq_consumer.rs` → 通用 `handle_message()` 框架 → 翻译/回复/审核任务
- **翻译引擎**: `ai.rs` → `GeminiClient::translate_ticket()` → Gemini CLI 调用
- **Freshdesk API**: `api.rs` → 本地同步和数据获取
- **设置与存储**: `settings.rs` + 本地 JSON 持久化
