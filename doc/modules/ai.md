# AI Agent 模块 (fd-server-ai)

`ai` 模块是统一的 AI Agent 管理层，负责 Agent 定义、执行日志、能力绑定和 SPI 扩展，为全系统提供可配置、可追踪的 AI 调用能力。

## 模块概览

### Maven 坐标

```xml
<dependency>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-ai</artifactId>
    <version>${project.version}</version>
</dependency>
```

**模块性质**: AI Agent 管理模块，被 `fd-server-ticket` 依赖（可选），依赖 `fd-server-task`（传递获得 auth + common）。

**包路径**: `com.jefflower.fdserver.ai.*`

**核心职责**:
- Agent 定义管理（CRUD、启用/禁用、内置 Agent 初始化）
- 能力绑定（capability → agentCode 映射，管理员可通过 UI 切换 Agent）
- 服务端 Agent 调度执行（通过 AgentProvider SPI 扩展）
- 执行日志记录（客户端上报 + 服务端自动记录）
- 统计仪表盘（成功率、平均耗时、调用次数）

**设计理念**:
- 新模块通过 3-5 行代码接入 AI 能力（前端 `useAgent(code)` Hook）
- Provider 注册机制（服务端 SPI + 前端 Executor 注册）实现零代码扩展
- 管理员可通过 UI 配置所有 Agent，无需修改代码

---

## 模块架构

### 子模块结构

```
ai/
├── controller/
│   ├── AgentDefinitionController.java     # Agent 定义 CRUD + 启用/禁用
│   ├── AgentExecutionController.java      # 执行、上报、日志、统计
│   └── AgentBindingController.java        # 能力绑定管理
├── service/
│   ├── AgentDefinitionService.java        # Agent 定义 CRUD 逻辑
│   ├── AgentExecutionService.java         # 执行日志记录 + 统计
│   ├── AgentDispatchService.java          # 服务端调度核心
│   ├── AgentBindingService.java           # 能力 → Agent 绑定管理
│   ├── AgentProvider.java                 # SPI 接口（服务端 Provider）
│   ├── AgentBinding.java                  # 绑定实体
│   └── AgentBindingRepository.java        # 绑定 Repository
├── provider/
│   └── HttpApiAgentProvider.java          # 通用 HTTP API Provider（OpenAI/Claude 等）
├── entity/
│   ├── AgentDefinition.java               # Agent 定义实体
│   └── AgentExecution.java                # 执行日志实体
├── repository/
│   ├── AgentDefinitionRepository.java
│   └── AgentExecutionRepository.java
├── dto/
│   ├── AgentExecuteRequest.java           # 服务端执行请求
│   ├── AgentExecuteResult.java            # 执行结果
│   ├── AgentExecutionReport.java          # 客户端上报
│   ├── AgentProxyTestResult.java          # 代理连接测试结果（reachable, models, errorMessage）
│   └── AgentStats.java                    # 统计数据
├── enums/
│   ├── ProviderType.java                  # LOCAL_CLI | HTTP_API | SHADOW_WINDOW | LOCAL_FUNCTION
│   ├── ExecutionEnv.java                  # CLIENT_ONLY | SERVER_ONLY | BOTH
│   └── ExecutionStatus.java               # RUNNING | SUCCESS | FAILED | TIMEOUT | CANCELLED
└── config/
    ├── AiPermissionDefinition.java        # 权限自注册（3 个权限）
    └── AiDataInitializer.java             # 内置 Agent 初始化（3 个）
```

---

## REST API

所有端点前缀: `/api/v1/agents`

### Agent 定义管理

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/definitions` | 登录用户 | 获取所有已启用的 Agent 定义（前端初始化用） |
| `GET` | `/definitions/all` | ai:manage | 获取全部 Agent 定义（含禁用，管理 UI 用） |
| `GET` | `/definitions/client` | 登录用户 | 获取客户端可执行的 Agent 定义（排除 SERVER_ONLY） |
| `GET` | `/definitions/capability/{capability}` | 登录用户 | 按能力标签查找 Agent |
| `POST` | `/definitions/test-proxy` | ai:manage | 测试 HTTP API 代理连接（返回可达性 + 可用模型列表） |
| `POST` | `/definitions` | ai:manage | 创建 Agent 定义 |
| `PUT` | `/definitions/{id}` | ai:manage | 更新 Agent 定义（code 和 builtIn 不可改） |
| `PUT` | `/definitions/{id}/toggle` | ai:manage | 启用/禁用切换 |
| `DELETE` | `/definitions/{id}` | ai:manage | 删除 Agent 定义（内置 Agent 不可删） |

#### 创建 Agent 定义示例

```http
POST /api/v1/agents/definitions
Content-Type: application/json

