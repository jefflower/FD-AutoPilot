# Workflow 模块文档

## 模块概览

workflow 模块基于 **Flowable BPMN 2.0** 引擎，提供可视化流程编排能力。管理员可通过 bpmn-js 编辑器设计工作流，Flowable 引擎在服务端执行流程逻辑，通过 3 种 JavaDelegate 桥接 Agent 执行、人工任务、业务回调，实现工单处理的全自动化编排。

### 核心特性

- **BPMN 可视化设计** — 前端 bpmn-js 编辑器，支持拖拽设计流程
- **双轨编排** — Legacy（硬编码）和 Flowable（BPMN 驱动）可配置切换
- **Agent 桥接** — ServiceTask 自动调用 AI Agent（翻译/回复），支持 CLIENT_ONLY 和 SERVER_ONLY 两种执行模式
- **异步等待/唤醒** — ReceiveTask 暂停流程，WorkflowTaskBridge 在任务完成时自动唤醒
- **业务回调解耦** — WorkflowCallbackRegistry 注册中心，workflow 不直接依赖 ticket 模块
- **SSE 实时推送** — 流程状态变更通过 SSE 推送到前端

### 模块依赖

```
fd-server-workflow
    ↓ 依赖
fd-server-ai  (AgentDefinitionService, AgentDispatchService)
    ↓ 传递性依赖
fd-server-task (TaskDistributionService, SseConnectionManager)
    ↓
fd-server-auth (权限注解, 安全配置)
    ↓
fd-server-common (通用基础)
```

### Maven artifact

```xml
<dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-workflow</artifactId>
</dependency>
```

外部依赖：`flowable-spring-boot-starter-process 7.0.1`

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (fd-web)                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ WorkflowListTab │  │  BpmnEditor     │  │ WorkflowGuide  │  │
│  │ (流程定义管理)   │  │ (bpmn-js 编辑器)│  │ (使用说明)     │  │
│  └────────┬────────┘  └─────────────────┘  └────────────────┘  │
│           │ REST API                                             │
│  ┌────────┴─────────────────────────────────────────────────┐   │
│  │ ServerEventsContext (SSE 实时接收 workflow-status 事件)   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  服务端 (fd-server-workflow)                                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ Flowable BPMN Engine                                     │     │
│  │   ┌───────────────┐  ┌──────────────┐  ┌─────────────┐ │     │
│  │   │AgentTask      │  │HumanTask     │  │BusinessCB   │ │     │
│  │   │Delegate       │  │Delegate      │  │Delegate     │ │     │
│  │   └──────┬────────┘  └──────┬───────┘  └──────┬──────┘ │     │
│  └──────────┼──────────────────┼──────────────────┼────────┘     │
│             │                  │                  │               │
│  ┌──────────▼──────────────────▼──────────────────▼────────┐     │
│  │           WorkflowService (流程管理核心)                  │     │
│  │  deploy / start / signal / terminate / getActiveNodes    │     │
│  └──────────────────────────┬──────────────────────────────┘     │
│                             │                                     │
│  ┌──────────────────────────▼──────────────────────────────┐     │
│  │  WorkflowTaskBridge (任务完成 → 唤醒 ReceiveTask)       │     │
│  │  WorkflowCallbackRegistry (业务回调注册中心)             │     │
│  └──────────────────────────┬──────────────────────────────┘     │
│                             │ ApplicationEvent                    │
│  ┌──────────────────────────▼──────────────────────────────┐     │
│  │  WorkflowSseListener → SseConnectionManager → SSE 推送  │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### 双轨编排模式

系统支持 Legacy 和 Flowable 两种编排模式，通过配置属性 `fd.workflow.enabled` 切换：

| 属性值 | 编排器 | 特点 |
|--------|--------|------|
| `false` | `LegacyTicketOrchestrator` | 硬编码状态转换，直接创建 TaskInstance |
| `true`（当前默认）| `FlowableTicketOrchestrator` | BPMN 引擎驱动，通过 signal ReceiveTask 推进流程 |

**注意**：从 v0.4.1 起，`fd.workflow.enabled` 默认为 `true`，已完全切换到 Flowable 并行网关模式。

