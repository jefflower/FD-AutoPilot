# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 架构理念

FD-AutoPilot 是 **Agent 驱动的工作流自动化平台**，通过 BPMN 工作流编排 AI Agent 实现业务自动化。

**三大原则：**
- **Agent 即插件** — AgentDefinition 声明式注册，Executor 封装执行逻辑，providerConfig 配置驱动。新增 Agent 不改框架代码
- **工作流即编排** — Flowable BPMN 流程定义决定 Agent 执行顺序、并行/串行、条件分支、异常处理。运营可通过 BpmnEditor 可视化编辑
- **Executor 是运行时** — 4 种通用 Executor（CLI/HTTP_API/Shadow/Function），ShadowExecutor 支持从 providerConfig 加载自动化脚本，零代码新增浏览器操作类 Agent

**开发红线：**
- 新增 Agent 必须通过 AgentDefinition + Executor 配置驱动，禁止在业务 Hook 中硬编码 Agent 调用
- 新增业务流程必须用 BPMN 节点编排，禁止在代码中硬编码状态转换
- Agent prompt 中的输入参数使用 `${PARAM_NAME}` 标准模板，从 AgentExecuteInput.data 的字段名直接取值
- Flowable 是唯一的工作流引擎，所有编排逻辑经由 BPMN 流程 → JavaDelegate → TaskInstance/BusinessCallback
- **Agent 禁止管理 UI 状态** — Agent hooks 是纯执行函数（输入→输出），禁止调用 setProcessStatus 或任何全局状态管理。处理状态由任务生命周期和工作流驱动（见下方「自动化状态架构」）

## 项目概览

**FD-AutoPilot** 是一个智能工单处理系统，集成 Freshdesk 与 AI 能力（Google NotebookLM + Gemini CLI）来自动化翻译和回复生成。

### 子项目
- **fd-server**: Spring Boot 3.4.1 后端（Java 21），工单生命周期、Freshdesk 同步、RabbitMQ 异步消息、RBAC 权限、SPA 托管
- **fd-web**: React 19 前端（Vite 7 + TypeScript + TailwindCSS），独立 Web 应用，可在浏览器运行或嵌入 Tauri WebView
- **fd-client**: Tauri v2 桌面客户端（纯 Rust），提供 Gemini CLI 翻译和 Shadow Window 浏览器自动化
- **消息队列**: RabbitMQ 用于服务端异步消息，客户端通过 REST 轮询 task claim API 获取任务
- **数据库**: H2 文件数据库，Hibernate DDL `update` 自动建表

## 开发命令

### 服务端 (fd-server) — Maven 多模块
```bash
cd fd-server
mvn install -DskipTests && mvn spring-boot:run -pl fd-server-app  # 运行（端口 9988）
mvn test                               # 运行所有模块的测试
mvn test -pl fd-server-auth            # 仅运行 auth 模块测试
mvn test -pl fd-server-ticket          # 仅运行 ticket 模块测试
mvn clean package -DskipTests          # 跳过测试构建
```

### 前端 (fd-web)
```bash
cd fd-web
npm install                            # 安装依赖
npm run dev                            # Vite 开发服务器（端口 5173，代理 /api → localhost:9988）
npm run build                          # TypeScript 编译 + Vite 打包
npm test                               # Vitest 测试
npm run test:coverage                  # 覆盖率报告
npx tsc --noEmit                       # 仅类型检查
```

### 客户端 (fd-client) — 纯 Rust
```bash
cd fd-client
npm run tauri dev                      # Tauri 完整开发模式
npm run tauri build                    # 生产构建
cd src-tauri && cargo test             # Rust 测试
```

### 构建带前端的 Server 包
```bash
cd fd-server
mvn clean package -Pwith-frontend      # 自动构建 fd-web 并嵌入 jar（浏览器访问 localhost:9988）
```

**注意**: 前端没有 ESLint/Prettier，没有 CI/CD。测试框架 Vitest + React Testing Library。

## 核心架构

