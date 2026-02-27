# FD-AutoPilot 系统理解文档

> 本文档用于对齐开发者（人类和 AI Agent）对系统的理解，确保后续任务拆解时上下文一致、减少歧义。

系统的测试账号密码是 admin/admin123

## 一、系统愿景

FD-AutoPilot 的目标是：**通用的企业工作流自动化平台——通过 BPMN 可视化编排本地和线上的 AI Agent，让企业各种重复性工作实现自动化。**

Freshdesk 工单处理是第一个垂直场景，用来验证平台架构。但平台本身的设计从一开始就是通用的：

- BPMN 流程可以描述**任何业务流程**，不只是工单
- Agent 是**可插拔的执行单元**，不只是翻译和回复
- Callback Registry 解耦了**流程引擎和业务模块**，不只是 ticket 模块
- TaskInstance 分发机制对**任何类型的异步任务**通用

未来可能的扩展场景举例：
- 订单处理自动化（接单 → AI 分类 → 自动分配 → 跟进）
- 内容审核流水线（抓取 → AI 初审 → 人工复审 → 发布）
- 数据采集与报表（Agent 采集 → 清洗 → 生成报告 → 审批）

扩展时只需：新建业务模块 + 注册回调 + 画 BPMN 流程 + 配置 Agent 定义。平台层（workflow / task / ai 模块）零改动。

---

## 二、架构设计思路

### 2.1 为什么从状态机演进到 BPMN

项目早期在 `TicketService` 里用 if-else 编排（`triggerAiTranslation` → `triggerAiReply` 是遗迹）。这种方式对单一场景够用，但无法支撑"通用平台"目标：

| 问题           | 硬编码方式             | BPMN 方式                       |
| -------------- | ---------------------- | ------------------------------- |
| 流程调整       | 改代码、重新部署       | 改 XML、可热部署                |
| 并行/条件/循环 | 手写状态机，易死锁     | 网关原生支持                    |
| 新业务场景     | 每个场景写一套编排代码 | 画一个新流程，复用所有 Delegate |
| 可视化         | 无                     | BpmnEditor 可视化编辑           |

BPMN 让"流程定义"和"节点执行"彻底分离，是支撑多场景扩展的基础。

### 2.2 Agent 扩展的两种情况

Agent 框架提供的是**可扩展的插件体系**，不是"万能零代码"：

**情况 A：已有执行器覆盖 → 纯配置，零代码**

比如新增"用 Claude API 做摘要"的 Agent，`HttpApiExecutor` 已支持 OpenAI 兼容协议：
- 在 `AgentDefinition` 表插入一条记录（配好 baseUrl、model、systemPrompt）
- 在 BPMN 流程中绑定该 Agent 的 code

**情况 B：全新能力 → 需要开发**

比如新增"操作企业微信审批"的 Agent，现有执行器不覆盖：
- 开发新的 Executor（或在 ShadowExecutor 中新增自动化脚本）
- 可能需要开发对应的 Tauri Command 或后端 Provider
- 开发完后，同类 Agent 就又回到纯配置驱动

四种现有执行器及其覆盖范围：

| 执行器               | 覆盖场景                                 | 运行环境 |
| -------------------- | ---------------------------------------- | -------- |
| **HttpApiExecutor**  | 调用任意 LLM API（OpenAI/Claude/Gemini） | 通用     |
| **CliExecutor**      | 调用本地 CLI 工具                        | 仅 Tauri |
| **ShadowExecutor**   | 浏览器自动化（操作网页应用）             | 仅 Tauri |
| **FunctionExecutor** | 纯前端逻辑（规则引擎/数据转换）          | 通用     |

### 2.3 CLIENT_ONLY 模式——分布式执行

部分 AI 能力只存在于客户端：
- **Gemini CLI** 是本地命令行工具，需要 Tauri 桌面端
- **NotebookLM** 是网页应用，需要浏览器自动化，不提供 API

