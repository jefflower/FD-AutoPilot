# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**FD-AutoPilot** 是一个智能工单处理系统，集成 Freshdesk 与 AI 能力（Google NotebookLM + Gemini CLI）来自动化翻译和回复生成。

### 核心架构
- **fd-server**: Spring Boot 3.4.1 后端（Java 21），负责工单生命周期管理、Freshdesk 同步、RabbitMQ 任务分发
- **fd-client**: Tauri v2 + React 19 前端（Rust + TypeScript + TailwindCSS），既是用户界面也是 AI 任务执行引擎
- **消息队列**: RabbitMQ 用于异步任务分发（翻译、回复、审核）
- **数据库**: 服务端使用 H2 文件数据库，客户端使用 SQLite 本地存储

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

### 客户端 (fd-client)
```bash
cd fd-client
npm install                            # 安装依赖
npm run dev                            # 仅前端 Vite 开发服务器（端口 1420）
npm run tauri dev                      # Tauri 完整开发模式（含 Rust 后端，热重载）
npm run build                          # TypeScript 编译 + Vite 打包
npm run tauri build                    # 生产构建（生成安装包）
npm test                               # 运行所有前端测试（Vitest）
npm run test:watch                     # 开发模式（监听文件变更自动重跑）
npm run test:coverage                  # 覆盖率报告

# Rust 部分单独编译/测试
cd src-tauri
cargo build                            # 编译 Rust
cargo test                             # Rust 测试
```

**注意**: 前端没有配置 ESLint、Prettier。也没有 CI/CD 流水线。测试框架使用 Vitest + React Testing Library（`npm test`）。

## 核心技术架构