### 数据流
```
Freshdesk API ──(cron 15min)──→ fd-server ──(Flowable BPMN)──→ AgentTaskDelegate
                                  ↑                                    │
                                  │                          创建 TaskInstance
                                  │                                    │
                                  │                    fd-web (REST 轮询 claim + SSE 通知)
                                  │                                    │
                                  │                    ┌───────────────┴───────────────┐
                                  │                    │                               │
                                  │              浏览器模式                       Tauri 桌面模式
                                  │              (HTTP_API Agent)               (CLI/Shadow Agent)
                                  │                    │                               │
                                  └────── POST /api/v1/tickets/{id}/* ────────────────┘
                                              ↓
                              TaskCompletedEvent → WorkflowTaskBridge → signal ReceiveTask
                                              ↓
                              BusinessCallbackDelegate → 下一 BPMN 节点
```

### 工单状态流转（BPMN 驱动）
```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
```
审核分支：PASS + 自动推送 → COMPLETED | PASS + 手动推送 → APPROVED | REJECT → PENDING_REPLY | RETRANSLATE → PENDING_TRANS

MQ 队列（Exchange: `fd.ticket.task.exchange` TopicExchange）：
- `q.ticket.translation` / `q.ticket.reply` / `q.ticket.audit` / `q.ticket.dlq`

### BPMN 流程设计
标准工单流程（`ticket-standard-flow.bpmn20.xml`）：
- **并行网关**：翻译和回复同时执行（parallelGateway fork/join）
- **AgentTaskDelegate**：检查 executionEnv，CLIENT_ONLY 创建 TaskInstance + ReceiveTask 等待，SERVER_ONLY 直接执行
- **HumanTaskDelegate**：创建人工审核任务
- **BusinessCallbackDelegate**：调用 WorkflowCallbackRegistry 中注册的业务回调（解耦 workflow ↔ ticket）
- **审核网关**：exclusiveGateway 按 auditResult 分支（PASS → 结束，REJECT → 循环回 reply_agent）

### Agent 运行时
Agent 定义存储在后端 `ai_agent_definition` 表，前端通过 `AgentRegistry` 加载。

4 种 Executor：
| Executor | providerType | 环境 | 用途 |
|----------|-------------|------|------|
| CliExecutor | GEMINI_CLI | 仅 Tauri | Rust 调用 gemini CLI，providerConfig 含 systemPrompt 模板 |
| HttpApiExecutor | HTTP_API | 通用 | 后端代理调用 LLM API（OpenAI/Claude 等） |
| ShadowExecutor | WEB_AUTOMATION | 仅 Tauri | Shadow Window 浏览器自动化，providerConfig 加载脚本和选择器 |
| FunctionExecutor | LOCAL_FUNCTION | 通用 | 前端纯 JS 函数，规则引擎/模板填充 |

参数模板规范：providerConfig 中的 prompt 使用 `${TARGET_LANG}`、`${TICKET_CONTENT}` 等变量，通过 `resolveTemplate(template, variables)` 替换。变量名从 AgentExecuteInput.data 的字段名映射。

### 任务分发机制
- `POST /tasks/claim?type=ticket.translate&clientId=xxx&limit=5` — 原子领取
- `POST /tasks/{id}/complete` — 完成上报（触发 TaskCompletedEvent → WorkflowTaskBridge → signal ReceiveTask）
- 超时回收：每 30 秒检查，超时任务自动重试或标记 TIMEOUT
- SSE 推送：`GET /events/stream` 实时通知客户端新任务可用

### Rust ↔ React 通信（仅 Tauri 桌面模式）
- 条件桥接：`isTauriEnv()` + `tauriInvoke()` / `tauriListen()`（浏览器模式降级）
- Tauri 命令：AI 翻译 2 + 文件系统 2 + Shadow Window 12（详见 `fd-client/src-tauri/src/lib.rs`）
- Shadow Window：v3 混合 observer+relay 架构（详见 `fd-web/src/tauri/services/notebookShadow.ts`）

## 模块结构

### 后端 Maven 多模块

依赖链（箭头 = 可依赖方向）：`common ← auth ← task ← ai ← workflow ← ticket ← app`