因此设计了 CLIENT_ONLY 执行模式：BPMN 只负责"创建任务并等待"，实际执行交给前端/桌面端。`TaskInstance + ReceiveTask` 机制让 BPMN 流程在 ReceiveTask 暂停，等客户端完成后通过 `complete` API 唤醒。

同时保留了 `SERVER_ONLY` 和 `HTTP_API` 类型，支持纯服务端执行。**执行环境是 Agent 的配置项，不是架构的硬约束。**

### 2.4 模块解耦——面向多业务场景

依赖链（单向，禁止反向和循环）：

```
common ← auth ← task ← ai ← workflow ← ticket ← app
```

关键：**workflow 模块不依赖 ticket 模块**。

`AgentTaskDelegate` 不知道"工单"是什么，它只知道"创建 TaskInstance 并等待"。工单状态转换通过 `WorkflowCallbackRegistry` 注册的回调完成——ticket 模块启动时把业务逻辑注册进去，workflow 模块只负责调用。

新业务模块（如订单处理）只需：
1. 创建 `fd-server-order` 模块
2. 在 `OrderWorkflowCallbackConfig` 中注册回调
3. 画一个 `order-flow.bpmn20.xml`
4. 配几个 Agent 定义

workflow / task / ai 模块全部复用。

### 2.5 前端消费者——REST 轮询 + SSE 通知

`createMQTaskContext`（名字有历史原因）实际是 REST 轮询 + SSE 的混合模式：

- SSE 提供实时性（新任务立即通知）
- REST 轮询做兜底（SSE 断开时 3 秒轮询）
- `claim` API 原子领取（防止多客户端竞争）
- 纯浏览器可运行，不依赖 RabbitMQ 客户端

---

## 三、当前场景：Freshdesk 工单自动化

### 3.1 业务流程

```
Freshdesk 工单进入
       │
       ▼
  ┌──────────────────┐
  │   AI 翻译         │  把客户的外语工单翻译成中文
  │   AI 回复         │  基于知识库生成目标语言回复 + 中文参考
  │  （并行执行）      │  翻译和回复同时开始，互不等待
  └──────────────────┘
       │ 两者都完成后
       ▼
  ┌──────────────────┐
  │   人工审核         │  审核员同时看到翻译结果和 AI 回复
  │                    │  三种决策：通过 / 驳回重写 / 驳回重译
  └──────────────────┘
       │
       ▼
  ┌──────────────────┐
  │   推送回复         │  自动或手动推送到 Freshdesk
  └──────────────────┘
```

### 3.2 BPMN 流程结构

```
START (初始化 loopBackToAudit=false)
  │
  ▼
PARALLEL FORK ─────────────────────────────────────────────┐
  │                                                         │
  ▼                                                         ▼
翻译分支                                                回复分支
  │                                                         │
  ├── 跳过决策（已有完整翻译？）                              ├── 跳过决策（非客户消息？）
  │    YES → skip_cb                                        │    YES → skip_cb
  │    NO  ↓                                                │    NO  ↓
  │                                                         │
  ├── AgentTaskDelegate                                     ├── AgentTaskDelegate
  │    创建翻译 TaskInstance                                  │    创建回复 TaskInstance
  │                                                         │
  ├── 环境检测网关                                           ├── 环境检测网关
  │    CLIENT_ONLY → ReceiveTask 等待                        │    CLIENT_ONLY → ReceiveTask 等待
  │    SERVER_ONLY → 跳过等待                                │    SERVER_ONLY → 跳过等待
  │                                                         │
  ├── done_cb（翻译完成回调）                                ├── done_cb（回复完成回调）
  │                                                         │
  └── 分支合并网关                                           └── 分支合并网关
       loopBack=true → 跳过 JOIN                                 loopBack=true → 跳过 JOIN
       loopBack=false → 进入 JOIN                                loopBack=false → 进入 JOIN
                   │                                                     │
                   └──────────────┬──────────────────────────────────────┘
                                  │
                           PARALLEL JOIN（等两条分支都到达）
                                  │
                                  ▼
                          both_done_cb（状态 → PENDING_AUDIT）
                                  │
                                  ▼
                          audit_create（HumanTaskDelegate，创建审核任务）
                                  │
                          audit_create_wait（ReceiveTask，等审核员完成）
                                  │
                                  ▼
                          审核结果网关 ──────────────────────────────────┐
                            │            │                               │
                           PASS        REJECT                      RETRANSLATE
                            │            │                               │
                      audit_pass_cb  audit_reject_cb             audit_retranslate_cb
                       推送回复       lastAuditRemark              lastAuditRemark
                        │             loopBack=true                loopBack=true
                        │                │                               │
                       END          → reply_agent                → translate_agent
                   (COMPLETED         (循环回回复)                  (循环回翻译)
                    或 APPROVED)
```