两者实现同一个 `TicketWorkflowOrchestrator` 接口：

```java
public interface TicketWorkflowOrchestrator {
    void onTranslationCompleted(Long ticketId, ...);
    void onReplyCompleted(Long ticketId, ...);
    void onAuditCompleted(Long ticketId, ...);
}
```

配置示例（`application.yml`）：

```yaml
fd:
  workflow:
    enabled: true   # 启用 Flowable 工作流
```

---

## BPMN 标准工单流程

### 流程结构（并行网关模式）

内置流程 `ticket-standard-flow`（标准工单处理流程），采用**并行网关**设计：

```
START → parallel_fork_gw → [翻译分支 || 回复分支] → parallel_join_gw → both_done_cb → audit_create → audit_create_wait → audit_result_gw → END
                                                                                                                          ↑                      │
                                                                                                                          └────── 驳回 ────────┘
```

**核心变化**：
- 翻译和回复**并行执行**，提升效率
- 两个分支都完成后才进入审核
- REJECT 驳回仅循环回 reply_agent（不重新翻译）

### 阶段详解

#### 1. 翻译分支

```
translate_agent → translate_env_gw → ┬→ translate_wait → translate_merge_gw
(AgentTask)      (环境网关)          │                   (合并网关)
                                     └→ (跳过等待) ──────→
```

- **translate_agent**（ServiceTask）: `agentTaskDelegate`
  - 字段配置：`taskType` 可通过 BPMN `FieldExtension` 配置（支持自定义任务类型）
  - CLIENT_ONLY → 创建 TaskInstance，设置 `pendingTaskType`
  - SERVER_ONLY → 服务端直接执行，`pendingTaskType=null`
- **translate_env_gw**（ExclusiveGateway）:
  - `${pendingTaskType != null}` → 进入 ReceiveTask 等待
  - `${pendingTaskType == null}` → 跳过等待，直接进入回调
- **translate_wait**（ReceiveTask）: 暂停流程，等待客户端完成翻译
- **translate_merge_gw**（ExclusiveGateway）: 汇聚网关

#### 2. 回复分支（并行执行）

```
reply_agent → reply_env_gw → ┬→ reply_wait → reply_merge_gw
(AgentTask)                   │               (汇聚网关)
                              └→ (跳过等待) ──→
```

- 同步骤 1，但使用 `agentCode=notebooklm-reply`

#### 3. 并行汇聚与审核

```
parallel_join_gw → both_done_cb → audit_create → audit_create_wait → audit_result_gw → ┬→ audit_pass_cb → END
(并行网关)        (业务回调)    (HumanTask)      (等待审核)           (结果网关)          │
                                                                                         └→ audit_reject_cb → reply_agent
                                                                                             (驳回回调)
```

- **parallel_join_gw**（ParallelGateway）: 等待翻译和回复分支都完成
- **both_done_cb**（ServiceTask）: `businessCallbackDelegate` + `callbackType=ticket.bothDone`
  - 更新工单状态为 `PENDING_AUDIT`
  - 发送审核通知
- **audit_create**（ServiceTask）: `humanTaskDelegate` + `humanTaskType=ticket.audit`
- **audit_create_wait**（ReceiveTask）: 等待人工审核完成
- **audit_result_gw**（ExclusiveGateway）:
  - `${auditResult == 'PASS'}` → `audit_pass_cb` → 流程结束
  - `${auditResult == 'REJECT'}` → `audit_reject_cb` → **循环回到 reply_agent（仅重新回复，不重新翻译）**

### 关键流程变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `pendingTaskType` | String | 当前等待的任务类型（null 表示服务端已执行） |
| `agentInput` | String | Agent 输入数据 |
| `agentSuccess` | Boolean | Agent 执行是否成功 |
| `agentResult` | String | Agent 执行结果 |
| `agentError` | String | Agent 执行错误信息 |
| `auditResult` | String | 审核结果（`PASS` / `REJECT`） |
| `auditRemark` | String | 审核意见 |
| `replyId` | Long | 回复 ID |
| `auditorId` | Long | 审核员 ID |