| 模块 | artifactId | 包路径 | 核心职责 | 核心类 |
|------|-----------|--------|---------|--------|
| common | fd-server-common | ...common.* | 公共基础（DTO、异常、工具） | ApiResponse, SpaWebConfig, SqlValidator |
| auth | fd-server-auth | ...auth.* | JWT + RBAC + 权限自注册 | AuthController, AuthService, JwtUtil, SecurityConfig, ModulePermissionDefinition(SPI) |
| task | fd-server-task | ...task.* | 任务分发 + 定时调度 + SSE | TaskDistributionService, TaskController, EventStreamController, TaskRecoveryScheduler |
| ai | fd-server-ai | ...ai.* | Agent 定义/执行/绑定 + SPI | AgentDefinitionService, AgentDispatchService, AgentProvider(SPI), HttpApiAgentProvider |
| workflow | fd-server-workflow | ...workflow.* | Flowable BPMN 引擎集成 | WorkflowService, AgentTaskDelegate, HumanTaskDelegate, BusinessCallbackDelegate, WorkflowTaskBridge, WorkflowCallbackRegistry |
| ticket | fd-server-ticket | ...ticket.* | 工单业务 + Freshdesk + MQ | TicketService, FlowableTicketOrchestrator, FreshdeskSyncService, MqPublisherService, TicketStateMachine |
| app | fd-server-app | ...fdserver | 启动入口 + 资源 + 静态文件 | FdServerApplication |

### 前端 (fd-web/src/)

```
shared/
├── agents/              Agent 运行时
│   ├── AgentRegistry.ts     单例注册中心（加载定义+绑定，按 code/capability 解析）
│   ├── useAgent.ts          统一 Hook（execute/executeStream + 自动上报）
│   ├── AgentContext.tsx      AgentProvider（初始化注册 Executor + 加载定义）
│   ├── executors/            CliExecutor, HttpApiExecutor, ShadowExecutor, FunctionExecutor
│   └── helpers/              translationHelpers, replyHelpers, schemaUtils
├── context/             任务消费
│   ├── createMQTaskContext.tsx    通用 REST 轮询工厂（SSE 通知 + 兜底轮询）
│   ├── MQTranslation/Reply/AuditContext.tsx    三种任务 Context（配置差异化）
│   └── ServerEventsContext.tsx    SSE 连接管理（指数退避重连）
├── hooks/               业务 Hooks
│   ├── useAuth, useToast, useSettings
│   ├── useTicketProcess       全局工单处理状态
│   └── useAiTranslation, useAiReply    AI 任务委托 Agent 运行时
├── services/serverApi.ts     REST API 封装（JWT 自动刷新）
├── components/              通用组件（Sidebar, Toast, ErrorBoundary）
└── types/server.ts          所有后端类型定义

modules/                 业务页面
├── auth/                登录/注册
├── ticket/              工单列表/详情/翻译/回复/审核/已通过
├── admin/               用户/同步/知识库/数据库/Agent管理
├── workflow/            流程列表/BpmnEditor/流程引导
└── system/              设置/用户资料

tauri/                   桌面专属
├── bridge.ts            isTauriEnv() + tauriInvoke() 条件桥接
├── hooks/useNotebookShadow.ts    Shadow Window 控制（Web 降级 no-op）
└── services/            notebookShadow.ts, trackingShadow.ts
```

### 客户端 Rust (fd-client/src-tauri/src/)
4 个文件：`lib.rs`（16 Tauri commands）, `ai.rs`（Gemini CLI）, `models.rs`, `api.rs`

## API 端点索引

前缀: `/api/v1` | 认证: `Authorization: Bearer <token>` | 详细参数参考 `doc/api-reference.md`

| 分组 | 核心端点 | 权限 |
|------|---------|------|
| 认证 | POST /auth/login, /register | GET /auth/me/modules, /me/permissions | 公开/登录 |
| RBAC | GET/POST/PUT/DELETE /auth/roles, /permissions | SUPER_ADMIN |
| 工单 | GET /tickets | POST /tickets/{id}/translation, /reply, /audit, /push-reply, /skip-reply | 登录 |
| 同步 | POST /sync/freshdesk | GET /sync/config, /status, /logs | ADMIN |
| 用户管理 | GET /admin/users | POST .../approve | PUT .../role | ADMIN |
| 知识库 | CRUD /admin/knowledge/notes | GET .../export/tickets, /notes | ADMIN |
| 数据库 | POST /admin/database/query | GET .../tables | ADMIN |
| 任务 | POST /tasks/claim, /complete, /release | GET /tasks/mine | 登录 |
| 任务管理 | GET /task-admin/dashboard, /definitions, /history | ADMIN |
| Agent | GET /agents/definitions[/all/client/capability] | POST /agents/execute/{code} | ai:* |
| Agent 执行 | POST /agents/executions/report | GET /agents/executions, /stats | ai:* |
| Agent 绑定 | GET/PUT/DELETE /agents/bindings/{capability} | ai:manage |
| 工作流 | WorkflowController（流程部署/启动/查询/终止） | workflow:* |
| 设置 | GET/PUT/DELETE /user/settings/{appCode} | 登录 |
| 系统配置 | GET/PUT /config/auto-reply, /wecom-webhook | ADMIN |
| SSE | GET /events/stream | 登录 |
| Webhook | POST /webhook/freshdesk | 公开 |