### 3.3 工单状态模型（已简化，适配并行网关）

状态已从 8 个精简为 6 个，用统一的 `PROCESSING` 代替了语义不清的并行中间状态：

```
PENDING_TRANS → PROCESSING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
```

| 状态            | 含义                                     | 由谁设置                           |
| --------------- | ---------------------------------------- | ---------------------------------- |
| PENDING_TRANS   | 等待启动（新工单/驳回重译/工作流重启）   | FreshdeskSync / auditRetranslate   |
| PROCESSING      | 翻译和回复并行执行中                     | startCallback（translationStarted）|
| PENDING_AUDIT   | 等待人工审核                             | bothDone 回调                      |
| AUDITING        | 审核进行中                               | auditStarted 回调                  |
| APPROVED        | 审核通过，等待手动推送                   | auditPass 回调（手动推送模式）     |
| COMPLETED       | 回复已推送到 Freshdesk                   | auditPass 回调（自动推送模式）     |

审核分支：PASS + 自动推送 → COMPLETED | PASS + 手动推送 → APPROVED | REJECT → PROCESSING（回到回复）| RETRANSLATE → PENDING_TRANS（回到翻译）

`TicketStateMachine` 提供声明式转换规则 + 幂等检查 + `forceTransition()` 用于工作流重启等管理操作。DB 层通过 `TicketStatusConverter` 兼容历史数据中的旧状态名。

### 3.4 TaskInstance 的完整生命周期

```
1. BPMN 执行到 Agent 节点
   AgentTaskDelegate.execute()
   ├── 查 AgentDefinition（executionEnv=CLIENT_ONLY）
   ├── buildPayload:
   │   {processInstanceId, waitActivityId, agentCode, agentInput, ticketId, subject, externalId}
   ├── taskDistributionService.createTask("ticket.translate", payload)
   ├── execution.setVariableLocal("pendingTaskType", "ticket.translate")
   └── 触发 startCallback（可选，如 ticket.translationStarted）

2. BPMN 环境检测网关
   pendingTaskType != null → 进入 ReceiveTask 等待
   pendingTaskType == null → 跳过等待（SERVER_ONLY 已同步执行完）

3. 前端消费者
   ├── SSE 收到 task-available 通知（或轮询兜底）
   ├── POST /tasks/claim → TaskInstance.status = CLAIMED
   ├── processOneTask():
   │   ├── GET /tickets/{id} 获取工单详情
   │   ├── ticket._agentCode = task.agentCode（工作流指定）
   │   ├── ticket._agentInput = task.agentInput（结构化输入）
   │   ├── AgentRegistry.resolve(agentCode) → {definition, executor}
   │   ├── executor.execute(definition, input) → Gemini/NotebookLM/API
   │   ├── serverApi.submitTranslation/submitReply() → 保存结果
   │   └── POST /tasks/{id}/complete (success=true)
   └── 超时保护 5 分钟，失败冷却（3 次失败 → 60 秒冷却）

4. 任务完成 → 工作流唤醒
   TaskCompletedEvent (@TransactionalEventListener AFTER_COMMIT)
   → WorkflowTaskCompletionListener
   → WorkflowTaskBridge.onTaskCompleted(task, {taskSuccess: true})
   → workflowService.signalReceiveTask(processInstanceId, waitActivityId)
   → BPMN ReceiveTask 唤醒，流程推进到下一节点

5. 审核完成（特殊路径）
   审核是人工操作（非 Agent 任务），业务代码显式调用：
   FlowableTicketOrchestrator.onAuditCompleted(ticket, result, remark, ...)
   → workflowService.signalReceiveTask(processInstanceId, "audit_create_wait", vars)
```