---

## 三种 JavaDelegate 桥接

### 1. AgentTaskDelegate — Agent 执行桥接

**Bean 名称**: `agentTaskDelegate`

**BPMN 配置**:
```xml
<serviceTask id="translate_agent" name="翻译 (Agent)"
             flowable:delegateExpression="${agentTaskDelegate}">
  <extensionElements>
    <flowable:field name="agentCode" stringValue="gemini-translate"/>
    <flowable:field name="taskType" stringValue="ticket.translate"/>
  </extensionElements>
</serviceTask>
```

**配置参数**:
- `agentCode` (必填) — Agent 唯一标识（如 `gemini-translate`, `notebooklm-reply`）
- `taskType` (可选) — 创建 TaskInstance 时的任务类型。若未指定，默认为 `workflow.agent.{agentCode}`

**执行逻辑**:
1. 从 `flowable:field` 读取 `agentCode` 和 `taskType`（也可从流程变量覆盖）
2. 查找 AgentDefinition，判断 `executionEnv`：
   - **CLIENT_ONLY**: 创建 TaskInstance（任务类型 = taskType 或默认 `workflow.agent.{agentCode}`），设置 `pendingTaskType`，后续 ReceiveTask 会暂停流程
   - **SERVER_ONLY / BOTH**: 调用 `agentDispatchService.executeOnServer()`，结果写入流程变量 `agentSuccess`/`agentResult`/`agentError`

**Payload 格式**（CLIENT_ONLY）:
```json
{
  "processInstanceId": "xxx",
  "waitActivityId": "translate_agent_wait",
  "agentCode": "gemini-translate",
  "businessKey": "123"
}
```

### 2. HumanTaskDelegate — 人工任务桥接

**Bean 名称**: `humanTaskDelegate`

**BPMN 配置**:
```xml
<serviceTask id="audit_create" name="创建审核任务"
             flowable:delegateExpression="${humanTaskDelegate}">
  <extensionElements>
    <flowable:field name="humanTaskType" stringValue="ticket.audit"/>
  </extensionElements>
</serviceTask>
```

**执行逻辑**:
1. 从 `flowable:field` 读取 `humanTaskType`
2. 创建 TaskInstance（包含 `processInstanceId` + `waitActivityId`）
3. 设置 `pendingTaskType`，后续 ReceiveTask 暂停等待人工操作

### 3. BusinessCallbackDelegate — 业务回调桥接

**Bean 名称**: `businessCallbackDelegate`

**BPMN 配置**:
```xml
<serviceTask id="translation_done_cb" name="翻译完成回调"
             flowable:delegateExpression="${businessCallbackDelegate}">
  <extensionElements>
    <flowable:field name="callbackType" stringValue="ticket.translationDone"/>
  </extensionElements>
</serviceTask>
```

**执行逻辑**:
1. 从 `flowable:field` 读取 `callbackType`
2. 通过 `WorkflowCallbackRegistry` 查找已注册的回调函数
3. 执行回调，传入 `businessKey` 和所有流程变量

**已注册的回调类型**（由 ticket 模块注册）:

| callbackType | 业务行为 |
|-------------|---------|
| `ticket.translationDone` | 更新工单状态为 PENDING_REPLY |
| `ticket.replyDone` | 更新工单状态为 PENDING_AUDIT |
| `ticket.auditPass` | 标记回复、推送到 Freshdesk |
| `ticket.auditReject` | 保存驳回意见、状态回退 |

---

## Agent 接入指南

### 接入概述

Agent 通过 BPMN ServiceTask + `AgentTaskDelegate` 接入工作流。需要以下步骤：

1. 在后端创建 AgentDefinition（或通过管理 UI）
2. 在前端注册对应的 Executor（如果是 CLIENT_ONLY）
3. 在 BPMN 流程中添加 ServiceTask 节点，引用 Agent

### 步骤 1：创建 Agent 定义

通过 AI Agent 管理 API 或管理界面创建 Agent 定义：