## 数据模型

- **Ticket** (1→N) TicketTranslation, (1→N) TicketReply, (1→N) TicketAudit
- **Ticket.lastAuditRemark** — 最近审核驳回意见（注入 AI 回复提示词）
- **Ticket.isValid** — 知识库有效性标记
- **RBAC 五表**: SysUser → SysUserRole → SysRole → SysRolePermission → SysPermission + SysModule
- **SysUser** 状态: PENDING/APPROVED/REJECTED，默认 admin/admin123
- **SysModule** 5 个内置: auth, ticket, system, ai, workflow
- **SysRole** 内置: SUPER_ADMIN, ADMIN, USER, AUDITOR
- **SysPermission** 通过 `ModulePermissionDefinition` SPI 自动注册
- **SystemConfig** — 键值对（auto_reply_enabled, wecom_webhook_url, wecom_notify_enabled）
- **KnowledgeNote** — 知识库注意事项
- **SyncLog/SyncConfig** — 同步日志和配置
- **FailedReplyPush** — 推送失败重试记录
- **TaskDefinition** — 任务类型定义（executionMode: CLIENT_DISTRIBUTED/SERVER_SCHEDULED/SERVER_TRIGGERED）
- **TaskInstance** — 任务实例（status: PENDING/CLAIMED/COMPLETED/FAILED/TIMEOUT/CANCELLED）
- **UserAppSettings** — 用户应用设置（userId + appCode 唯一约束）
- **AgentDefinition** — Agent 定义（providerType, executionEnv, capability, providerConfig[JSON], inputSchema, outputSchema）
- **AgentExecution** — Agent 执行日志
- **AgentBinding** — 能力绑定（capability → agentCode）

## 配置

### 服务端
- 配置文件: `fd-server/fd-server-app/src/main/resources/application.yml`（.gitignore）
- H2 控制台: `/h2-console`（开发启用）

### 前端
- Vite: `fd-web/vite.config.ts`，端口 5173，代理 `/api` → `localhost:9988`
- 代码分割: React.lazy + manualChunks

### 客户端
- Tauri: `fd-client/src-tauri/tauri.conf.json`
- 开发 URL: `http://localhost:5173`，生产前端: `../../fd-web/dist`
- CSP: null（支持 Shadow Window），DevTools: 右键菜单

### Server SPA 托管
`SpaWebConfig.java` + `@ConditionalOnResource("classpath:static/index.html")`

## 架构约束

### 模块依赖规则
```
common ← auth ← task ← ai ← workflow ← ticket ← app
```
- 只允许单向依赖，禁止反向和循环
- common 不依赖任何业务模块
- auth 提供 `@RequiresPermission` 注解和 `ModulePermissionDefinition` SPI
- workflow 通过 WorkflowCallbackRegistry 解耦业务回调（workflow 不依赖 ticket）
- 模块间通过注入 Service 直接调用，不做过度抽象

### Agent 开发约束
- 新 Agent 的执行逻辑封装在 Executor 内部，通过 providerConfig 配置驱动
- ShadowExecutor 的浏览器自动化脚本通过 providerConfig 加载（DOM 选择器、操作步骤、超时参数）
- Agent prompt 模板使用 `${PARAM_NAME}` 变量，变量值从 AgentExecuteInput.data 字段自动映射
- CLIENT_ONLY Agent 完成后通过 TaskCompletedEvent → WorkflowTaskBridge 自动唤醒 BPMN ReceiveTask

