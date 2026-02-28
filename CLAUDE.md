# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

> v0.4 架构设计详见 `doc/v0.4-vision.md`

> 系统的用户名为 `admin`，密码为 `admin123`

> n8n系统的用户名为 `jeff890115@gmail.com`，密码为 `Jeff13467565377`

## 项目概览

FD-AutoPilot — 智能工单处理系统，集成 Freshdesk + AI（Gemini CLI / NotebookLM）自动化翻译和回复。

| 子项目        | 技术栈                            | 职责                         |
| ------------- | --------------------------------- | ---------------------------- |
| **fd-server** | Spring Boot 3.4.1 / Java 21       | 后端 6 模块                  |
| **fd-web**    | React 19 / Vite 7 / TS / Tailwind | 前端 SPA（浏览器或 Tauri）   |
| **fd-client** | Tauri v2 / Rust                   | 桌面客户端：AI 执行 + 自动化 |
| **n8n**       | n8n workflow                      | 工作流编排                   |

数据库：H2 文件数据库，Hibernate DDL `update` 自动建表

## 开发命令

```bash
# 服务端
cd fd-server && mvn install -DskipTests && mvn spring-boot:run -pl fd-server-app  # 启动 :9988
cd fd-server && mvn test                          # 全量测试
cd fd-server && mvn test -pl fd-server-{module}   # 单模块测试

# 前端
cd fd-web && npm run dev       # 开发 :5173（代理 /api → :9988）
cd fd-web && npm run build     # 生产构建
cd fd-web && npm test          # Vitest 测试
cd fd-web && npx tsc --noEmit  # 类型检查

# 客户端
cd fd-client && npm run tauri dev
cd fd-client/src-tauri && cargo check && cargo test
```

## 模块结构

### 后端

依赖链：`common ← auth ← task ← ai ← ticket ← app`（单向，禁止反向）

| 模块   | 核心职责                                                      |
| ------ | ------------------------------------------------------------- |
| common | DTO、异常、工具类                                             |
| auth   | JWT + RBAC + 权限自注册(SPI)                                  |
| task   | 任务分发 + SSE + 定时调度                                     |
| ai     | Agent 定义/实例/绑定 + Capability 管理 + 客户端注册 + SyncBridge + Capability 路由 |
| ticket | 工单业务 + Freshdesk + 通知                                   |
| app    | 启动入口 + n8n 集成                                           |

### 前端 (fd-web/src/)

```
shared/
├── agents/          AgentRegistry（含 Capability 加载）, useAgent, executors/
├── context/         createMQTaskContext, MQTranslateAgent, MQReplyAgent, Auth, ServerEvents
├── hooks/           useAuth, useToast, useSettings, useTicketProcess, useAiTranslation, useAiReply
├── services/        serverApi.ts (REST + JWT 刷新), clientRegistration.ts (客户端注册+心跳), executionHistory.ts (IndexedDB 执行记录)
└── types/           server.ts

modules/
├── auth/      登录注册
├── ticket/    工单列表/详情/翻译/回复/审核
├── admin/     用户/同步/知识库/数据库/Agent/角色权限
├── workflow/  n8n 集成 / Agent 管理 / Capability 管理
├── task/      任务仪表盘 / Agent 执行时间线
└── system/    设置/用户资料
```

Provider 层次：`AuthProvider → ServerEventsProvider → AgentProvider → MQTranslateAgent → MQReplyAgent → AppShell`

### 客户端 Rust (fd-client/src-tauri/src/)

`lib.rs`（Tauri commands）· `ai.rs`（Gemini CLI）· `shadow_agent.rs`（Shadow Window）· `models.rs`

## 数据模型