```json
POST /api/v1/agents/definitions
{
  "code": "my-custom-agent",
  "name": "自定义 Agent",
  "providerType": "HTTP_API",
  "executionEnv": "SERVER_ONLY",
  "capability": "custom-task",
  "providerConfig": {
    "url": "https://api.example.com/v1/chat",
    "model": "gpt-4",
    "apiKey": "${API_KEY}"
  },
  "enabled": true
}
```

#### Provider 类型说明

| providerType | 说明 | executionEnv |
|-------------|------|-------------|
| `LOCAL_CLI` | 本地 CLI 工具调用（如 Gemini CLI） | CLIENT_ONLY |
| `HTTP_API` | HTTP API 调用（如 OpenAI/Claude） | SERVER_ONLY / BOTH |
| `SHADOW_WINDOW` | Shadow Window 浏览器自动化 | CLIENT_ONLY |
| `LOCAL_FUNCTION` | 本地函数调用 | CLIENT_ONLY / BOTH |

#### 执行环境说明

| executionEnv | 说明 | 工作流行为 |
|-------------|------|-----------|
| `CLIENT_ONLY` | 只能在客户端执行 | 创建 TaskInstance → ReceiveTask 等待 → 客户端领取并执行 → 完成后唤醒流程 |
| `SERVER_ONLY` | 只能在服务端执行 | 服务端同步执行 → 结果直接写入流程变量 |
| `BOTH` | 两端均可执行 | 优先服务端执行（同 SERVER_ONLY） |

### 步骤 2：注册前端 Executor（CLIENT_ONLY）

如果 Agent 的 `executionEnv` 为 `CLIENT_ONLY`，需要在前端注册对应的 Executor。

在 `fd-web/src/shared/agents/executors/` 下创建 Executor 实现：

```typescript
import type { AgentExecutor } from './types';

export const myCustomExecutor: AgentExecutor = {
    providerType: 'LOCAL_CLI',

    isAvailable(): boolean {
        // 检查执行环境是否可用
        return isTauriEnv();
    },

    async execute(definition, input) {
        // 执行逻辑
        const result = await tauriInvoke('my_custom_cmd', {
            input: input.input,
        });
        return {
            success: true,
            output: result,
        };
    },
};
```

在 `AgentContext.tsx` 中注册：

```typescript
agentRegistry.registerExecutor(myCustomExecutor);
```

### 步骤 3：在 BPMN 流程中添加节点

在 BPMN 编辑器中添加 ServiceTask，配置如下：

```xml
<serviceTask id="my_agent_task" name="自定义 Agent 任务"
             flowable:delegateExpression="${agentTaskDelegate}">
  <extensionElements>
    <flowable:field name="agentCode" stringValue="my-custom-agent"/>
  </extensionElements>
</serviceTask>
```

如果是 CLIENT_ONLY Agent，还需要在后面添加环境网关和 ReceiveTask：

```xml
<!-- 环境网关 -->
<exclusiveGateway id="my_env_gw"/>
<sequenceFlow sourceRef="my_env_gw" targetRef="my_wait">
  <conditionExpression>${pendingTaskType != null}</conditionExpression>
</sequenceFlow>
<sequenceFlow sourceRef="my_env_gw" targetRef="my_merge_gw">
  <conditionExpression>${pendingTaskType == null}</conditionExpression>
</sequenceFlow>

<!-- 等待异步完成 -->
<receiveTask id="my_wait" name="等待自定义任务完成"/>

<!-- 合并网关 -->
<exclusiveGateway id="my_merge_gw"/>
```

### 步骤 4：注册业务回调（可选）

如果 Agent 完成后需要执行业务逻辑（如更新工单状态），需要：

1. 在 ticket 模块注册回调：

```java
@PostConstruct
public void registerCallbacks() {
    callbackRegistry.register("ticket.myTaskDone", (businessKey, vars) -> {
        Long ticketId = Long.parseLong(businessKey);
        // 执行业务逻辑...
    });
}
```

2. 在 BPMN 中添加回调节点：

```xml
<serviceTask id="my_task_done_cb" name="自定义任务完成回调"
             flowable:delegateExpression="${businessCallbackDelegate}">
  <extensionElements>
    <flowable:field name="callbackType" stringValue="ticket.myTaskDone"/>
  </extensionElements>
</serviceTask>
```