### 工作流编排约束
- Flowable BPMN 是唯一的编排引擎
- FlowableTicketOrchestrator 是唯一的 TicketWorkflowOrchestrator 实现
- 新增业务流程通过 BPMN XML + JavaDelegate 实现
- AgentTaskDelegate 根据 executionEnv 决定服务端执行或创建 TaskInstance

### 自动化状态架构（Agent 与 UI 解耦）

Agent 是纯执行插件，**不管理 UI 状态**。自动化处理状态由任务生命周期和工作流驱动。

**状态来源优先级**（三选一，不混用）：

| 优先级 | 来源 | 场景 | 机制 |
|--------|------|------|------|
| 1 | **MQ 任务 Map**（`processingTasks`） | 自动化消费模式 | 任务在 Map 中 = 执行中；离开 Map = 结束 |
| 2 | **后端工单状态**（`ticket.status`） | 通用/兜底 | TRANSLATING/REPLYING/PENDING_AUDIT 等 BPMN 驱动状态 |
| 3 | **组件本地状态**（useState） | 手动操作（用户点按钮） | 操作期间 true，完成/失败后 false |

**数据流**：
```
                        自动化模式                          手动模式
                        ─────────                          ─────────
MQ Consumer                                    用户点击
  │                                            "翻译"/"回复"
  ├── claim task                                   │
  │   └── add to processingTasks Map               ├── 组件 local state = true
  │       └── UI: "执行中" 指示器显示              │
  │                                                │
  ├── taskProcessor                                ├── 调用 Agent hook
  │   └── Agent 纯执行（无 UI 副作用）             │   └── Agent 纯执行
  │       └── 返回 result                          │       └── 返回 result
  │                                                │
  ├── completeTask API                             ├── 提交结果到后端
  │   └── 后端 BPMN 推进                           │
  │       └── ticket.status 更新                   ├── 组件 local state = false
  │                                                │
  └── delete from processingTasks Map              └── 刷新工单数据
      └── UI: "执行中" 指示器消失
```

**禁止规则**：
- Agent hooks（useAiTranslation/useAiReply）禁止调用 `setProcessStatus` 或任何全局 UI 状态
- Agent hooks 禁止持有互斥锁（`globalActiveReplyingId`）— 并发控制由工作流任务系统负责
- UI 组件禁止从 Agent 执行回调派生处理进度 — 必须从任务 Map 或后端状态派生

**实现要点**：
- `useAiTranslation` / `useAiReply` 变为纯函数：`(ticket, options) → Promise<result>`，不依赖 `useTicketProcess`
- `ServerTicketDetail` 的 `isTranslating`/`generatingAiReply` 派生逻辑：
  - 自动化模式：从父组件传入的 `isProcessing` + `activeTaskType` prop 派生
  - 独立模式：从 `ticket.status`（后端）或组件 local state（手动操作）派生
- `useTicketProcess` 精简为纯数据通道：仅保留 `tempTranslation`、`tempAiReply`、`streamingText`（手动模式 UI 展示用），移除 `translating`/`replying` 状态布尔值
- `createMQTaskContext` 的 `processOneTask` 增加执行超时保护（防止 Agent 挂起导致任务永不完成）

## 文档体系

```
doc/
├── project-documentation.md          # 总览、Quick Start
├── project-structure.md              # 目录树
├── system-design.md                  # 状态流转、数据流、安全
├── server-architecture.md            # 后端架构、模块划分
├── client-architecture.md            # 客户端 + 前端架构
├── api-reference.md                  # REST API 全量参考
├── freshdesk-api-reference.md        # Freshdesk API 参考
└── modules/                          # 模块独立文档
    ├── common.md, auth.md, task.md
    ├── ai.md, workflow.md, ticket.md
```

代码变更影响公开接口/数据模型/架构时，同步更新对应 `doc/` 文档。新增模块必须创建 `modules/{name}.md`。

## Agent Teams

### 角色定义