### 3.5 工单同步机制

两个入口，同一套处理逻辑：

| 入口     | 触发方式                  | 特点                                 |
| -------- | ------------------------- | ------------------------------------ |
| 定时轮询 | 15 分钟 cron              | 批量，updated_since 增量，带锁防并发 |
| Webhook  | Freshdesk Automation Rule | 单条，实时                           |

核心逻辑（`FreshdeskSyncService.processSingleTicket`）：
1. 拉取工单内容 + 所有对话（分页）
2. SHA-256 哈希比对，内容未变 → 跳过
3. 状态安全检查（不打断处理中的工单，不创建重复流程）
4. 新工单或内容变化的已完成工单 → ticket.status = PENDING_TRANS → 启动 BPMN

### 3.6 审核驳回的循环机制

- **REJECT**：`audit_reject_cb` → 流程连线回 `reply_agent`，重新生成回复
- **RETRANSLATE**：`audit_retranslate_cb` → 流程连线回 `translate_agent`，重新翻译

循环路径上设置 `loopBackToAudit=true`，让分支合并网关绕过并行 JOIN（避免死锁）。正常路径（`flow_both_done_to_audit`）上重置为 false。

驳回意见保存在 `ticket.lastAuditRemark`，注入下一轮 Agent Prompt，实现"审核反馈 → AI 改进"的迭代闭环。

---

## 四、关键文件索引

### 平台层（通用，不依赖具体业务）

| 文件                                                         | 职责                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `fd-server-workflow/.../WorkflowService.java`                | Flowable 引擎封装（启动/信号/查询）                              |
| `fd-server-workflow/.../AgentTaskDelegate.java`              | BPMN Agent 节点——检查 executionEnv，创建 TaskInstance 或同步执行 |
| `fd-server-workflow/.../HumanTaskDelegate.java`              | BPMN 人工任务节点——创建人工审核任务                              |
| `fd-server-workflow/.../BusinessCallbackDelegate.java`       | BPMN 回调节点——调用注册的业务回调                                |
| `fd-server-workflow/.../DecisionDelegate.java`               | BPMN 决策节点——通过数据提供者获取业务数据做判断                  |
| `fd-server-workflow/.../WorkflowCallbackRegistry.java`       | 回调注册中心（workflow ↔ 业务模块解耦）                          |
| `fd-server-workflow/.../WorkflowTaskBridge.java`             | 任务完成 → ReceiveTask 唤醒的桥接                                |
| `fd-server-workflow/.../WorkflowTaskCompletionListener.java` | TaskCompletedEvent 监听（AFTER_COMMIT）+ 失败重试/终止           |
| `fd-server-workflow/.../WorkflowTimeoutScheduler.java`       | ReceiveTask 超时检测与恢复（软超时 30min + 硬超时 24h）          |
| `fd-server-task/.../TaskDistributionService.java`            | 任务创建/领取/完成/释放/超时回收                                 |
| `fd-server-task/.../TaskRecoveryScheduler.java`              | 任务级超时回收（CLAIMED 超时 + FAILED 冷却恢复）                 |
| `fd-server-ai/.../AgentDefinition.java`                      | Agent 定义数据模型                                               |
| `fd-server-ai/.../AgentDispatchService.java`                 | Agent 服务端执行分发                                             |
| `fd-web/.../agents/AgentRegistry.ts`                         | 前端 Agent 注册中心（按 code/capability 解析）                   |
| `fd-web/.../agents/executors/*`                              | 四种执行器实现                                                   |
| `fd-web/.../context/createMQTaskContext.tsx`                 | 通用任务消费工厂（REST 轮询 + SSE）                              |