{
    "code": "openai-summary",
    "name": "OpenAI 邮件摘要",
    "description": "通过 OpenAI API 生成邮件摘要",
    "providerType": "HTTP_API",
    "executionEnv": "SERVER_ONLY",
    "capability": "summary",
    "providerConfig": "{\"baseUrl\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o-mini\",\"apiKeyConfigKey\":\"openai_api_key\",\"maxTokens\":500}",
    "sortOrder": 10
}
```

响应:
```json
{
    "code": 200,
    "message": "Agent 创建成功",
    "data": {
        "id": 4,
        "code": "openai-summary",
        "name": "OpenAI 邮件摘要",
        ...
    }
}
```

### Agent 执行与日志

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| `POST` | `/execute/{code}` | ai:execute | 服务端执行 Agent |
| `POST` | `/executions/report` | 登录用户 | 客户端上报执行结果 |
| `GET` | `/executions` | ai:view_logs | 执行日志列表（分页，可按 agentCode 筛选） |
| `GET` | `/stats` | ai:view_logs | 统计仪表盘（各 Agent 成功率、耗时、调用次数） |

#### 服务端执行示例

```http
POST /api/v1/agents/execute/openai-summary
Content-Type: application/json

{
    "input": "{\"subject\":\"Order inquiry\",\"body\":\"...\"}",
    "referenceType": "email",
    "referenceId": 123
}
```

#### 客户端上报示例

```http
POST /api/v1/agents/executions/report
Content-Type: application/json

{
    "agentCode": "gemini-translate",
    "status": "SUCCESS",
    "durationMs": 3500,
    "tokenCount": 1200,
    "referenceType": "ticket",
    "referenceId": 456,
    "executedOn": "client:desktop-001"
}
```

### 能力绑定管理

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/bindings` | 登录用户 | 获取所有能力绑定（capability → agentCode） |
| `PUT` | `/bindings/{capability}` | ai:manage | 设置绑定 |
| `DELETE` | `/bindings/{capability}` | ai:manage | 移除绑定（回退到默认优先级） |

#### 设置绑定示例

```http
PUT /api/v1/agents/bindings/translation
Content-Type: application/json

{
    "agentCode": "gemini-translate"
}
```

---

## 模块间 Service 接口

### AgentDefinitionService（供其他模块查询 Agent 定义）

```java
List<AgentDefinition> findAll();                          // 全部定义（按 sortOrder 排序）
List<AgentDefinition> findEnabled();                      // 已启用的定义
List<AgentDefinition> findByCapability(String capability); // 按能力查找
Optional<AgentDefinition> findByCode(String code);         // 按 code 查找
```

### AgentDispatchService（供其他模块在服务端执行 Agent）

```java
AgentExecuteResult executeOnServer(String agentCode, String input,
                                    String refType, Long refId, String userId);
List<AgentDefinition> getClientExecutableAgents();  // 客户端可执行的 Agent 列表
```

### AgentExecutionService（供其他模块记录执行日志）

```java
AgentExecution startExecution(String agentCode, String refType, Long refId,
                               String executedBy, String executedOn);
void completeExecution(Long executionId, boolean success, Long durationMs,
                        Integer tokenCount, String output, String error);
void reportFromClient(AgentExecutionReport report);       // 客户端上报
List<AgentStats> getStatsDashboard();                     // 统计数据
```

### AgentBindingService（能力绑定解析）