---

## 异步等待/唤醒机制

### 工作原理

CLIENT_ONLY Agent 的完整执行链：

```
                 服务端                                          客户端
┌────────────────────────────────────┐    ┌─────────────────────────────┐
│ 1. AgentTaskDelegate               │    │                             │
│    创建 TaskInstance                │    │                             │
│    payload = {processInstanceId,   │    │                             │
│               waitActivityId,      │    │                             │
│               agentCode}           │    │                             │
│                                    │    │                             │
│ 2. ReceiveTask 暂停流程            │    │                             │
│    (等待 signal)                   │    │                             │
│                                    │    │ 3. REST claim → 领取任务    │
│    ◄───── SSE task-available ─────►│    │    (或 SSE 推送触发)        │
│                                    │    │                             │
│                                    │    │ 4. 执行 Agent               │
│                                    │    │    (CLI/Shadow/Function)    │
│                                    │    │                             │
│                                    │    │ 5. POST /tasks/{id}/complete│
│ 6. TaskDistributionService         │◄───┤                             │
│    .completeTask()                 │    │                             │
│                                    │    └─────────────────────────────┘
│ 7. WorkflowTaskBridge              │
│    解析 payload 中的               │
│    processInstanceId + waitActivityId
│                                    │
│ 8. WorkflowService                 │
│    .signalReceiveTask()            │
│    唤醒流程，继续执行              │
│                                    │
│ 9. BusinessCallbackDelegate        │
│    执行业务回调                    │
└────────────────────────────────────┘
```

### WorkflowTaskBridge

`WorkflowTaskBridge` 是连接任务系统和工作流引擎的桥梁：

- 当 `TaskDistributionService.completeTask()` 被调用时，会触发 `WorkflowTaskBridge.onTaskCompleted()`
- Bridge 解析 TaskInstance 的 `payload` JSON
- 如果存在 `processInstanceId` 和 `waitActivityId`，调用 `WorkflowService.signalReceiveTask()` 唤醒流程

---

## SSE 实时推送

### 事件类型

| 事件类型 | 触发时机 | 数据结构 |
|---------|---------|---------|
| `workflow-status` | 流程启动/节点完成 | `{processInstanceId, businessKey, currentActivityId, status}` |
| `task-available` | 新任务创建 | `{taskType, taskInstanceId, referenceType, referenceId}` |
| `task-completed` | 任务完成 | `{taskType, taskInstanceId, success}` |

### 前端订阅

```typescript
import { useServerEvent } from '../shared/context/ServerEventsContext';

// 订阅工作流状态
useServerEvent('workflow-status', (data) => {
    console.log('流程进度:', data.status, data.currentActivityId);
});
```

---

## REST API

### 流程定义管理

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/workflows/definitions` | workflow:manage | 获取所有流程定义 |
| GET | `/api/v1/workflows/definitions/type/{businessType}` | workflow:manage | 按业务类型查询 |
| POST | `/api/v1/workflows/definitions` | workflow:manage | 创建流程定义 |
| PUT | `/api/v1/workflows/definitions/{id}` | workflow:manage | 更新流程定义 |
| DELETE | `/api/v1/workflows/definitions/{id}` | workflow:manage | 删除流程定义 |
| GET | `/api/v1/workflows/definitions/{id}/bpmn` | workflow:design | 获取 BPMN XML |
| PUT | `/api/v1/workflows/definitions/{id}/bpmn` | workflow:design | 保存 BPMN XML |
| POST | `/api/v1/workflows/definitions/{id}/deploy` | workflow:deploy | 部署到 Flowable 引擎 |

### 流程实例管理

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/workflows/instances/{processInstanceId}/activities` | workflow:monitor | 获取活跃节点 |
| POST | `/api/v1/workflows/instances/{processInstanceId}/signal` | workflow:monitor | 唤醒 ReceiveTask |
| DELETE | `/api/v1/workflows/instances/{processInstanceId}` | workflow:monitor | 终止流程 |