### 业务层（Freshdesk 工单场景）

| 文件                                                          | 职责                                               |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `fd-server-ticket/.../FreshdeskSyncService.java`              | Freshdesk 工单同步（轮询 + Webhook）               |
| `fd-server-ticket/.../FlowableTicketOrchestrator.java`        | 工单 ↔ BPMN 桥接（启动流程、审核信号）             |
| `fd-server-ticket/.../TicketWorkflowCallbackConfig.java`      | 工单回调注册（12 个回调 + 2 个数据提供者）         |
| `fd-server-ticket/.../TicketStateMachine.java`                | 工单状态机（6 态声明式转换 + 幂等 + forceTransition）|
| `fd-server-ticket/.../TicketService.java`                     | 工单业务逻辑（提交翻译/回复/审核）                 |
| `fd-server-ticket/.../ReplyPushService.java`                  | 回复推送到 Freshdesk                               |
| `fd-server-workflow/.../bpmn/ticket-standard-flow.bpmn20.xml` | 工单处理 BPMN 流程定义                             |
| `fd-web/.../hooks/useAiTranslation.ts`                        | 翻译 Agent 调用——纯函数 (ticket, options) → result |
| `fd-web/.../hooks/useAiReply.ts`                              | 回复 Agent 调用——支持流式输出                      |
| `fd-web/.../context/MQTranslationContext.tsx`                 | 翻译消费者配置（serial, batchSize=1）              |
| `fd-web/.../context/MQReplyContext.tsx`                       | 回复消费者配置（serial, batchSize=1, 1s 延迟）     |

---

## 五、已解决的问题

### 5.1 工单状态模型与并行网关的矛盾 ✅

**已解决**：8 个顺序状态精简为 6 个。移除了 `TRANSLATING`、`REPLYING`、`PENDING_REPLY`，用统一的 `PROCESSING` 代表并行执行阶段。`TicketStateMachine` 声明式转换规则 + `TicketStatusConverter` 兼容历史数据。详见 3.3 节。

### 5.2 任务失败时的工作流处理 ✅

**已解决**：`WorkflowTaskCompletionListener` 现在对 `success=false` 的任务实施分级处理：
- 未超重试上限 → 重置为 PENDING，增加 retryCount，发布 TaskPushEvent 通知客户端重新领取
- 已超重试上限 → 标记为 TIMEOUT，通过 WorkflowTaskBridge signal ReceiveTask 传入 `taskSuccess=false`，让 BPMN 流程感知失败

`WorkflowTimeoutScheduler`（每 2 分钟扫描）提供最后防线：
- 软超时（30 分钟）：检查 TaskInstance 状态，重新触发丢失的桥接信号
- 硬超时（24 小时）：强制终止流程实例

### 5.3 遗留的手动触发路径 ✅

**已解决**：统一为 `TicketService.restartWorkflow(ticketId)`，语义清晰：终止旧流程 → 强制回到 PENDING_TRANS → 启动新 BPMN 实例。旧方法 `triggerAiTranslation()` / `triggerAiReply()` 标记 `@Deprecated`，委托给 `restartWorkflow()`。新 REST 端点 `POST /tickets/{id}/restart-workflow`。

### 5.4 Webhook 并发竞态 ✅

**已解决**：三层防护：
1. **内存锁**：`ConcurrentHashMap<String, ReentrantLock>` 按 externalId 粒度，`tryLock()` 快速拒绝并发请求
2. **数据库悲观锁**：`findByExternalIdForUpdate` 使用 `@Lock(PESSIMISTIC_WRITE)` 的 `SELECT FOR UPDATE`
3. **流程运行检查**：`isProcessRunning` 守卫（已有机制，第三层兜底）

---

## 六、架构演进：Agent Runtime HTTP 服务化

