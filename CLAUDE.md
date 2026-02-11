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

本项目使用分层模型策略：开发用 opus（最强推理），测试编写和代码审查用 sonnet（平衡），测试执行和文档用 haiku（高性价比）。

### 模型分配规则

当使用 Task 工具启动子代理时，**必须**根据任务类型指定 `model` 参数：

| 任务类型 | model 参数 | 适用场景 |
|----------|-----------|----------|
| 开发 | `opus` | 编写/修改业务代码、架构设计、复杂调试、性能优化 |
| 代码审查 | `sonnet` | 代码质量分析、安全审查、PR Review |
| 测试编写 | `sonnet` | 编写测试用例（需要理解业务逻辑） |
| 测试执行 | `haiku` | 运行测试、生成覆盖率报告 |
| 文档 | `haiku` | 编写/更新文档、API 文档、注释 |
| 探索 | `haiku` | 代码库搜索、文件查找、结构分析 |

### 角色 → 实际调用映射

每个角色对应 Task 工具的具体参数，主代理**必须**按此表构造调用：

| 角色 | subagent_type | model | prompt 关键指令 |
|------|--------------|-------|----------------|
| backend-dev | `general-purpose` | `opus` | "你是 Java/Spring Boot 后端开发。范围限定 `fd-server/src/**`。关注工单状态流转正确性、MQ 消息可靠投递、事务一致性。" |
| frontend-dev | `general-purpose` | `opus` | "你是 React/TypeScript 前端开发。范围限定 `fd-client/src/**`（不含 `src-tauri`）。关注 MQ Context 工厂模式一致性、流式文本桥接、状态管理。" |
| rust-dev | `general-purpose` | `opus` | "你是 Tauri/Rust 客户端后端开发。范围限定 `fd-client/src-tauri/src/**`。关注异步安全、Event 通信可靠性、错误处理。" |
| architect | `Plan` | `opus` | （Plan 模式自动获取上下文，用于跨模块设计、数据流优化、技术选型、状态机扩展） |
| debugger | `general-purpose` | `opus` | "你是跨层调试专家。负责定位 Rust↔React↔Server 问题、MQ 消息丢失排查、Shadow Window 时序问题。输出：根因分析 + 修复建议。" |
| code-reviewer | `general-purpose` | `sonnet` | "你是代码审查者。重点关注 OWASP Top 10（JWT 安全、SQL 注入、XSS）、最佳实践、重复代码。输出：问题列表（按严重级别排序）+ 修复建议。" |
| test-runner | `Bash` | `haiku` | 直接执行测试命令（见下方测试命令表） |
| test-writer | `general-purpose` | `sonnet` | "你是测试工程师。后端用 JUnit 5 + Spring Boot Test（`fd-server/src/test/java/**`），Rust 用 `#[cfg(test)]`，前端用 Vitest + RTL。关注工单状态流转边界、MQ 序列化/反序列化、API 权限校验。" |
| doc-writer | `general-purpose` | `haiku` | "你是文档工程师。范围 `doc/**` + 代码内注释。中文撰写，遵循 `doc/` 目录现有风格。" |

**测试命令表**（test-runner 使用）：

| 模块 | 命令 |
|------|------|
| 后端 | `cd fd-server && mvn test` |
| Rust | `cd fd-client/src-tauri && cargo test` |
| 前端 | `cd fd-client && npm test` |
| 前端覆盖率 | `cd fd-client && npm run test:coverage` |

### 主代理编排协议

主代理（即对话中的顶层 Claude 实例）同时承担**管理者**角色，在调度子代理执行之前和之后，**必须**完成以下管理职责：

#### Phase 0: 需求受理（每次用户请求必经）

收到用户请求后，主代理**必须先完成以下分析**，再进入决策树：

1. **需求澄清** — 请求是否明确？若存在歧义，用 `AskUserQuestion` 澄清，不得假设
2. **范围评估** — 判断涉及哪些层（server / React / Rust / 跨层），影响哪些模块
3. **复杂度判断** — 按以下标准分级：
   - **简单**: 单文件改动、逻辑清晰、无依赖 → 直接执行，跳过任务拆解
   - **中等**: 2-5 个文件、单层、有明确模式可参考 → 创建 TaskCreate 跟踪，走流程B
   - **复杂**: 跨层、模糊需求、需要设计决策 → 完整任务拆解，走流程A/C/D
4. **任务拆解**（中等及以上）— 使用 `TaskCreate` 将需求拆解为可执行任务，每个任务须包含：
   - 明确的完成标准（什么状态算"做完"）
   - 涉及的文件/模块范围
   - 依赖关系（通过 `addBlockedBy` 设定）
5. **风险识别** — 是否涉及：状态机变更、MQ 消息格式变更、数据库 Schema 变更、安全相关改动？若是，标记为高风险，流程中必须经过 architect 设计 + 用户确认