```java
Map<String, String> getAllBindings();         // 全部绑定
String getBinding(String capability);        // 获取指定能力的绑定
void setBinding(String capability, String agentCode);  // 设置绑定
void removeBinding(String capability);       // 移除绑定
String resolveAgentCode(String capability);  // 解析能力 → agentCode（优先绑定，回退默认）
```

---

## 数据模型

### AgentDefinition（Agent 定义表）

```sql
CREATE TABLE ai_agent_definition (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) UNIQUE NOT NULL,          -- 唯一标识（如 "gemini-translate"）
    name VARCHAR(255) NOT NULL,                -- 显示名（如 "Gemini CLI 翻译"）
    description VARCHAR(500),                  -- 描述
    provider_type VARCHAR(32) NOT NULL,        -- LOCAL_CLI | HTTP_API | SHADOW_WINDOW | LOCAL_FUNCTION
    execution_env VARCHAR(32) NOT NULL,        -- CLIENT_ONLY | SERVER_ONLY | BOTH
    capability VARCHAR(64) NOT NULL,           -- 能力标签（"translation" | "reply" | "tracking"）
    provider_config TEXT,                      -- JSON: 各 Provider 特有配置
    enabled BOOLEAN DEFAULT TRUE,              -- 是否启用
    sort_order INT DEFAULT 0,                  -- 排序顺序
    built_in BOOLEAN DEFAULT FALSE,            -- 内置 Agent 不可删除
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);
```

### AgentExecution（执行日志表）

```sql
CREATE TABLE ai_agent_execution (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_code VARCHAR(64) NOT NULL,           -- 关联 AgentDefinition.code
    status VARCHAR(32) NOT NULL,               -- RUNNING | SUCCESS | FAILED | TIMEOUT | CANCELLED
    reference_type VARCHAR(64),                -- 关联业务类型（"ticket"、"email"）
    reference_id BIGINT,                       -- 关联业务 ID
    executed_by VARCHAR(128),                  -- 执行者（userId 或 clientId）
    executed_on VARCHAR(128),                  -- "server" | "client:{clientId}"
    duration_ms BIGINT,                        -- 执行耗时（毫秒）
    token_count INT,                           -- Token 消耗（若可统计）
    input_snapshot TEXT,                        -- 输入摘要（截断 2000 字符）
    output_snapshot TEXT,                       -- 输出摘要（截断 2000 字符）
    error_message TEXT,                        -- 失败原因
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_agent_exec_code ON ai_agent_execution(agent_code);
CREATE INDEX idx_agent_exec_time ON ai_agent_execution(created_at);
```

### AgentBinding（能力绑定表）

```sql
CREATE TABLE ai_agent_binding (
    capability VARCHAR(64) PRIMARY KEY,        -- 能力标签（如 "translation"）
    agent_code VARCHAR(64) NOT NULL,           -- 关联 AgentDefinition.code
    updated_at TIMESTAMP
);
```

### ProviderType 枚举

| 值 | 含义 | 执行位置 | 示例 |
|----|------|---------|------|
| `LOCAL_CLI` | 本地 CLI 工具 | 仅客户端（Tauri invoke） | Gemini CLI |
| `HTTP_API` | HTTP API 调用 | 服务端或前端均可 | OpenAI API、Claude API |
| `SHADOW_WINDOW` | Shadow Window 交互 | 仅客户端（Tauri WebView） | NotebookLM |
| `LOCAL_FUNCTION` | 本地 JS/Rust 函数 | 客户端或服务端 | 规则引擎、模板填充 |

### ExecutionEnv 枚举

| 值 | 含义 |
|----|------|
| `CLIENT_ONLY` | 仅桌面客户端可执行（需要 Tauri） |
| `SERVER_ONLY` | 仅服务端可执行（有 API Key） |
| `BOTH` | 前端和后端都可执行 |

---

## 内置 Agent

系统启动时通过 `AiDataInitializer` 自动创建 4 个内置 Agent（已存在则跳过）：

| code | name | providerType | executionEnv | capability |
|------|------|-------------|-------------|-----------|
| `gemini-translate` | Gemini CLI 翻译 | LOCAL_CLI | CLIENT_ONLY | translation |
| `notebooklm-reply` | NotebookLM 回复 | SHADOW_WINDOW | CLIENT_ONLY | reply |
| `tracking-query` | 物流查询 | SHADOW_WINDOW | CLIENT_ONLY | tracking |
| `antigravity-translate` | Antigravity 翻译 | HTTP_API | BOTH | translation |