### 端到端数据流
```
Freshdesk API ──(cron 5min)──→ fd-server ──(RabbitMQ)──→ fd-client (Rust MQ Consumer)
                                  ↑                            │
                                  │                            ├─ 翻译: Rust 调用 Gemini CLI (ai.rs)
                                  │                            └─ 回复: React Shadow Window → NotebookLM
                                  │                                     │
                                  └──────── POST /api/v1/tickets/{id}/* ┘
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

### 混合 AI 工作流
系统对翻译和回复使用不同的 AI 策略：

1. **翻译**: Rust 后端直接调用 `gemini` CLI 工具（`src-tauri/src/ai.rs`），无头执行，速度快
2. **回复**: 使用 Shadow Window 技术操作 NotebookLM（`src/services/notebookShadow.ts`），因为 NotebookLM 无公开 API
   - 创建隐藏 Webview 窗口（`label: notebook_shadow`），通过 `initialization_script` 注入 Tauri IPC 桥接
   - **混合 observer + relay 架构**（v3）：
     1. `mainScript`（IIFE）：清理历史 → 输入 prompt → 点击发送 → 建立 in-page observer（setInterval）
     2. Observer 仅写 `window.__SHADOW_LATEST_RESULT` 全局变量（不在 setInterval 中调用 invoke，避免 IPC 不稳定）
     3. Generator 定期注入 relay 脚本，读取全局变量并通过 `forward_shadow_event` 中继到主窗口
   - DOM 选择器：集中在 `SELECTORS` 常量对象中管理（NotebookLM 更新 UI 后只需修改一处），通过 `JSON.stringify` 注入 mainScript
   - 完成检测：复制按钮出现 + `isJsonBalanced` + `botIdle` + `botResponded` 多重校验
   - 全局互斥锁确保同时只有一个查询在执行

### Rust ↔ React 通信机制
Rust 后端通过 Tauri Event 与 React 前端通信：
- **Rust → React Events**: `mq-translate-request`, `mq-reply-request`, `log`, `progress`, `notebook-window-visibility-changed`, `shadow-result`, `shadow-log`
- **React → Rust Commands**: 通过 `invoke()` 调用注册的 Tauri 命令

关键 Tauri 命令（`lib.rs` 中注册）：
- 本地同步: `sync_tickets`, `list_local_tickets`, `load_ticket_cmd`, `sync_statuses_cmd`
- 设置: `save_settings_cmd`, `load_settings_cmd`
- 文件操作: `select_folder`, `export_to_csv_cmd`
- 翻译: `translate_ticket_cmd`, `translate_ticket_direct_cmd`
- NotebookLM: `open_notebook_window`, `execute_notebook_js`, `get_shadow_result`, `toggle_notebook_window`, `get_notebook_window_visibility`, `forward_shadow_event`
- MQ 翻译消费: `start_mq_consumer`, `stop_mq_consumer`, `get_mq_consumer_status`, `update_mq_batch_size`, `complete_translate_task`
- MQ 回复消费: `start_reply_mq_consumer`, `stop_reply_mq_consumer`, `get_reply_mq_consumer_status`, `complete_reply_task`

### 前端状态管理
使用 React Hooks + Context 模式（无 Redux）：
- `createMQTaskContext` — **通用 MQ 任务 Context 工厂函数**（`context/createMQTaskContext.tsx`），翻译和回复 Context 通过配置参数差异化（事件名、命令名、并发模式等），消除 95% 重复代码。`taskProcessor` 通过 Provider prop 注入（支持在组件内使用 React hooks）
- `MQTranslationContext` — 通过工厂创建，并发模式（batchSize=5），注入 `runTranslation` 作为 taskProcessor
- `MQReplyContext` — 通过工厂创建，串行模式（batchSize=1，任务间延迟 1s），注入 `runReply` + `onStreamChunk` 回调桥接流式文本
- `useTicketProcess` — 全局工单处理状态（`status`, `tempTranslation`, `tempAiReply`, `streamingText`），使用模块级变量 + listener 模式跨组件共享
- **AI Provider 抽象层**（`src/ai/`）：
  - `types.ts` — 定义 `AiTranslationProvider` 和 `AiReplyProvider` 接口，支持未来快速切换 AI 提供商
  - `providers/geminiTranslationProvider.ts` — Gemini CLI 翻译实现
  - `providers/notebookLMReplyProvider.ts` — NotebookLM 回复实现
  - `index.ts` — 工厂函数 `getTranslationProvider(name)` / `getReplyProvider(name, config)`
- **统一 AI Hooks**（按钮点击和 MQ 自动触发走同一代码路径，内部委托给 Provider）：
  - `useAiReply` — 薄层 Hook，委托给 `NotebookLMReplyProvider`
  - `useAiTranslation` — 薄层 Hook，委托给 `GeminiTranslationProvider`
- 其他 Hooks: `useAuth`, `useSettings`, `useTickets`, `useSync`, `useNotebookShadow`
- 共享常量: `constants/agentMap.ts` — Freshdesk Agent ID → 名称映射（统一引用，避免多处定义）

## 关键文件位置

### 后端 (fd-server/src/main/java/com/jefflower/fdserver/)
- **工单服务**: `service/TicketService.java` — 工单工作流编排核心
- **Freshdesk 同步**: `service/FreshdeskService.java` + `scheduler/SyncScheduler.java`
- **MQ 发布**: `service/MqPublisherService.java`
- **RabbitMQ 配置**: `config/RabbitMQConfig.java`（队列、交换机、绑定）
- **安全配置**: `config/SecurityConfig.java` + `security/JwtUtil.java` + `security/JwtAuthenticationFilter.java`
- **认证与用户管理**: `service/AuthService.java` — 登录、注册、用户分页查询（状态/用户名过滤）、审批、角色修改、密码重置
- **实体**: `entity/Ticket.java`（含 `lastAuditRemark` 字段）, `entity/TicketTranslation.java`, `entity/TicketReply.java`, `entity/TicketAudit.java`, `entity/SysUser.java`（`password` 字段 `@JsonIgnore`）, `entity/SystemConfig.java`（系统配置键值对）
- **系统配置**: `service/SystemConfigService.java` — 自动推送开关、企业微信 Webhook 配置读写
- **企业微信通知**: `service/WeChatWorkNotifyService.java` — 审核通过/驳回/推送完成等事件通知
- **配置端点**: `controller/ConfigController.java` — 自动推送 + 企业微信配置管理
- **管理端点**: `controller/AdminController.java` — 用户管理（分页查询、审批、角色修改、密码重置）+ 同步管理

### 客户端前端 (fd-client/src/)
- **主入口**: `AppNew.tsx` — 全局布局、Context Provider 包裹、Tab 路由
- **AI Provider 抽象**: `ai/` — AI 提供商接口定义 + 实现（Gemini 翻译、NotebookLM 回复），工厂函数
- **Shadow 服务**: `services/notebookShadow.ts` — NotebookLM 影子窗口核心逻辑（混合 observer + relay 架构，`SELECTORS` 常量管理 DOM 选择器）
- **API 客户端**: `services/serverApi.ts` — 后端 REST API 封装
- **Context 工厂**: `context/createMQTaskContext.tsx` — 通用 MQ 任务 Context 工厂函数
- **Context**: `context/MQTranslationContext.tsx`, `context/MQReplyContext.tsx` — 基于工厂创建的薄层封装
- **统一 AI Hooks**: `hooks/useAiReply.ts`, `hooks/useAiTranslation.ts` — 薄层 Hook，委托给 AI Provider
- **全局状态**: `hooks/useTicketProcess.ts` — 工单处理状态 + 流式文本桥接
- **共享常量**: `constants/agentMap.ts` — Agent ID 映射
- **Server 模式组件**: `components/server/` — 工单列表、翻译任务、回复任务、审核任务（卡片内联审核）、`ApprovedTasksTab`（待推送队列 + 批量推送）、`ServerTaskWorkspace`（多标签页工作区）、`FloatingTaskWidget`（浮动任务指示器）
- **工单详情子组件**: `components/server/ticket-detail/` — `TranslationPreviewBar`、`AiReplyPanel`、`ReplyHistoryPanel`

### 客户端 Rust 后端 (fd-client/src-tauri/src/)
- **Tauri 命令注册**: `lib.rs` — 所有 `#[tauri::command]` 和 `invoke_handler` 注册，`MqConsumerHolder` 共用结构 + newtype wrappers，通用命令辅助函数（`start_consumer_inner` 等）
- **MQ 消费者**: `mq_consumer.rs` — 统一 `handle_message` 消息处理框架 + `submit_via_frontend` 前端任务提交函数
- **AI 翻译**: `ai.rs` — Gemini CLI 调用封装
- **Freshdesk API**: `api.rs` — 本地直连 Freshdesk 的 HTTP 客户端