#### Phase 1-N: 执行与跟踪

在各流程（A/B/C/D）执行期间，主代理**必须**：

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
| 探索 → 设计 | Explore 产出了涉及模块的文件清单和现有模式总结 | A, D |
| 设计 → 开发 | architect 方案已获用户确认；API 契约、数据结构已明确 | A, D |
| 开发 → 验证 | 所有 dev agent 已返回；代码已写入文件系统 | A, B, C, D |
| 验证 → 补充测试 | 现有测试全部通过；code-reviewer 无 P0/P1 问题 | A |
| 测试 → 文档 | 全部测试通过（含新增测试） | A, D |
| 诊断 → 修复 | debugger 输出了根因分析和涉及文件清单 | C |

### 工作流决策树

完成 Phase 0 需求受理后，主代理按以下逻辑选择工作流：

```
用户请求 → Phase 0 需求受理（澄清 + 范围 + 复杂度 + 拆解 + 风险）
  │
  ├─ 简单任务？ ──→ 直接执行，无需子代理
  │
  ├─ 是 Bug/异常？ ──→ 流程C: Bug 修复
  │
  ├─ 是重构/优化？ ──→ 流程D: 重构优化
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
  → 用户确认方案
  ── 门控 ──→ 用户已确认 + 契约已明确，否则不得进入开发

Step 3: 并行开发（前提：Step 2 的契约已确定）
  主代理用 TaskCreate 为每个子任务创建跟踪项，然后同时启动（单条消息多个 Task 调用）：
  - backend-dev(opus) — 实现 Service + Controller + Entity
  - frontend-dev(opus) — 实现组件 + Hooks + API 调用
  - rust-dev(opus) — 实现 Tauri 命令 + MQ 处理（仅涉及 Rust 层时）
  子代理返回后，主代理用 TaskUpdate 更新各任务状态
  ── 门控 ──→ 所有 dev agent 已返回 + 代码已写入，否则等待

Step 4: 并行验证
  同时启动：
  - test-runner(haiku/Bash) — 运行现有测试确保无回归
  - code-reviewer(sonnet) — 审查代码质量和安全
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
  输出：根因分析 + 涉及文件 + 修复方向
  ── 门控 ──→ 根因已明确 + 涉及文件已列出，否则补充诊断

Step 2: 修复
  对应 dev agent(opus) 实施修复
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
  对应 dev agent(opus) 实施重构
  主代理用 TaskCreate/TaskUpdate 跟踪
  ── 门控 ──→ 重构代码已写入

Step 4: 全量验证（重构必须跑全量测试）
  test-runner(haiku/Bash) — 后端 + 前端 + Rust 全部测试
  ── 门控 ──→ 全量测试通过，否则 dev agent 修复后重跑（最多 2 轮）

Step 5: 审查
  code-reviewer(sonnet) — 重点关注行为一致性
  ── 门控 ──→ 无行为变更问题

Step Final: 主代理确认完成，向用户汇报（含重构范围、行为一致性确认、测试结果）
```

### 失败回退规则

主代理在验证步骤遇到失败时，**必须**按以下规则处理，不得跳过：

| 失败类型 | 处理方式 | 最大重试 |
|---------|---------|---------|
| 测试失败 | 原 dev agent(opus) 修复 → test-runner 重跑 | 2 轮 |
| 审查发现安全问题 | 立即停止流程，原 dev agent(opus) 修复 → code-reviewer 重审 | 2 轮 |
| 构建失败 | debugger(opus) 定位 → dev agent(opus) 修复 | 2 轮 |
| 并行产出冲突 | architect(opus/Plan) 协调合并策略 → dev agent 调整 | 1 轮 |
| 超过最大重试 | 停止自动流程，向用户报告问题详情，等待人工决策 | — |

### 并行执行约束

以下规则约束何时可以并行、何时必须串行：

**可以并行的组合：**
- 多个 Explore agent（探索不同模块）
- backend-dev + frontend-dev + rust-dev（前提：architect 已输出 API 契约和数据结构）
- test-runner + code-reviewer（互不依赖）
- doc-writer + test-writer（互不依赖）

**必须串行的依赖：**
- architect → dev agents（开发必须基于确认后的设计方案）
- dev agents → test-runner（测试必须在代码写完后）
- debugger → dev agent（修复必须基于诊断结论）
- 所有开发/测试 → doc-writer（文档必须反映最终实现）

**特殊约束：**
- debugger 是阻塞性的：触发后暂停其他工作流，直到诊断完成
- 全量测试失败后，不得启动 doc-writer（代码未稳定，文档会过时）
- 并行启动多个 dev agent 时，必须在同一条消息中发送多个 Task 调用