### 6.1 动机

当前 Agent 执行能力（Gemini CLI 翻译、Shadow Window 浏览器自动化）通过 Tauri IPC 暴露，前端 JS 承担编排逻辑。这导致：
- 浏览器 dev 模式下所有 Agent 不可用（`tauriInvoke` 直接抛异常）
- Agent 编排逻辑分散在前端 TypeScript 中（`notebookShadow.ts`、`CliExecutor.ts`）
- 测试和调试必须依赖完整 Tauri 桌面环境

### 6.2 目标架构

**Agent 彻底与 Web 端解耦，作为本地 HTTP/SSE 流式服务运行。**

在现有 Tauri 应用中内嵌 axum HTTP/SSE 服务器（端口 9987），所有 Agent 编排逻辑移到 Rust：

```
Tauri App（单进程）
├── WebView 主窗口（前端 UI，可选）
├── Shadow WebView 窗口（浏览器自动化，Rust 编排）
├── axum HTTP/SSE Server (:9987)
│   ├── POST /bridge/translate          → Gemini CLI 翻译
│   ├── POST /bridge/gemini             → 通用 Gemini 执行
│   ├── POST /bridge/sync-translate     → 同步翻译回复
│   ├── POST /bridge/agents/reply       → NotebookLM 回复生成（SSE 流式）
│   ├── POST /bridge/agents/tracking    → 17track 物流查询
│   └── GET  /bridge/health             → 健康检查
└── Agent 编排引擎（Rust 原生）
    ├── CLI Agent: std::process::Command → gemini CLI
    └── Shadow Agent: Tauri WebView → eval(script) → 事件回调 → SSE
```

**前端变为纯消费者**：
- Tauri 桌面模式：`tauriInvoke` 走 IPC（现有路径不变）
- 浏览器 dev 模式：`tauriInvoke` 自动降级为 HTTP 调用 `/bridge/*`
- Agent Executor 的 `isAvailable()` 始终返回 `true`，实际可用性在执行时探测

### 6.3 实施阶段

**Phase 1**：CLI Agent HTTP 化 ✅ 已完成
- Tauri 内嵌 axum HTTP 服务器（端口 9987）
- 独立 `fd-bridge` 二进制（`cargo build --bin fd-bridge --no-default-features`）
- 暴露 3 个 Gemini CLI 端点（翻译、通用执行、同步翻译）
- 前端 `bridge.ts` 添加 HTTP fallback，`CliExecutor.isAvailable()` 始终返回 true
- 效果：浏览器模式下翻译功能可用

**Phase 2**：Shadow Window Agent SSE 化 ✅ 已完成
- Rust 侧实现 Shadow Window 编排引擎（`shadow_agent.rs`）— 独立 Agent 模块
- 编排逻辑（打开窗口→清理历史→多轮发送→observer+relay→完成检测）完整迁移到 Rust
- `bridge_server.rs` 新增 `POST /bridge/agents/reply` SSE 端点
- Tauri 模式自动传递 AppHandle 给 bridge server（`start_bridge_server_with_app`）
- `ShadowExecutor.ts` 双路径：Tauri 直连 + 浏览器 SSE bridge
- `AgentAutomationTab.tsx` reply capability 在浏览器模式通过 bridge 可启动
- 效果：浏览器模式下回复生成通过 fd-client (Tauri) 后台提供 Shadow Window 支持

### 6.4 关键设计决策

- **为什么不用 chromiumoxide？** Shadow Window 已有 Tauri WebView 实现，直接在 Rust 侧调用 `window.eval()` + `app.listen()` 即可，无需引入额外浏览器控制库。
- **为什么嵌入而非独立进程？** Shadow Window 需要 Tauri WebView，独立进程无法访问。嵌入方案一个进程提供 WebView + HTTP。
- **SSE 而非 WebSocket？** 回复生成是服务端单向推送场景，SSE 更简单，与现有 `EventStreamController` 模式一致。