## API 规范

所有 API 前缀: `/api/v1`，除登录/注册外需携带 `Authorization: Bearer <token>`

### 核心端点
- `POST /auth/login` | `POST /auth/register` — 认证
- `GET /tickets` — 查询工单（分页、状态过滤）
- `POST /tickets/{id}/translation` — 上报翻译结果
- `POST /tickets/{id}/reply` — 上报回复内容
- `POST /tickets/{id}/audit` — 上报审核结果（PASS → APPROVED/COMPLETED，REJECT → PENDING_REPLY + 保存审核意见）
- `POST /tickets/{id}/push-reply` — 手动推送 APPROVED 工单回复到 Freshdesk
- `POST /tickets/batch-push` — 批量推送 APPROVED 工单
- `POST /tickets/{id}/ai-translate` | `POST /tickets/{id}/ai-reply` — 手动触发 AI 任务
- `POST /sync/freshdesk` — 手动触发同步
- `GET /admin/users` — 用户列表（分页、状态过滤、用户名搜索）
- `GET /admin/users/pending` — 待审核用户列表
- `POST /admin/users/{id}/approve` — 批准/拒绝用户
- `PUT /admin/users/{id}/role` — 修改用户角色
- `POST /admin/users/{id}/reset-password` — 重置用户密码
- `GET /config/auto-reply` | `PUT /config/auto-reply` — 自动推送开关
- `GET /config/wecom-webhook` | `PUT /config/wecom-webhook` — 企业微信 Webhook 配置
- `POST /config/wecom-webhook/test` — 测试企业微信 Webhook

## 数据模型

- **Ticket** (1) → (1) **TicketTranslation**
- **Ticket** (1) → (N) **TicketReply**（通常只有一个活跃草稿）
- **Ticket** (1) → (N) **TicketAudit**
- **Ticket.lastAuditRemark** — 最近一次审核驳回意见（注入 AI 回复提示词）
- **SysUser** — 角色: ADMIN/USER，状态: PENDING/APPROVED/REJECTED，`password` 字段 `@JsonIgnore` 不暴露到 API
- **SystemConfig** — 系统配置键值对（auto_reply_enabled, wecom_webhook_url, wecom_notify_enabled）

## 配置

### 服务端
- 配置文件: `fd-server/src/main/resources/application.yml`（已在 .gitignore 中）
- 数据库: H2 文件数据库，Hibernate DDL `update` 自动建表
- H2 控制台: `/h2-console`（开发启用）

### 客户端
- Tauri 配置: `fd-client/src-tauri/tauri.conf.json`
- 开发 URL: `http://localhost:1420`，窗口默认 1400×900 最大化
- CSP: 关闭（`"csp": null`）以支持 Shadow Window

## 文档参考

详细文档位于 `doc/` 目录：`project-documentation.md`（总览）、`system-design.md`（状态流转图）、`client-architecture.md`、`server-architecture.md`、`api-reference.md`、`project-structure.md`

## Agent Teams 配置