| 角色 | model | subagent_type | 范围与职责 |
|------|-------|--------------|-----------|
| backend-dev | opus | general-purpose | 后端开发。prompt 中指定模块范围（如 `fd-server-workflow/**`）。遵守依赖链，跨模块按底层先行串行 |
| frontend-dev | opus | general-purpose | `fd-web/src/**`。Agent 运行时 + MQ Context + Tauri 桥接。遵守 `isTauriEnv()` 条件调用 |
| rust-dev | opus | general-purpose | `fd-client/src-tauri/src/**`。Gemini CLI + Shadow Window 生命周期。仅 4 文件 |
| architect | opus | Plan | 跨层设计、BPMN 流程设计、Agent 通用化方案。输出 API 契约 + 数据模型 + 任务分工 |
| debugger | opus | general-purpose | 跨层诊断：Rust↔React↔Server、MQ、Shadow Window 时序。输出根因 + 涉及文件 + 修复方向 |
| reviewer | sonnet | general-purpose | 代码审查 + 模块边界。OWASP Top 10、import 方向合规、行为一致性。重点检查依赖链违规 |
| test-writer | sonnet | general-purpose | 后端 JUnit 5、前端 Vitest+RTL、Rust `#[cfg(test)]`。关注状态流转边界和权限校验 |
| doc-writer | haiku | general-purpose | 中文文档。更新 `doc/` 受影响文件。格式：概览 → API → Service 接口 → 数据模型 → 扩展点 |

### 后端模块路由

prompt 中指定模块：`"范围限定 fd-server-{module}/**，可依赖 {上游模块}，不得依赖 {下游模块}"`

跨模块时按依赖链顺序串行派发（底层先完成再派发上层）。

### 测试执行

主代理直接运行，无需子代理：

| 范围 | 命令 |
|------|------|
| 后端全量 | `cd fd-server && mvn test` |
| 后端单模块 | `cd fd-server && mvn test -pl fd-server-{module}` |
| 前端 | `cd fd-web && npm test` |
| 前端覆盖率 | `cd fd-web && npm run test:coverage` |
| 前端类型检查 | `cd fd-web && npx tsc --noEmit` |
| Rust | `cd fd-client/src-tauri && cargo test` |
| 前端构建 | `cd fd-web && npm run build` |

### 工作流

#### 需求受理（所有请求必经）
1. **澄清需求和范围** — 有歧义则询问用户，判断涉及哪些层（server/React/Rust）和模块
2. **评估复杂度和风险** — 是否涉及状态机、MQ、Schema、BPMN、模块边界变更
3. **简单任务** → 直接执行，无需子代理

#### 流程 S: 标准流程（单层 / Bug / 中等复杂度）
```
探索 → [诊断] → 开发 → 测试 → [文档同步]
```
- **探索**: 主代理读取相关文件（或 Explore agent）
- **诊断**: Bug 时 debugger 先定位根因
- **开发**: 对应 dev agent 实现
- **测试**: 主代理运行测试，失败则 dev agent 修复（最多 2 轮，超限报告用户）
- **文档**: 变更影响公开接口时 doc-writer 更新

#### 流程 F: 全栈流程（跨层 / 高风险 / 重构 / 新功能）
```
探索 → 设计(用户确认) → 并行开发 → 验证 → [文档同步]
```
- **探索**: 并行读取涉及模块（主代理或多个 Explore agent）
- **设计**: architect 输出方案（API 契约 + 数据模型 + 任务分工）→ **用户确认后方可开发**
- **开发**: 不同层 dev agent 并行，同层按依赖串行。主代理用 TaskCreate 跟踪
- **验证**: 主代理运行测试 + reviewer 审查（安全 + 模块边界）
- **失败处理**: dev agent 修复 → 重跑测试，最多 2 轮，超限报告用户
- **文档**: doc-writer 更新受影响文档
- **重构/模块化**: 额外运行全量测试 + reviewer 重点检查 import 方向合规

#### 判断标准
| 条件 | 选择 |
|------|------|
| 单文件、逻辑清晰 | 直接执行 |
| 单层、2-5 文件 | 流程 S |
| Bug/异常 | 流程 S（debugger 先诊断） |
| 跨层（server + client/React + Rust） | 流程 F |
| 涉及状态机/MQ/Schema/BPMN 变更 | 流程 F（高风险需设计确认） |
| 重构/模块化抽取 | 流程 F + 全量测试 |

#### 完成确认
所有任务完成后：确认任务状态 → 检查文档影响 → 向用户汇报（完成内容、改动文件、测试结果、文档同步状态）