**工单**: Ticket → (1:N) TicketTranslation / TicketReply / TicketAudit · ClientRequest
**RBAC**: SysUser → SysUserRole → SysRole → SysRolePermission → SysPermission + SysModule
**Agent**: AgentDefinition · AgentInstance（clientId 隔离） · AgentExecution · AgentBinding（capability → agentCode）
**Capability**: CapabilityDefinition（执行能力：gemini-cli / claude-cli / notebooklm-py / shadow-window）
**客户端**: ClientRegistration（clientId + enabledCapabilities + 心跳在线状态）
**任务**: TaskDefinition · TaskInstance（PENDING/CLAIMED/COMPLETED/FAILED/TIMEOUT + targetClientId/targetUserId 路由）
**系统**: SystemConfig · KnowledgeNote · UserAppSettings

## 工单状态流转

```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
```
审核分支：PASS → COMPLETED | REJECT → PENDING_REPLY | RETRANSLATE → PENDING_TRANS

## 开发红线

- 新增 Agent 通过 AgentDefinition + Executor 配置驱动，禁止硬编码
- 工单状态转换由 TicketStateMachine 统一管理
- Agent hooks 是纯执行函数，禁止管理 UI 状态
- 模块依赖单向，禁止反向和循环
- Capability 级路由替代硬编码 agentCode，n8n 调用 `/capabilities/{cap}/execute` 而非 `/agents/{code}/execute`

## Agent Teams

### 角色定义

| 角色           | model  | subagent_type   | 范围与职责                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| backend-dev    | opus   | general-purpose | 后端开发。prompt 中指定模块范围（如 `fd-server-ai/**`）。遵守依赖链 `common ← auth ← task ← ai ← ticket ← app`，跨模块按底层先行串行                                                                                                                                                                                                                                                                                                        |
| frontend-dev   | opus   | general-purpose | `fd-web/src/**`。Agent 运行时（Registry + Executor + useAgent）、MQ Consumer、Capability 设置 UI、执行时间线、Tauri 条件桥接（`isTauriEnv()`）                                                                                                                                                                                                                                                                                              |
| rust-dev       | opus   | general-purpose | `fd-client/src-tauri/src/**`。CLI Executor（gemini/claude）、notebooklm-py 调用、Shadow Window 生命周期、HTTP Bridge、Capability 上报与注册                                                                                                                                                                                                                                                                                                 |
| n8n-expert     | opus   | general-purpose | n8n 工作流设计与调试。Sync Bridge 端点对接、cron/Webhook 触发配置、错误处理分支、超时重试策略、n8n 与 capability 级路由的集成                                                                                                                                                                                                                                                                                                               |
| architect      | opus   | Plan            | 跨层设计。Capability 体系建模、Definition+Instance 分离方案、capability 级路由策略、Sync Bridge 演进、shadow-window RPA 架构规划。输出 API 契约 + 数据模型 + 任务分工                                                                                                                                                                                                                                                                       |
| debugger       | opus   | general-purpose | 跨层诊断。重点场景：Sync Bridge 超时/CompletableFuture 泄漏、Capability 路由失败（无 Agent/无客户端/Capability 关闭）、MQ Consumer 卡死、客户端注册心跳异常                                                                                                                                                                                                                                                                                 |
| reviewer       | sonnet | general-purpose | 代码审查。重点：依赖链违规、`@Transactional` 误用（Sync Bridge 禁止长事务）、AgentInstance clientId 隔离、Capability 开关与 Agent 启停联动一致性                                                                                                                                                                                                                                                                                            |
| test-writer    | sonnet | general-purpose | 编写自动化测试用例。后端：JUnit 5 + Mockito（Service/Controller 层），重点覆盖 Capability 路由、Sync Bridge 超时、AgentInstance 隔离、TicketStateMachine 状态转换。前端：Vitest + React Testing Library，重点覆盖 Capability 开关联动、MQ Consumer 生命周期、Agent 执行流程                                                                                                                                                                 |
| preview-tester | opus   | general-purpose | 前端可视化验收。开发完成后重启项目（preview_start），使用 preview_* 工具链验收：preview_snapshot 检查页面结构与文案、preview_screenshot 截图验证布局、preview_inspect 校验 CSS 样式、preview_click/preview_fill 模拟用户交互、preview_console_logs/preview_network 检查运行时错误和 API 调用。发现问题反馈对应 dev agent 修复。测试中如果涉及n8n工作流，因为系统是iframe嵌入的n8n，你可能无法点击，你在preview中新开一个页面打开n8n进行操作 |
| doc-writer     | haiku  | general-purpose | 中文文档。更新 `doc/v0.4-vision.md` 和 `CLAUDE.md` 受影响部分                                                                                                                                                                                                                                                                                                                                                                               |