内置 Agent 标记为 `builtIn = true`，不可通过 API 删除。

### providerConfig 结构

各 Agent 的 `providerConfig` JSON 结构：

| Agent | providerConfig 字段 |
|-------|-------------------|
| `gemini-translate` | `{invokeCommand, model, timeout}` |
| `notebooklm-reply` | `{windowLabel, notebookId, notebookUrl, prompt}` |
| `tracking-query` | `{windowLabel}` |
| `antigravity-translate` | `{baseUrl, model, apiKey, maxTokens, systemPrompt}` |

**notebooklm-reply** 的 providerConfig 同时承载 NotebookLM 配置（notebookId/notebookUrl/prompt），管理员在 Agent 管理页面通过结构化面板编辑。前端 `useAiReply` 和 `ServerTicketDetail` 从 agent definition 的 providerConfig 读取这些配置（不再从 useSettings 读取）。

---

## 扩展点

### 1. AgentProvider SPI（服务端 Provider）

实现 `AgentProvider` 接口并注册为 Spring Bean，即可扩展服务端执行能力：

```java
@Component
public class MyCustomProvider implements AgentProvider {
    @Override
    public ProviderType getProviderType() {
        return ProviderType.HTTP_API;  // 每个 ProviderType 一个实现
    }

    @Override
    public AgentExecuteResult execute(String input, Map<String, Object> config) {
        // config 来自 AgentDefinition.providerConfig（JSON 解析后）
        // 返回执行结果
    }
}
```

当前内置实现: `HttpApiAgentProvider`（支持 OpenAI/Claude 等标准 Chat Completion API）。

`HttpApiAgentProvider` 同时提供 `testProxy(baseUrl, apiKey)` 方法，用于检测本地代理服务器的连通性和可用模型列表（前端 Agent 管理页面的"检测连接"功能调用此方法）。

### 2. 前端 AgentExecutor 注册

前端通过 `AgentRegistry` 注册 Executor 实现，支持 4 种 ProviderType：

| Executor | ProviderType | 执行方式 |
|----------|-------------|---------|
| `CliExecutor` | LOCAL_CLI | `tauriInvoke(config.invokeCommand, ...)` |
| `HttpApiExecutor` | HTTP_API | `POST /agents/execute/{code}` 代理到服务端 |
| `ShadowExecutor` | SHADOW_WINDOW | NotebookShadowService / TrackingShadow |
| `FunctionExecutor` | LOCAL_FUNCTION | 本地注册的 JS 函数 |

### 3. 新增 Agent 流程

管理员通过 UI 或 API 创建 Agent 定义，前端通过 `useAgent(code)` 调用，无需修改代码。

---

## 权限定义

通过 `AiPermissionDefinition` 自动注册到 auth 模块：

| 权限 Code | 描述 | 默认角色 |
|-----------|------|---------|
| `ai:manage` | 管理 Agent 定义 | ADMIN |
| `ai:execute` | 执行 Agent | ADMIN, USER |
| `ai:view_logs` | 查看执行日志 | ADMIN |

模块信息: code=`ai`, name=`AI Agent 管理`, icon=`cpu`, routePath=`/ai`, sortOrder=`4`

---

## 依赖关系

```
common ← auth ← task ← ai ← ticket ← app
```

- ai 依赖 task（传递获得 auth + common）
- ai 使用 auth 模块的 `@RequiresPermission` 注解和 `ModulePermissionDefinition` 接口
- ai 使用 common 模块的 `ApiResponse`、`BusinessException`、`ErrorCode`
- ticket 可选依赖 ai（通过 `AgentDispatchService` 在服务端触发 AI 任务）

### Maven 依赖配置

```xml
<!-- fd-server-ai/pom.xml -->
<dependencies>
    <dependency>
        <groupId>com.jefflower</groupId>
        <artifactId>fd-server-task</artifactId>
        <version>${project.version}</version>
    </dependency>
</dependencies>
```