### SSE 事件流

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/v1/events/stream?clientId={id}` | SSE 长连接（需要 JWT 认证） |

---

## 数据模型

### WorkflowDefinition

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Long | 主键 |
| processKey | String | 流程标识（唯一） |
| name | String | 流程名称 |
| description | String | 描述 |
| businessType | String | 业务类型（如 `ticket`） |
| deploymentId | String | Flowable 部署 ID |
| processDefinitionId | String | Flowable 流程定义 ID |
| bpmnXml | String (CLOB) | BPMN 2.0 XML |
| enabled | Boolean | 是否启用 |
| builtIn | Boolean | 是否内置 |
| version | Integer | 版本号 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

表名：`wf_definition`

---

## 扩展点

### 1. 自定义 JavaDelegate

创建新的 `JavaDelegate` 实现，在 BPMN 中引用：

```java
@Component("myCustomDelegate")
public class MyCustomDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // 自定义逻辑
    }
}
```

BPMN 引用：`flowable:delegateExpression="${myCustomDelegate}"`

### 2. 注册业务回调

通过 `WorkflowCallbackRegistry.register()` 注册新的回调类型，无需修改 workflow 模块代码。

### 3. 新增 Agent

通过 Agent 管理 API 创建新 Agent 定义，在 BPMN 中通过 `agentCode` 引用即可。

### 4. 自定义流程

通过前端 BPMN 编辑器设计新流程，部署后即可使用。

---

## 权限定义

模块代码：`workflow`（工作流管理）

| 权限 code | 名称 | 说明 | 默认角色 |
|-----------|------|------|---------|
| `workflow:manage` | 管理工作流 | 创建/编辑/删除流程定义 | ADMIN |
| `workflow:deploy` | 部署工作流 | 部署流程到引擎 | ADMIN |
| `workflow:monitor` | 监控工作流 | 查看流程实例、手动信号 | ADMIN |
| `workflow:design` | 设计工作流 | 编辑 BPMN XML | ADMIN |

---

## 配置参考

### Flowable 引擎配置

`FlowableConfig.java`:
- `databaseSchemaUpdate = true` — 自动建表
- `asyncExecutorActivate = false` — 禁用异步执行器（使用自定义任务分发）
- `historyLevel = AUDIT` — 审计级别日志

### 数据初始化

`WorkflowDataInitializer.java` (CommandLineRunner, @Order(12)):
- 启动时自动创建 `ticket-standard-flow` 内置流程定义
- 加载 `bpmn/ticket-standard-flow.bpmn20.xml` 并自动部署到 Flowable

---

## 测试覆盖

### 单元测试统计

workflow 模块拥有 **38 个单元测试**，分布在 3 个测试类中，覆盖核心服务层：

| 测试类 | 测试数 | 被测代码 | 说明 |
|--------|--------|---------|------|
| `WorkflowServiceTest` | 20 | `WorkflowService` | 流程定义部署、启动、查询、终止、信号唤醒 |
| `WorkflowTaskBridgeTest` | 10 | `WorkflowTaskBridge` | 任务完成→流程唤醒、payload 解析、异常处理 |
| `WorkflowCallbackRegistryTest` | 8 | `WorkflowCallbackRegistry` | 业务回调注册、查询、执行 |

### WorkflowServiceTest (20 tests)

覆盖流程管理的完整生命周期：

1. `testDeploymentSuccess` — 流程定义部署成功
2. `testDeploymentInvalidBpmn` — 无效 BPMN XML 异常处理
3. `testDeploymentDuplicate` — 重复部署（同 processKey）
4. `testStartProcessInstance` — 启动流程实例
5. `testStartProcessInstanceWithVariables` — 带流程变量启动
6. `testStartProcessInstanceNotFound` — 流程定义不存在异常
7. `testGetActiveNodes` — 查询活跃节点
8. `testGetActiveNodesMultiple` — 多个并行节点
9. `testSignalReceiveTask` — 信号唤醒 ReceiveTask
10. `testSignalReceiveTaskNotFound` — ReceiveTask 不存在异常
11. `testSignalReceiveTaskWithVariables` — 带变量唤醒
12. `testTerminateProcessInstance` — 终止流程实例
13. `testTerminateProcessInstanceNotFound` — 流程实例不存在异常
14. `testGetProcessHistory` — 查询流程历史
15. `testGetProcessVariables` — 获取流程变量
16. `testSetProcessVariables` — 设置流程变量
17. `testProcessVariablesPersistence` — 流程变量持久化
18. `testConcurrentProcessExecution` — 并发流程执行
19. `testProcessStateTransition` — 流程状态转换正确性
20. `testProcessTimeoutHandling` — 流程超时处理

### WorkflowTaskBridgeTest (10 tests)

覆盖任务系统与工作流引擎的交互：

1. `testOnTaskCompletedWithValidPayload` — 有效 payload 的任务完成
2. `testOnTaskCompletedParsePayload` — payload JSON 解析
3. `testOnTaskCompletedSignalProcess` — 任务完成后唤醒流程
4. `testOnTaskCompletedUpdateProcessVariables` — 更新流程变量
5. `testOnTaskCompletedInvalidJson` — 无效 JSON payload 异常处理
6. `testOnTaskCompletedMissingFields` — payload 缺少必要字段异常
7. `testOnTaskCompletedProcessNotFound` — 流程实例不存在异常
8. `testOnTaskCompletedActivityNotFound` — 活动不存在异常
9. `testOnTaskCompletedConcurrentSignal` — 并发任务完成信号
10. `testBridgeConnectionStability` — 桥接连接稳定性

### WorkflowCallbackRegistryTest (8 tests)

覆盖业务回调的注册和执行：

1. `testRegisterCallback` — 注册新回调
2. `testRegisterCallbackDuplicate` — 重复注册同 callbackType
3. `testGetCallback` — 查询已注册的回调
4. `testGetCallbackNotFound` — 查询未注册的回调
5. `testExecuteCallback` — 执行回调函数
6. `testExecuteCallbackWithVariables` — 回调传入流程变量
7. `testCallbackExecutionException` — 回调执行异常处理
8. `testCallbackRegistry Deregistration` — 移除已注册的回调

### 测试运行

```bash
# 运行 workflow 模块所有测试
cd fd-server
mvn test -pl fd-server-workflow