### 后端模块路由

prompt 中指定模块范围：`"范围限定 fd-server-{module}/**，可依赖 {上游模块}，不得依赖 {下游模块}"`

v0.4 重点模块分工：

| 模块   | v0.4 开发重点                                                                    |
| ------ | ------------------------------------------------------------------------------- |
| ai     | Capability 建模、AgentInstance 实体、capability 级路由、Sync Bridge 增强、客户端注册心跳 |
| ticket | N8nTicketService 端点扩展、审核驳回循环、通知策略                               |
| task   | 任务路由增强（targetClientId/targetUserId）、客户端注册心跳                     |
| app    | N8nAgentController capability 端点、N8nConfigController                        |

跨模块时按依赖链顺序串行派发（底层先完成再派发上层）。

### 测试执行

| 范围           | 命令                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------- |
| 后端全量       | `cd fd-server && mvn test`                                                                  |
| 后端单模块     | `cd fd-server && mvn test -pl fd-server-{module}`                                           |
| 后端编译       | `cd fd-server && mvn install -DskipTests`                                                   |
| 前端类型检查   | `cd fd-web && npx tsc --noEmit`                                                             |
| 前端测试       | `cd fd-web && npm test`                                                                     |
| 前端构建       | `cd fd-web && npm run build`                                                                |
| Rust 检查      | `cd fd-client/src-tauri && cargo check`                                                     |
| 前端可视化验收 | preview-tester agent（preview_start → snapshot/screenshot → inspect → click/fill 交互验证） |

### 开发工作流

#### 需求受理（所有请求必经）
1. **澄清需求和范围** — 涉及哪些层（server/React/Rust/n8n）和模块
2. **评估复杂度** — 是否涉及 Sync Bridge / Capability / AgentInstance / 模块边界变更
3. 简单任务 → 直接执行

#### 流程 S: 标准流程（单层 / Bug / 中等复杂度）
```
探索 → [debugger 诊断] → 开发 → [test-writer 编写测试] → 运行测试 → [preview-tester 验收] → [doc-writer 文档同步]
```

#### 流程 F: 全栈流程（跨层 / 新 Capability / 新 Agent / 重构）
```
探索 → architect 设计(用户确认) → 并行开发 → [test-writer 编写测试] → reviewer 审查 → 运行测试 → [preview-tester 验收] → [doc-writer 文档同步]
```
- 不同层 dev agent 可并行，同层按依赖串行
- 涉及 n8n 工作流变更时 n8n-expert 参与设计和实现
- test-writer 在开发完成后编写测试用例，主代理运行测试
- 涉及前端 UI 变更时 preview-tester 重启项目后进行可视化验收
- 测试失败 → dev agent 修复 → 重跑，最多 2 轮，超限报告用户

#### 判断标准
| 条件                                            | 选择                                  |
| ----------------------------------------------- | ------------------------------------- |
| 单文件、逻辑清晰                                | 直接执行                              |
| 单层、2-5 文件                                  | 流程 S                                |
| Bug / 异常                                      | 流程 S（debugger 先诊断）             |
| 跨层 / 新 Agent / Sync Bridge / Capability 变更 | 流程 F                                |
| n8n 工作流配置                                  | n8n-expert 单独处理或纳入流程 F       |
| 重构 / 模块化                                   | 流程 F + 全量测试 + reviewer 重点检查 |