本项目使用分层模型策略：开发用 opus（最强推理），测试和文档用 haiku（高性价比），代码审查用 sonnet（平衡）。

### 模型分配规则

当使用 Task 工具启动子代理时，**必须**根据任务类型指定 `model` 参数：

| 任务类型 | model 参数 | 适用场景 |
|----------|-----------|----------|
| 开发 | `opus` | 编写/修改业务代码、架构设计、复杂调试、性能优化 |
| 代码审查 | `sonnet` | 代码质量分析、安全审查、PR Review |
| 测试 | `haiku` | 执行测试、编写测试用例、测试报告 |
| 文档 | `haiku` | 编写/更新文档、API 文档、注释 |
| 探索 | `haiku` | 代码库搜索、文件查找、结构分析 |

### Agent 角色定义

#### 开发组 — model: opus

**backend-dev** (Java/Spring Boot 后端开发)
- 范围: `fd-server/src/**`
- 职责: TicketService 工作流、Controller 端点、MQ 配置、Entity/DTO、SecurityConfig
- 关注: 工单状态流转正确性、MQ 消息可靠投递、事务一致性

**frontend-dev** (React/TypeScript 前端开发)
- 范围: `fd-client/src/**`（不含 `src-tauri`）
- 职责: 组件开发、Hooks/Context、AI Provider 抽象层、Shadow Window 逻辑
- 关注: MQ Context 工厂模式一致性、流式文本桥接、状态管理

**rust-dev** (Tauri/Rust 客户端后端开发)
- 范围: `fd-client/src-tauri/src/**`
- 职责: MQ 消费者、Gemini CLI 调用(ai.rs)、Tauri 命令注册(lib.rs)、Freshdesk API(api.rs)
- 关注: 异步安全、Event 通信可靠性、错误处理

**architect** (架构设计)
- 使用 `subagent_type=Plan`
- 职责: 跨模块设计、数据流优化、技术选型、状态机扩展

**debugger** (复杂调试)
- 职责: 跨层问题定位（Rust↔React↔Server）、MQ 消息丢失排查、Shadow Window 时序问题

#### 代码审查组 — model: sonnet

**code-reviewer** (代码审查)
- 职责: 代码质量、安全漏洞（OWASP Top 10）、最佳实践、重复代码检测
- 特别关注: JWT 安全、SQL 注入（H2 控制台）、XSS（Shadow Window 注入脚本）

#### 测试组 — model: haiku

**test-runner** (测试执行)
- 后端: `cd fd-server && mvn test`
- Rust: `cd fd-client/src-tauri && cargo test`
- 前端: `cd fd-client && npm test`（Vitest 单元测试 + React Testing Library）
- 前端覆盖率: `cd fd-client && npm run test:coverage`

**test-writer** (测试编写)
- 后端: JUnit 5 + Spring Boot Test，放置于 `fd-server/src/test/java/**`
- Rust: `#[cfg(test)]` 模块，放置于对应源文件内
- 关注: 工单状态流转边界、MQ 消息序列化/反序列化、API 权限校验

#### 文档组 — model: haiku

**doc-writer** (文档编写)
- 范围: `doc/**`、代码内注释
- 职责: API 文档更新、架构文档维护、变更日志
- 格式: 中文撰写，遵循 `doc/` 目录现有风格

### 并行执行策略

以下场景应并行启动多个子代理：

1. **全栈功能开发**: 同时启动 `backend-dev`(opus) + `frontend-dev`(opus) + `rust-dev`(opus) 分别处理各层改动
2. **开发+测试**: 开发完成后，同时启动 `test-runner`(haiku) + `code-reviewer`(sonnet)
3. **多模块探索**: 需要了解跨模块逻辑时，同时启动多个 `Explore`(haiku) 子代理搜索不同模块
4. **文档+测试补全**: 同时启动 `doc-writer`(haiku) + `test-writer`(haiku)

### 典型工作流示例

```
用户请求: "给 TicketService 添加批量删除功能"

1. [Explore/haiku] 并行探索 TicketService、TicketController、serverApi.ts 现有模式
2. [architect/opus/Plan] 设计 API + 前后端方案
3. 用户确认方案后，并行执行:
   - [backend-dev/opus] 实现 Service + Controller
   - [frontend-dev/opus] 实现前端调用 + UI
4. 开发完成后，并行执行:
   - [test-runner/haiku] 运行现有测试确保无回归
   - [test-writer/haiku] 编写新功能测试
   - [code-reviewer/sonnet] 审查代码质量
5. [doc-writer/haiku] 更新 API 文档
```