# 运行特定测试类
mvn test -pl fd-server-workflow -Dtest=WorkflowServiceTest

# 生成覆盖率报告
mvn test -pl fd-server-workflow jacoco:report
```

---

## 代码结构

```
fd-server-workflow/
├── src/main/java/com/jefflower/fdserver/workflow/
│   ├── config/
│   │   ├── FlowableConfig.java          # Flowable 引擎配置
│   │   ├── WorkflowDataInitializer.java  # 内置流程初始化
│   │   └── WorkflowPermissionDefinition.java  # 权限自注册
│   ├── controller/
│   │   ├── WorkflowDefinitionController.java  # 流程定义 CRUD API
│   │   └── WorkflowInstanceController.java    # 流程实例管理 API
│   ├── delegate/
│   │   ├── AgentTaskDelegate.java        # Agent 执行桥接（支持 taskType 可配置）
│   │   ├── HumanTaskDelegate.java        # 人工任务桥接
│   │   └── BusinessCallbackDelegate.java # 业务回调桥接
│   ├── listener/
│   │   └── WorkflowTaskCompletionListener.java # ApplicationEventListener，监听 TaskCompletedEvent
│   ├── entity/
│   │   └── WorkflowDefinition.java       # 流程定义实体
│   ├── event/
│   │   ├── WorkflowStatusEvent.java      # 流程状态变更事件
│   │   └── WorkflowSseListener.java      # SSE 推送监听
│   ├── repository/
│   │   └── WorkflowDefinitionRepository.java
│   └── service/
│       ├── WorkflowService.java          # 流程管理核心
│       ├── WorkflowTaskBridge.java       # 任务完成→流程唤醒
│       └── WorkflowCallbackRegistry.java # 业务回调注册中心
├── src/main/resources/
│   └── bpmn/
│       └── ticket-standard-flow.bpmn20.xml  # 内置标准工单流程（并行网关）
└── pom.xml
```
