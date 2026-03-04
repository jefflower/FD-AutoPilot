# FD-AutoPilot 自演进架构愿景

> 赛博云办公室 — 任意端 Agent 互联、AI 驱动的自演进工作流平台

## 1. 愿景概述

FD-AutoPilot 的终极目标是成为一个**赛博云办公室（Cyber Cloud Office）**——一个任意端 Agent 都能注册、互联、被工作流编排调用的 AI 原生平台。它有两个核心支柱：

1. **Agent 互联**：来自任意端（桌面客户端、Web 浏览器、远程服务器、第三方 AI 服务、其他 FD-AutoPilot 实例）的 Agent 都能通过统一协议注册到系统，被 n8n 工作流调用和编排。系统不再局限于本地执行，而是成为一个分布式 AI 劳动力的调度中枢。

2. **自我演进**：系统内置标准开发工作流，用户通过"信箱"提出改进意见，AI Agent 团队自动完成从需求整理、方案设计、编码实现到测试发布的完整开发闭环。

### 核心理念

```
赛博云办公室：任意端 Agent 注册 → 统一能力池 → n8n 工作流按需编排

自演进闭环：
用户提出改进意见 → AI 需求经理整理需求 → CTO Agent 评估可行性
→ 研发总监 Agent 带领团队开发 → 代码提交 → Jenkins 自动构建测试版
→ 用户验收测试 → 确认升级 → 系统自动完成生产发布
```

这不是科幻设想——FD-AutoPilot v0.4 已经具备了支撑这一愿景的核心基础设施：Agent 定义/实例分离、Capability 级路由、Sync Bridge 同步调用、n8n 工作流编排、Jenkins CI/CD 集成、RBAC 权限体系。Agent 互联和自演进是这些能力的自然延伸。

## 2. 从工单处理到自演进——架构演进路径

### 2.1 现有架构复用分析

v0.4 为自演进提供的基础设施：

| 已有能力 | 在自演进中的角色 | 复用程度 |
|---------|----------------|---------|
| **AgentDefinition + Instance** | 定义需求经理、CTO、研发总监等 Agent | 直接复用 |
| **Capability 体系** | 新增 `claude-code` 等开发能力 | 扩展新 Capability |
| **Sync Bridge** | AI Agent 间同步协作的通信通道 | 直接复用 |
| **n8n 工作流** | 编排开发工作流（需求→设计→开发→发布） | 新建工作流 |
| **TaskInstance + 路由** | 开发任务的分发、认领、完成 | 直接复用 |
| **RBAC 权限** | 控制谁可以提需求、谁可以确认发布 | 扩展新权限 |
| **Jenkins 集成** | 自动构建、测试、部署 | 从 iframe 嵌入升级为 API 集成 |
| **SSE 实时推送** | 开发进度实时通知 | 直接复用 |
| **SystemConfig** | 自演进工作流的配置管理 | 扩展新配置项 |
| **KnowledgeNote** | 存储架构文档、编码规范作为 Agent 上下文 | 直接复用 |

### 2.2 架构分层

```
┌─────────────────────────────────────────────────────────────────────────┐
│  用户交互层                                                               │
│  信箱（Inbox）— 用户提交改进意见、Bug 报告、功能请求                          │
│  开发看板（DevBoard）— 需求状态追踪、版本进度、测试验收                        │
│  升级控制台（UpgradeConsole）— 测试版预览、确认升级、回滚操作                  │
│  Agent 市场（AgentHub）— 发现、注册、管理来自任意端的 Agent                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│  Agent 互联层（赛博云办公室）                                               │
│                                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │
│  │ 本地 Agent    │ │ 远程 Agent   │ │ 联邦 Agent   │ │ 第三方 Agent     │  │
│  │ Tauri/Web    │ │ HTTP 回调    │ │ 跨实例互联   │ │ API 适配         │  │
│  │ SSE Pull     │ │ Webhook Push │ │ Federation   │ │ OpenAI/Claude/..│  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └───────┬─────────┘  │
│         └───────────────┴───────────────┴────────────────┘              │
│                         │  统一注册协议 + Capability 声明                 │
│                         │  心跳/健康检查 + 认证授权                       │
│                         ▼                                                │
│              ┌──────────────────────┐                                    │
│              │ Agent Registry (统一) │  Round-Robin / 就近 / 权重路由     │
│              │ Capability Pool      │  断路器 + 熔断降级                   │
│              └──────────────────────┘                                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│  AI Agent 管理层                                                         │
│                                                                          │
│  ┌──────────────┐ ┌──────────┐ ┌──────────────┐ ┌────────────────────┐ │
│  │ 需求经理 Agent │ │ CTO Agent │ │ 研发总监 Agent │ │ Agent Teams       │ │
│  │ 整理/分类需求  │ │ 可行性评估 │ │ 任务分解/分配  │ │ (backend-dev,    │ │
│  │ 优先级排序    │ │ 架构决策   │ │ 进度管控      │ │  frontend-dev,   │ │
│  │ 冲突检测     │ │ 风险评估   │ │ 代码审查      │ │  rust-dev, ...)  │ │
│  └──────────────┘ └──────────┘ └──────────────┘ └────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│  工作流编排层（n8n）                                                       │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 开发工作流（Development Pipeline）                                    ││
│  │ 定时扫描信箱 → 需求整理 → CTO 评审 → 任务分解 → 并行开发            ││
│  │     → 代码审查 → Git 提交 → Jenkins 构建 → 测试/发布                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 工单处理工作流（已有）                                                 ││
│  │ 定时扫描 → 翻译 → 分类 → 回复 → 审核 → 推送                         ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 自定义业务工作流（未来）                                                ││
│  │ 任意业务流程 → 跨端 Agent 协作 → 结果汇总                              ││
│  └─────────────────────────────────────────────────────────────────────┘│
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│  执行基础设施层                                                           │
│                                                                          │
│  Sync Bridge (同步调用)    │  Task Router (任务路由)                      │
│  Client Registration (注册) │  SSE (实时推送) + Webhook (推送)             │
│  Circuit Breaker (断路器)   │  RBAC (权限控制)                             │
│  Jenkins API (CI/CD)       │  Git Operations (版本控制)                    │
│  Federation Protocol (联邦) │  Service Account (服务账号)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. 信箱系统（Inbox）

### 3.1 定位

信箱是系统与用户之间的需求通道。用户无需了解技术细节，只需用自然语言描述"系统哪里不好用"或"希望增加什么功能"。

### 3.2 数据模型

```
InboxMessage（信箱消息）
├── id: Long
├── userId: String              -- 提交者
├── type: enum                  -- BUG_REPORT / FEATURE_REQUEST / IMPROVEMENT / QUESTION
├── title: String               -- 标题
├── content: TEXT               -- 详细描述（支持 Markdown + 截图）
├── priority: enum              -- URGENT / HIGH / NORMAL / LOW（AI 或人工标记）
├── status: enum                -- SUBMITTED → TRIAGED → PLANNED → IN_PROGRESS
│                                   → TESTING → RELEASED → CLOSED
├── aiSummary: TEXT             -- AI 需求经理整理后的结构化摘要
├── linkedDevTaskId: Long       -- 关联的开发任务
├── linkedVersionId: Long       -- 关联的版本号
├── feedbackRating: int         -- 用户对处理结果的满意度评分
├── createdAt / updatedAt
└── comments: List<InboxComment> -- 用户与 AI 的对话记录
```

### 3.3 用户交互流程

```
用户 ──[提交改进意见]──→ 信箱
                           │
                     AI 需求经理定期扫描
                           │
                     ┌─────▼──────┐
                     │ 结构化整理   │  提取关键信息、分类、评估优先级
                     │ 合并相似需求 │  检测与现有需求的重复/冲突
                     │ 补充上下文   │  关联代码位置、影响范围
                     └─────┬──────┘
                           │
                     [通知用户确认]
                           │
              用户确认 ←───┤───→ 用户补充说明 → 再次整理
                    │
              进入开发流水线
```

## 4. AI Agent 团队设计

### 4.1 需求经理 Agent（Product Manager）

**职责**：需求整理、优先级评估、需求池管理

```yaml
AgentDefinition:
  code: dev-product-manager
  capability: dev-requirement-analysis
  requiredCapability: claude-cli
  groupCode: development

  systemPrompt: |
    你是 FD-AutoPilot 的 AI 需求经理。

    你的职责：
    1. 定期扫描信箱中的新消息，提取结构化需求
    2. 对需求进行分类：Bug 修复 / 功能增强 / 新功能 / 性能优化 / UI 改进
    3. 评估优先级（基于影响范围、紧急程度、技术复杂度）
    4. 合并相似需求，检测冲突需求
    5. 生成需求规格文档（PRD），包含：
       - 用户故事
       - 验收标准
       - 影响范围（涉及哪些模块）
       - 预估复杂度（S/M/L/XL）

    你可以访问的上下文：
    - 系统架构文档（CLAUDE.md, v0.4-vision.md）
    - 现有模块结构和 API 列表
    - 历史需求和版本记录

  inputSchema: |
    { "inboxMessages": [...], "existingRequirements": [...] }

  outputSchema: |
    {
      "requirements": [{
        "title": "...",
        "type": "FEATURE|BUG|IMPROVEMENT|PERFORMANCE",
        "priority": "P0|P1|P2|P3",
        "userStory": "作为...我希望...以便...",
        "acceptanceCriteria": ["..."],
        "affectedModules": ["fd-server-ticket", "fd-web"],
        "complexity": "S|M|L|XL",
        "relatedInboxIds": [1, 2, 3]
      }],
      "mergedGroups": [...],
      "conflicts": [...]
    }
```

### 4.2 CTO Agent（Chief Technology Officer）

**职责**：技术可行性评估、架构决策、风险控制

```yaml
AgentDefinition:
  code: dev-cto
  capability: dev-architecture-review
  requiredCapability: claude-cli
  groupCode: development

  systemPrompt: |
    你是 FD-AutoPilot 的 AI CTO。

    你的职责：
    1. 评估需求的技术可行性
    2. 决定架构方案（是否需要新模块、新 Capability、新数据模型）
    3. 评估风险（是否涉及数据迁移、破坏性变更、安全风险）
    4. 制定技术约束和红线
    5. 输出技术方案文档，包含：
       - 实现路径（涉及哪些文件、哪些接口）
       - 依赖关系（模块间依赖、是否需要串行开发）
       - 风险评估（HIGH/MEDIUM/LOW + 缓解措施）
       - 是否需要人工介入的决策点

    关键约束：
    - 必须遵守模块依赖链：common ← auth ← task ← ai ← ticket ← app
    - 数据库变更必须兼容 Hibernate DDL update 模式
    - 评估变更是否影响现有 n8n 工作流
    - 安全敏感操作必须标记为"需人工审批"

    你可以访问的上下文：
    - 完整代码库结构
    - 当前 Agent/Capability/Task 体系
    - 数据库模型定义
    - n8n 工作流配置

  inputSchema: |
    { "requirements": [...], "codeStructure": {...} }

  outputSchema: |
    {
      "feasibilityReport": [{
        "requirementId": "...",
        "feasible": true/false,
        "approach": "...",
        "affectedFiles": ["..."],
        "risks": [{ "level": "HIGH|MEDIUM|LOW", "description": "...", "mitigation": "..." }],
        "requiresHumanApproval": true/false,
        "approvalReason": "..."
      }],
      "architectureDecisions": [...],
      "developmentOrder": ["先改 common", "再改 ai", "最后改 ticket"]
    }
```

### 4.3 研发总监 Agent（Engineering Director）

**职责**：任务分解、团队协调、质量管控

```yaml
AgentDefinition:
  code: dev-engineering-director
  capability: dev-task-orchestration
  requiredCapability: claude-cli
  groupCode: development

  systemPrompt: |
    你是 FD-AutoPilot 的 AI 研发总监。

    你的职责：
    1. 根据 CTO 的技术方案，分解为具体开发任务
    2. 将任务分配给对应的 Agent Teams 成员：
       - backend-dev: 后端 Java/Spring Boot 开发
       - frontend-dev: 前端 React/TypeScript 开发
       - rust-dev: Tauri/Rust 客户端开发
       - n8n-expert: n8n 工作流设计
       - test-writer: 自动化测试编写
       - reviewer: 代码审查
       - preview-tester: 前端可视化验收
    3. 管控开发顺序（按模块依赖链串行/并行）
    4. 收集各 Agent 的执行结果，判断是否通过
    5. 失败时决策：重试 / 调整方案 / 上报人工

    协调规则：
    - 跨模块变更按依赖链底层先行
    - 同层无依赖的任务可并行派发
    - 每个任务最多重试 2 次
    - 代码审查不通过需返回开发者修复
    - 所有任务完成后触发 Git 提交

  inputSchema: |
    { "technicalPlan": {...}, "teamCapabilities": [...] }

  outputSchema: |
    {
      "taskBreakdown": [{
        "taskId": "...",
        "assignee": "backend-dev",
        "module": "fd-server-ai",
        "description": "...",
        "dependencies": ["task-1"],
        "files": ["..."]
      }],
      "executionPlan": {
        "phases": [
          { "name": "Phase 1", "tasks": ["task-1", "task-2"], "parallel": true },
          { "name": "Phase 2", "tasks": ["task-3"], "parallel": false }
        ]
      }
    }
```

### 4.4 开发者 Agent Teams

复用 CLAUDE.md 中已定义的 Agent Teams，扩展为系统内置 Agent：

| Agent Code | 映射 Team 角色 | RequiredCapability | 职责 |
|-----------|---------------|-------------------|------|
| `dev-backend` | backend-dev | claude-code | 后端 Java 代码编写 |
| `dev-frontend` | frontend-dev | claude-code | 前端 React 代码编写 |
| `dev-rust` | rust-dev | claude-code | Rust 客户端代码编写 |
| `dev-n8n` | n8n-expert | claude-code | n8n 工作流 JSON 生成 |
| `dev-tester` | test-writer | claude-code | 自动化测试编写 |
| `dev-reviewer` | reviewer | claude-cli | 代码审查（只读分析） |
| `dev-preview` | preview-tester | claude-code | 前端 UI 验收 |

### 4.5 新增 Capability：`claude-code`

```yaml
CapabilityDefinition:
  code: claude-code
  name: Claude Code CLI
  providerType: CLAUDE_CODE
  executionEnv: CLIENT_ONLY
  detectConfig: '{"command": "claude --version"}'
  installGuide: '{"url": "https://docs.anthropic.com/claude-code", "steps": [...]}'
  description: |
    Claude Code — Anthropic 的 AI 编码工具。
    可以读取/修改代码文件、运行命令、执行 Git 操作。
    是自演进系统的核心执行能力。
```

与现有 `claude-cli` 的区别：`claude-cli` 用于通用对话和分析，`claude-code` 专门用于代码编写和项目操作，拥有文件系统访问权限。

## 5. 开发工作流设计

### 5.1 n8n 工作流：自演进开发流水线

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Development Pipeline (n8n)                           │
│                                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ 定时触发   │───→│ 扫描信箱新消息 │───→│ 有新需求？ │─N→│ 结束         │  │
│  │ (每日/手动) │    │ GET /inbox   │    │          │    │              │  │
│  └──────────┘    └──────────────┘    └────┬─────┘    └──────────────┘  │
│                                           │ Y                           │
│                                           ▼                             │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 1: 需求整理                                                   │ │
│  │ POST /capabilities/dev-requirement-analysis/execute                │ │
│  │ 需求经理 Agent 整理需求 → 输出结构化 PRD                              │ │
│  └──────────────────────────────┬─────────────────────────────────────┘ │
│                                  │                                      │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 2: CTO 评审                                                   │ │
│  │ POST /capabilities/dev-architecture-review/execute                 │ │
│  │ CTO Agent 评估可行性 → 输出技术方案                                   │ │
│  │                                                                    │ │
│  │ ┌──────────────────┐                                               │ │
│  │ │ 需人工审批？       │──Y──→ 通知管理员 → 等待审批 → 审批通过继续      │ │
│  │ │ (高风险/破坏性变更) │                         └──→ 审批拒绝终止      │ │
│  │ └───────┬──────────┘                                               │ │
│  │         │ N                                                        │ │
│  └─────────┼──────────────────────────────────────────────────────────┘ │
│            ▼                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 3: 任务分解与开发                                               │ │
│  │ POST /capabilities/dev-task-orchestration/execute                  │ │
│  │ 研发总监 Agent 分解任务 → 派发给 Agent Teams                          │ │
│  │                                                                    │ │
│  │ ┌───────────────────────────────────────────────────┐              │ │
│  │ │ 循环执行开发任务（按依赖顺序）                        │              │ │
│  │ │                                                   │              │ │
│  │ │ Phase 3a: 并行开发                                 │              │ │
│  │ │   backend-dev ──→ 后端代码                         │              │ │
│  │ │   frontend-dev ──→ 前端代码         （可并行）      │              │ │
│  │ │   rust-dev ──→ 客户端代码                          │              │ │
│  │ │                                                   │              │ │
│  │ │ Phase 3b: 代码审查                                 │              │ │
│  │ │   reviewer ──→ 审查结果                            │              │ │
│  │ │   ├─ PASS → 继续                                  │              │ │
│  │ │   └─ REJECT → 返回 3a 修复（最多 2 轮）            │              │ │
│  │ │                                                   │              │ │
│  │ │ Phase 3c: 测试                                    │              │ │
│  │ │   test-writer ──→ 编写测试用例                     │              │ │
│  │ │   运行测试 ──→ mvn test + npm test                 │              │ │
│  │ │   ├─ PASS → 继续                                  │              │ │
│  │ │   └─ FAIL → 返回 3a 修复（最多 2 轮）              │              │ │
│  │ └───────────────────────────────────────────────────┘              │ │
│  └──────────────────────────────┬─────────────────────────────────────┘ │
│                                  │                                      │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 4: 提交与构建                                                  │ │
│  │ Git commit + push → 触发 Jenkins Pipeline                          │ │
│  │ Jenkins: Checkout → Build → Deploy(staging)                        │ │
│  │ ├─ 构建成功 → 部署测试版                                             │ │
│  │ └─ 构建失败 → 通知研发总监 → 返回 Phase 3 修复                        │ │
│  └──────────────────────────────┬─────────────────────────────────────┘ │
│                                  │                                      │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 5: 用户验收                                                    │ │
│  │ 通知提交需求的用户：测试版已就绪，请验收                                 │ │
│  │ 用户在测试环境操作 → 反馈结果                                         │ │
│  │ ├─ 验收通过 → Phase 6                                               │ │
│  │ ├─ 验收不通过 → 用户补充说明 → 返回 Phase 3                           │ │
│  │ └─ 超时未响应 → 通知管理员                                            │ │
│  └──────────────────────────────┬─────────────────────────────────────┘ │
│                                  │                                      │
│                                  ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 6: 生产发布                                                    │ │
│  │ 管理员确认升级 → Jenkins 生产部署                                      │ │
│  │ 健康检查通过 → 更新版本号 → 关闭相关信箱消息                            │ │
│  │ 健康检查失败 → 自动回滚 → 通知管理员                                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 信箱消息状态流转

```
SUBMITTED → TRIAGED → PLANNED → IN_PROGRESS → TESTING → RELEASED → CLOSED
                │                                  │
                └──→ REJECTED (不可行)               └──→ REOPENED → TRIAGED
```

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| SUBMITTED | 用户已提交 | 用户提交信箱消息 |
| TRIAGED | 已分类整理 | 需求经理 Agent 完成整理 |
| PLANNED | 已纳入计划 | CTO Agent 评审通过 |
| REJECTED | 不可行/不采纳 | CTO Agent 评审不通过 |
| IN_PROGRESS | 开发中 | 研发总监 Agent 开始分配任务 |
| TESTING | 测试中 | 测试版部署完成，等待用户验收 |
| RELEASED | 已发布 | 生产版本发布成功 |
| REOPENED | 重新打开 | 用户验收不通过 |
| CLOSED | 已关闭 | 用户确认满意 |

### 5.3 安全边界与人工控制点

自演进系统必须有清晰的安全边界，避免 AI 做出不可逆的危险操作：

| 操作 | 权限级别 | 说明 |
|------|---------|------|
| 提交信箱消息 | 所有登录用户 | 任何人可以提意见 |
| 查看开发进度 | 所有登录用户 | 透明的进度看板 |
| 触发需求整理 | 自动/管理员 | n8n 定时或管理员手动触发 |
| CTO 评审 | 自动 | AI 自动评估，高风险标记人工审批 |
| 高风险变更审批 | **管理员** | 涉及数据模型变更、权限体系、n8n 工作流的改动需人工确认 |
| 代码提交 | 自动 | 提交到开发分支（非 main） |
| 测试版部署 | 自动 | Jenkins 部署到 staging 环境 |
| 生产部署 | **管理员** | 必须管理员确认才能升级生产 |
| 版本回滚 | **管理员** | 回滚操作需人工确认 |

### 5.4 开发分支策略

```
main (生产)
  └── dev (开发基线)
       └── ai/feature-{inbox-id}-{timestamp} (AI 开发分支)
            ├── AI Agent 在此分支开发
            ├── Jenkins 从此分支构建测试版
            └── 验收通过后合并到 dev → main
```

## 6. Jenkins API 集成升级

### 6.1 从 iframe 嵌入到 API 驱动

当前 Jenkins 集成是纯 iframe 嵌入（`JenkinsTab.tsx`），自演进需要升级为 API 驱动：

```
新增后端服务：JenkinsIntegrationService

功能：
├── triggerBuild(branch, parameters)      -- 触发构建
├── getBuildStatus(jobName, buildNumber)   -- 查询构建状态
├── getBuildLog(jobName, buildNumber)      -- 获取构建日志
├── deployToStaging(buildArtifact)         -- 部署到测试环境
├── deployToProduction(buildArtifact)      -- 部署到生产环境（需管理员确认）
├── rollback(previousBuildNumber)          -- 回滚到指定版本
└── getHealthStatus()                     -- 健康检查
```

### 6.2 Jenkins Pipeline 扩展

```groovy
// Jenkinsfile 扩展 — 支持多环境部署
pipeline {
    parameters {
        choice(name: 'DEPLOY_ENV', choices: ['staging', 'production'])
        string(name: 'BRANCH', defaultValue: 'dev')
        string(name: 'INBOX_ID', description: '关联的信箱消息ID')
    }

    stages {
        stage('Build') { ... }
        stage('Test') {
            steps {
                sh 'cd fd-server && mvn test'
                sh 'cd fd-web && npm test'
            }
        }
        stage('Deploy Staging') {
            when { expression { params.DEPLOY_ENV == 'staging' } }
            steps { /* 部署到测试环境 */ }
        }
        stage('Deploy Production') {
            when { expression { params.DEPLOY_ENV == 'production' } }
            steps { /* 部署到生产环境 */ }
        }
        stage('Health Check') {
            steps { /* 健康检查 + 回调通知 */ }
        }
    }

    post {
        success {
            // 回调 FD-AutoPilot API，更新信箱状态
            httpRequest url: "${FD_API}/api/v1/dev/build-callback",
                        httpMode: 'POST',
                        requestBody: '{"inboxId": "${INBOX_ID}", "status": "SUCCESS"}'
        }
        failure {
            httpRequest url: "${FD_API}/api/v1/dev/build-callback",
                        httpMode: 'POST',
                        requestBody: '{"inboxId": "${INBOX_ID}", "status": "FAILURE"}'
        }
    }
}
```

## 7. 新增模块规划

### 7.1 后端新增模块 `fd-server-dev`

在模块依赖链中的位置：`common ← auth ← task ← ai ← ticket ← **dev** ← app`

`dev` 模块依赖 `ai`（使用 Agent 体系）和 `ticket`（复用通知等基础设施），但不被其他模块依赖。

```
fd-server-dev/
├── entity/
│   ├── InboxMessage.java          -- 信箱消息
│   ├── InboxComment.java          -- 信箱评论
│   ├── DevTask.java               -- 开发任务
│   ├── DevVersion.java            -- 版本记录
│   └── DevBuildRecord.java        -- 构建记录
├── enums/
│   ├── InboxStatus.java           -- 信箱状态枚举
│   ├── InboxType.java             -- 消息类型枚举
│   ├── DevTaskStatus.java         -- 开发任务状态
│   └── DeployEnvironment.java     -- 部署环境
├── service/
│   ├── InboxService.java          -- 信箱 CRUD + 状态管理
│   ├── DevTaskService.java        -- 开发任务管理
│   ├── DevWorkflowService.java    -- 开发工作流编排（衔接 n8n）
│   ├── JenkinsIntegrationService.java -- Jenkins API 集成
│   ├── GitOperationService.java   -- Git 分支管理
│   └── VersionService.java        -- 版本管理
├── controller/
│   ├── InboxController.java       -- 信箱 REST API
│   ├── DevDashboardController.java -- 开发看板 API
│   ├── DevN8nController.java      -- n8n 开发工作流端点
│   └── UpgradeController.java     -- 升级管理 API
└── dto/
    ├── InboxRequest.java
    ├── DevTaskRequest.java
    └── BuildCallbackRequest.java
```

### 7.2 前端新增模块

```
fd-web/src/modules/development/
├── pages/
│   ├── InboxTab.tsx              -- 信箱页面（提交/查看改进意见）
│   ├── DevBoardTab.tsx           -- 开发看板（需求/任务/进度追踪）
│   ├── VersionHistoryTab.tsx     -- 版本历史
│   └── UpgradeConsoleTab.tsx     -- 升级控制台（测试版预览/确认升级）
├── components/
│   ├── InboxForm.tsx             -- 信箱提交表单
│   ├── InboxList.tsx             -- 信箱消息列表
│   ├── InboxDetail.tsx           -- 消息详情 + AI 整理结果
│   ├── DevTaskTimeline.tsx       -- 开发任务时间线
│   ├── BuildStatusCard.tsx       -- 构建状态卡片
│   ├── VersionCompare.tsx        -- 版本对比
│   └── UpgradeConfirmDialog.tsx  -- 升级确认对话框
└── hooks/
    ├── useInbox.ts               -- 信箱操作 Hook
    ├── useDevProgress.ts         -- 开发进度 Hook
    └── useUpgrade.ts             -- 升级操作 Hook
```

### 7.3 RBAC 权限扩展

新增权限模块 `development`：

| 权限 Code | 类型 | 说明 |
|-----------|------|------|
| `inbox:read` | ROUTE | 查看信箱 |
| `inbox:submit` | OPERATION | 提交改进意见 |
| `dev:read` | ROUTE | 查看开发看板 |
| `dev:manage` | OPERATION | 管理开发任务 |
| `dev:trigger` | OPERATION | 手动触发开发流水线 |
| `upgrade:read` | ROUTE | 查看版本/升级状态 |
| `upgrade:confirm` | OPERATION | 确认生产升级（仅管理员） |
| `upgrade:rollback` | OPERATION | 执行版本回滚（仅管理员） |

### 7.4 导航配置扩展

在 `navigationConfig.ts` 中新增 `development` 导航组：

```typescript
{
  id: 'development',
  label: 'nav.development',
  icon: Rocket,
  tabs: [
    { id: 'inbox', label: 'nav.inbox', permission: 'inbox:read' },
    { id: 'dev-board', label: 'nav.devBoard', permission: 'dev:read' },
    { id: 'versions', label: 'nav.versions', permission: 'upgrade:read' },
    { id: 'upgrade', label: 'nav.upgrade', permission: 'upgrade:confirm' },
  ]
}
```

## 8. 上下文注入——让 AI 理解自己

自演进的关键是让 AI Agent 深度理解系统自身的代码结构。

### 8.1 代码上下文服务

```java
/**
 * 为 AI Agent 提供代码上下文，使其能够理解和修改自身代码。
 */
@Service
public class CodeContextService {

    /**
     * 生成项目结构摘要，作为 Agent 的 system prompt 上下文。
     * 包括：模块依赖关系、核心接口列表、数据模型概览。
     */
    public String generateProjectContext() { ... }

    /**
     * 根据受影响模块，提取相关代码片段。
     * 用于让 AI Agent 理解需要修改的代码上下文。
     */
    public String extractModuleContext(List<String> modules) { ... }

    /**
     * 提取 API 接口清单，供 AI Agent 理解系统能力。
     */
    public String extractApiCatalog() { ... }
}
```

### 8.2 知识库集成

复用现有的 `KnowledgeNote` 体系，存储：
- 架构设计文档（`CLAUDE.md`, `v0.4-vision.md` 的内容）
- 编码规范和红线规则
- 历史开发案例（成功/失败的案例作为 few-shot 示例）
- Agent Teams 的分工指南

## 9. 渐进式实施路线

> 完整路线见第 16 节（含 Agent 互联和多项目支持的更新版本）

| 阶段 | 版本 | 核心目标 |
|------|------|---------|
| Phase 1 | v0.5 | 信箱系统 + 办公室工作台 UI + 需求经理 Agent |
| Phase 2 | v0.6 | CTO Agent + 代码上下文服务 + 技术可行性评估 |
| Phase 3 | v0.7 | 研发总监 + Agent Teams 自动编码 + `claude-code` Capability |
| Phase 4 | v0.8 | Jenkins API 集成 + 用户验收 + 自动升级生产 |
| Phase 5 | v0.9 | Agent 互联 + 远程注册 + AI 打工经济 |
| Phase 6 | v1.0 | 联邦互联 + Git-as-a-Task + 多项目管理 |

## 10. 赛博云办公室——Agent 互联

### 10.1 核心理念

赛博云办公室的本质是：**把分散在各处的 AI 执行能力，统一注册到一个中枢，由工作流按需调度**。

```
                        赛博云办公室
                            │
     ┌──────────┬───────────┼───────────┬──────────┐
     │          │           │           │          │
 ┌───▼───┐ ┌───▼───┐ ┌─────▼─────┐ ┌───▼───┐ ┌───▼───┐
 │桌面 Agent│ │Web Agent│ │远程服务 Agent│ │联邦节点 │ │第三方 AI│
 │Tauri    │ │Browser │ │ 你的服务器  │ │另一个   │ │OpenAI  │
 │本地执行  │ │本地执行 │ │ HTTP 回调   │ │FD实例  │ │Claude  │
 │gemini   │ │claude  │ │ 自定义能力  │ │能力共享 │ │API适配 │
 └───┬───┘ └───┬───┘ └─────┬─────┘ └───┬───┘ └───┬───┘
     │         │           │           │          │
     └─────────┴───────────┼───────────┴──────────┘
                           │
                  统一注册 + 能力声明
                  心跳/健康 + 认证授权
                           │
                    ┌──────▼──────┐
                    │ Capability  │
                    │   Pool      │  ← n8n 工作流按需调用
                    └─────────────┘
```

当前系统中 Agent 注册仅限于 Tauri 桌面客户端和 Web 浏览器（通过 `clientRegistration.ts`），执行模式是 SSE Pull（客户端主动拉取任务）。赛博云办公室要打破这个边界：

- **任意端可注册**：不仅是你面前的电脑，你的云服务器、你同事的电脑、甚至另一个城市的 FD-AutoPilot 实例上的 Agent，都可以注册到同一个能力池
- **工作流不关心 Agent 在哪里**：n8n 调用 `POST /capabilities/ticket-translate/execute` 时，系统自动路由到最合适的可用 Agent，无论它运行在本地还是地球另一端
- **能力共享和竞争**：多个 Agent 可以提供同一种 Capability，系统按负载、优先级、网络距离自动选择

### 10.2 Agent 类型分类

| Agent 类型 | 注册方式 | 任务获取 | 典型场景 |
|-----------|---------|---------|---------|
| **本地 Agent** | 客户端启动时自动注册 | SSE Pull（现有） | Tauri 桌面运行 Gemini CLI |
| **Web Agent** | 浏览器页面加载时注册 | REST Poll（现有） | Web 模式的 HTTP Bridge |
| **远程 Agent** | HTTP API 主动注册 | Webhook Push（新增） | 云服务器上的 AI 服务 |
| **联邦 Agent** | 实例间握手协议 | Federation Dispatch（新增） | 另一个 FD-AutoPilot 实例 |
| **第三方 Agent** | 适配器注册 | HTTP 直连（已有 AgentProvider） | OpenAI API / Claude API |

### 10.3 统一注册协议

扩展现有 `ClientRegistration` 协议，新增远程 Agent 所需字段：

```
注册请求（扩展 ClientRegisterRequest）：

{
  "clientId": "remote-server-bj-01",        // 唯一标识
  "clientType": "REMOTE",                   // 新增类型：REMOTE / FEDERATED
  "userId": "service-account-01",           // 服务账号（非个人用户）
  "version": "1.0.0",
  "enabledCapabilities": [                  // 声明自己能做什么
    "ticket-translate",
    "code-review",
    "custom-data-analysis"
  ],
  "runningAgents": ["ticket-translate"],     // 当前运行中的 Agent

  // ──── 远程 Agent 扩展字段 ────
  "callbackUrl": "https://my-server.com/agent/callback",  // 任务推送地址
  "publicEndpoint": "https://my-server.com/agent/health",  // 健康检查地址
  "networkZone": "cn-east",                 // 网络区域（就近路由）
  "metadata": {                             // 扩展元数据
    "provider": "custom",
    "maxConcurrency": 5,
    "supportedFormats": ["json", "markdown"]
  }
}
```

### 10.4 任务下发双通道

```
                    任务创建（TaskInstance）
                           │
                    ┌──────┴──────┐
                    │ 路由决策     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │                         │
       本地/Web Agent              远程/联邦 Agent
              │                         │
       SSE Pull 模式              Webhook Push 模式
       （现有机制）                （新增机制）
              │                         │
       客户端 claim 任务          服务端 POST 到 callbackUrl
       客户端执行                  远程端执行
       POST /tasks/{id}/complete  POST /api/v1/agent/task-result
              │                         │
              └────────────┬────────────┘
                           │
                  CompletableFuture.complete
                           │
                    返回 n8n / 调用方
```

**Webhook Push 协议**：

```
服务端 → 远程 Agent（推送任务）：
POST {callbackUrl}
{
  "taskId": 12345,
  "agentCode": "ticket-translate",
  "capability": "ticket-translate",
  "payload": { ... },             // 任务参数
  "timeoutMs": 300000,
  "callbackEndpoint": "/api/v1/agent/task-result"  // 结果回调地址
}

远程 Agent → 服务端（返回结果）：
POST /api/v1/agent/task-result
{
  "taskId": 12345,
  "clientId": "remote-server-bj-01",
  "success": true,
  "result": { ... },
  "tokenCount": 1500,            // Token 消耗统计
  "durationMs": 8500
}
```

### 10.5 联邦协议——跨实例互联

多个 FD-AutoPilot 实例可以组成联邦网络，共享 Agent 能力：

```
┌──────────────────┐          ┌──────────────────┐
│ FD-AutoPilot (A) │◄────────►│ FD-AutoPilot (B) │
│ 北京办公室        │ 联邦协议  │ 上海办公室        │
│                  │          │                  │
│ Agent:           │          │ Agent:           │
│ - gemini-cli ×2  │          │ - claude-cli ×3  │
│ - notebooklm ×1  │          │ - code-review ×1 │
│                  │          │ - data-analysis  │
└──────────────────┘          └──────────────────┘
         │                              │
         └──────────┬───────────────────┘
                    │
          联邦能力池（虚拟合并）：
          gemini-cli: 2 实例（A）
          claude-cli: 3 实例（B）
          notebooklm: 1 实例（A）
          code-review: 1 实例（B）
          data-analysis: 1 实例（B）
```

**联邦协议端点**：

```
POST /api/v1/federation/handshake     -- 实例间握手（交换身份 + 公钥）
POST /api/v1/federation/capabilities  -- 能力同步（定期交换可用 Capability 列表）
POST /api/v1/federation/dispatch      -- 跨实例任务转发（A 的工作流调用 B 的 Agent）
GET  /api/v1/federation/peers         -- 对等节点列表
POST /api/v1/federation/heartbeat     -- 联邦心跳（实例级健康检查）
```

**联邦路由策略**：
1. 优先本地——先在本实例查找可用 Agent
2. 就近联邦——按 `networkZone` 选择最近的联邦节点
3. 负载均衡——跨联邦节点的 Round-Robin
4. 降级隔离——联邦节点不可达时，断路器自动隔离

### 10.6 安全体系

#### 服务账号机制

远程 Agent 不使用个人用户 JWT，而是通过服务账号认证：

```
ServiceAccount（服务账号）
├── id: String (UUID)
├── name: String              -- "北京数据中心-翻译服务"
├── apiKey: String            -- HMAC 签名密钥（不可逆存储）
├── allowedCapabilities: []   -- 该账号可以认领的 Capability 白名单
├── allowedIpRange: String    -- IP 白名单（可选）
├── rateLimit: int            -- 每分钟最大请求数
├── enabled: boolean
├── createdBy: String         -- 创建者（管理员）
└── expiresAt: LocalDateTime  -- 过期时间（可选）
```

#### 认证分层

| Agent 类型 | 认证方式 | 安全级别 |
|-----------|---------|---------|
| 本地 Agent | 用户 JWT（现有） | 依赖登录用户 |
| Web Agent | 用户 JWT（现有） | 依赖登录用户 |
| 远程 Agent | API Key + HMAC 签名 | 服务账号 + IP 白名单 |
| 联邦 Agent | mTLS + Federation Token | 实例级互信 |
| 第三方 Agent | API Key（提供方） | 通过 AgentProvider 适配 |

#### 数据隔离

- 远程 Agent 只能看到和操作与自己 `clientId` 关联的任务
- 联邦转发的任务只包含必要的业务参数，不暴露内部元数据
- 所有远程通信强制 HTTPS
- 敏感业务数据（如工单客户信息）在跨联邦传输时可配置脱敏规则

### 10.7 现有架构就绪度

| 组件 | 远程扩展就绪度 | 说明 |
|------|-------------|------|
| `CapabilityRouterService` | **90%** | Round-Robin + 在线检测天然支持远程节点混合路由 |
| `AgentDefinition.callMode/callUrl` | **85%** | `CallMode.HTTP` + `callUrl` 字段已存在，被标记废弃但可恢复 |
| `AgentProvider SPI` | **95%** | 插件化架构，新增 `RemoteAgentProvider` 实现接口即可 |
| `CircuitBreaker` | **100%** | Capability 级熔断对远程/本地完全透明 |
| `ClientRegistration` | **70%** | `clientType` 已预留 BRIDGE，需扩展 callbackUrl 等字段 |
| `SyncAgentExecutionService` | **80%** | Future+Task 模型通用，需新增 HTTP Push 分支 |
| 认证与权限 | **40%** | 需要新增服务账号、HMAC 签名、细粒度权限 |

### 10.8 办公室工作台——可视化愿景

赛博云办公室不只是一个概念——它应该有一个直观的可视化界面。系统主页工作台设计为"办公室"模样：

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏢 赛博云办公室                                      2026-03-04    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ 工单处理组 ──────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │ 🟢 翻译专员   │  │ 🟢 回复专员   │  │ ⚪ 物流专员   │          │  │
│  │  │ ticket-trans │  │ ticket-reply│  │ logistics   │          │  │
│  │  │              │  │              │  │              │          │  │
│  │  │ 正在翻译      │  │ 正在生成回复  │  │ 休息中       │          │  │
│  │  │ 工单 #4521   │  │ 工单 #4519   │  │              │          │  │
│  │  │              │  │              │  │              │          │  │
│  │  │ 今日: 23 单   │  │ 今日: 18 单  │  │ 今日: 0 单   │          │  │
│  │  │ Token: 45.2K │  │ Token: 62.8K │  │ Token: 0    │          │  │
│  │  │ 成功率: 96%  │  │ 成功率: 91%  │  │              │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ 研发团队 ────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │ 🟡 需求经理   │  │ ⚪ CTO       │  │ ⚪ 研发总监   │          │  │
│  │  │ product-mgr  │  │ dev-cto     │  │ eng-director│          │  │
│  │  │              │  │              │  │              │          │  │
│  │  │ 整理需求中    │  │ 等待任务     │  │ 等待任务      │          │  │
│  │  │ 信箱 #12-15  │  │              │  │              │          │  │
│  │  │              │  │              │  │              │          │  │
│  │  │ 今日: 3 批   │  │ 今日: 0 批   │  │ 今日: 0 批   │          │  │
│  │  │ Token: 12.1K │  │ Token: 0    │  │ Token: 0    │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ 远程协作区 ──────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐                            │  │
│  │  │ 🟢 上海翻译    │  │ 🔴 北京数据   │                            │  │
│  │  │ remote-sh-01│  │ remote-bj-01│     远程节点                │  │
│  │  │              │  │              │                            │  │
│  │  │ 翻译 #4522   │  │ 连接断开     │                            │  │
│  │  │ Token: 8.5K  │  │ 最后心跳:    │                            │  │
│  │  │ 延迟: 45ms   │  │ 10分钟前     │                            │  │
│  │  └─────────────┘  └─────────────┘                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ 今日总览 ────────────────────────────────────────────────────┐  │
│  │  在线 Agent: 5/8  │  总处理: 44 任务  │  Token: 128.6K        │  │
│  │  成功率: 93.2%    │  平均耗时: 32s    │  活跃工作流: 2          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**工位状态指示**：
| 状态 | 图标 | 含义 |
|------|------|------|
| 🟢 工作中 | 绿色 | Agent 正在执行任务 |
| 🟡 准备中 | 黄色 | Agent 在线，正在准备/加载 |
| ⚪ 空闲 | 灰色 | Agent 在线，等待任务 |
| 🔴 离线 | 红色 | Agent 断开连接或健康检查失败 |

**每个工位显示的信息**：
- Agent 名称和代号
- 当前状态（正在做什么 / 休息中）
- 当前处理的任务详情（工单号、信箱消息等）
- 今日统计：处理任务数、Token 吞吐量、成功率
- 远程 Agent 额外显示：网络延迟、最后心跳时间

**分组逻辑**：
- 按业务模块分组（工单处理组、研发团队、知识库组...）
- 远程 Agent 单独一个"远程协作区"
- 支持拖拽调整工位布局（可选）

**交互能力**：
- 点击工位查看 Agent 详情（执行历史、配置参数、性能趋势图）
- 右键菜单：暂停/恢复 Agent、查看日志、手动分配任务
- 实时更新：SSE 驱动，状态变化即时反映在 UI 上
- 全屏日志视图：点击任务详情可展开执行日志

## 11. 与现有工单处理的统一

自演进功能与工单处理共享同一套基础设施，体现了平台化的设计理念：

```
                    FD-AutoPilot 赛博云办公室
                           │
              ┌────────────┼────────────┬────────────┐
              │            │            │            │
         工单处理模块    开发自演进模块   远程Agent模块   未来业务模块
              │            │            │            │
              └────────────┼────────────┴────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
          Agent 互联    Capability    n8n 编排
          Sync Bridge   Task 路由    SSE + Webhook
          RBAC 权限     Jenkins CI   服务账号
          联邦协议      断路器        客户端注册
```

工单、开发、远程协作共用的模式：
- **状态机驱动**：工单有 TicketStateMachine，信箱有 InboxStateMachine
- **n8n 编排**：所有业务流程都由 n8n 工作流驱动
- **Agent + Capability**：翻译用 `gemini-cli`，开发用 `claude-code`，都通过 Capability 路由，不关心 Agent 在哪里
- **Sync Bridge**：n8n 调用 Agent 执行，等待结果返回——本地 SSE Pull 或远程 Webhook Push
- **审核/验收**：工单有审核环节，开发有用户验收环节
- **通知**：复用钉钉/企微通知策略

## 12. AI 打工经济——个人算力共享

### 12.1 核心概念

赛博云办公室不仅是企业内部的 Agent 编排，更是一个**开放的 AI 劳动力市场**。任何人都可以把自己电脑上的 AI 能力注册到平台上"打工"：

```
你的 MacBook                        赛博云办公室（平台）
┌──────────────┐                   ┌──────────────────────┐
│ 已安装:       │    注册能力        │                      │
│ - Claude Code │ ──────────────→  │  能力池:              │
│ - Gemini CLI  │                  │  claude-code: 3 节点  │
│ - Python 3.12 │    接收任务       │  gemini-cli: 5 节点   │
│               │ ←────────────── │  notebooklm: 2 节点   │
│ 空闲 GPU/CPU  │    执行 + 回报    │                      │
│               │ ──────────────→  │  工作流按需调度 ↕      │
└──────────────┘                   └──────────────────────┘
```

**场景示例**：
- 张三的 Mac 装了 Claude Code，注册到平台，平台有翻译任务时自动分配到他的电脑执行
- 李四的工作站有强力 GPU，注册 `notebooklm-py` 能力，平台的知识库生成任务会路由到他的机器
- 王五的云服务器 24 小时在线，注册为 `always-on` 节点，优先承接夜间定时任务
- 一台闲置的开发服务器注册 `claude-code` 能力，自动参与代码审查和测试编写

### 12.2 打工者注册流程

```
1. 安装 FD-AutoPilot 客户端（Tauri 桌面版或轻量 CLI Agent）
2. 登录个人账号
3. 客户端自动检测本机可用的 AI 能力
4. 用户选择愿意贡献的能力（开关控制）
5. 客户端自动注册到平台，开始接收任务
6. 任务执行在本地完成，结果上传到平台
```

### 12.3 贡献度追踪

```
AgentContribution（贡献度记录）
├── clientId: String          -- 贡献者客户端
├── userId: String            -- 贡献者用户
├── capability: String        -- 贡献的能力
├── taskCount: int            -- 完成任务数
├── tokenCount: long          -- Token 吞吐量
├── totalDurationMs: long     -- 总执行时长
├── successRate: double       -- 成功率
├── period: String            -- 统计周期（daily/weekly/monthly）
└── rewardPoints: int         -- 积分奖励（可选的激励机制）
```

这个模型让系统成为一个去中心化的 AI 算力共享网络——每个人的电脑都是一个潜在的 Agent 节点，空闲时为平台贡献算力，完成任务获得贡献度。

## 13. Git-as-a-Task——任意项目的 AI 迭代

### 13.1 核心洞察

帮某个 Git 仓库迭代项目，不过是 Agent 任务中的一种。自演进不仅限于 FD-AutoPilot 自身——**任何 Git 仓库都可以成为工作流的处理对象**。

```
传统视角：
  工单 → Agent 处理 → 结果

扩展视角：
  工单 → Agent 处理 → 结果
  信箱 → Agent 开发 → 代码提交（自演进）
  Git 仓库 → Agent 开发 → 代码提交（外部项目迭代）   ← 这也是一种任务
  文档 → Agent 翻译 → 翻译结果
  数据 → Agent 分析 → 分析报告
```

### 13.2 项目管理模型

```
ManagedProject（托管项目）
├── id: Long
├── name: String                    -- "公司官网"
├── gitUrl: String                  -- "git@github.com:company/website.git"
├── defaultBranch: String           -- "main"
├── devBranch: String               -- "dev"
├── projectType: enum               -- SELF（自身） / EXTERNAL（外部）
├── contextFiles: []                -- 项目上下文文件（类似 CLAUDE.md）
├── buildCommand: String            -- "npm run build"
├── testCommand: String             -- "npm test"
├── deployConfig: TEXT              -- 部署配置（Jenkins/其他 CI）
├── inboxEnabled: boolean           -- 是否启用信箱收集需求
└── workflowId: String              -- 关联的 n8n 开发工作流
```

### 13.3 多项目工作流

```
赛博云办公室
    │
    ├── 项目 A: FD-AutoPilot（自身）
    │   ├── 信箱 → 需求经理 → CTO → 研发团队 → Jenkins → 发布
    │   └── n8n 工作流: dev-pipeline-self
    │
    ├── 项目 B: 公司官网
    │   ├── 信箱 → 需求经理 → CTO → 研发团队 → GitHub Actions → 发布
    │   └── n8n 工作流: dev-pipeline-website
    │
    ├── 项目 C: 内部工具
    │   ├── 信箱 → 需求经理 → 研发团队 → GitLab CI → 发布
    │   └── n8n 工作流: dev-pipeline-tools
    │
    └── 项目 D: 开源贡献
        ├── Issue 同步 → 需求经理 → 研发团队 → PR 提交
        └── n8n 工作流: dev-pipeline-opensource
```

### 13.4 Capability 扩展：`git-project-dev`

```yaml
CapabilityDefinition:
  code: git-project-dev
  name: Git 项目开发
  description: |
    克隆任意 Git 仓库，理解项目结构，执行开发任务。
    Agent 在隔离的工作目录中操作，完成后提交到指定分支。
  detectConfig: '{"command": "git --version && claude --version"}'

AgentDefinition:
  code: project-developer
  capability: git-project-dev
  requiredCapability: claude-code
  systemPrompt: |
    你是一个通用项目开发者 Agent。
    你会收到一个 Git 仓库地址和开发任务描述。
    流程：
    1. 克隆仓库到隔离工作目录
    2. 阅读项目文档（README, CLAUDE.md 等）理解项目结构
    3. 执行开发任务
    4. 运行测试确保不破坏现有功能
    5. 提交代码到指定分支
    6. 返回变更摘要
```

这意味着 FD-AutoPilot 可以管理多个项目的 AI 驱动开发——它不仅是一个工单系统或自演进平台，更是一个**AI 驱动的项目管理和开发中枢**。

## 14. 风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| AI 生成的代码引入 Bug | HIGH | 多层审查（reviewer Agent + 自动化测试 + 用户验收） |
| AI 修改了不该改的文件 | HIGH | Git 分支隔离 + 文件修改范围约束（Agent prompt 限定模块边界） |
| 构建产物部署后系统崩溃 | HIGH | 健康检查 + 自动回滚 + 生产部署需管理员确认 |
| AI 需求理解偏差 | MEDIUM | 需求整理后通知用户确认，验收不通过可重新开发 |
| 无限循环（AI 修复 Bug 引入新 Bug） | MEDIUM | 最大重试次数限制（2 轮） + 超限上报人工 |
| 安全漏洞 | HIGH | 代码审查 Agent 重点检查 OWASP Top 10 + 禁止 AI 修改安全相关配置 |
| 资源消耗过大 | MEDIUM | 并发任务数限制 + CompletableFuture 池容量控制 |
| 远程 Agent 数据泄露 | HIGH | 传输加密 + 服务账号权限白名单 + 敏感数据脱敏 |
| 远程 Agent 恶意注册 | HIGH | 服务账号审批制 + IP 白名单 + 速率限制 |
| 联邦节点被攻陷 | HIGH | mTLS 双向认证 + 联邦断路器 + 任务结果签名验证 |
| 外部项目代码安全 | HIGH | 隔离工作目录 + 禁止访问平台内部代码 + 代码审查 |

## 15. 度量与可观测性

> 注：原章节编号因新增 Agent 互联、AI 打工经济、Git-as-a-Task 三节而顺延

### 15.1 自演进效率指标

| 指标 | 说明 | 目标 |
|------|------|------|
| 需求响应时间 | 从用户提交到需求整理完成 | < 1 小时 |
| 开发周期 | 从需求确认到测试版就绪 | 简单需求 < 1 天 |
| 一次通过率 | 代码审查 + 测试一次通过的比例 | > 70% |
| 构建成功率 | Jenkins 构建成功的比例 | > 90% |
| 用户满意度 | 用户对发布结果的评分 | > 4/5 |
| 回滚率 | 生产发布后需要回滚的比例 | < 5% |

### 15.2 Agent 互联指标

| 指标 | 说明 | 目标 |
|------|------|------|
| 在线 Agent 数 | 各类型 Agent 的在线数量 | 持续监控 |
| 远程 Agent 可用率 | 远程节点的在线时间占比 | > 95% |
| 跨端路由延迟 | 任务从创建到被 claim 的时间 | 本地 < 1s，远程 < 5s |
| 联邦节点健康度 | 联邦心跳成功率 | > 99% |
| Token 吞吐总量 | 所有 Agent 的日 Token 消耗总量 | 监控趋势 |
| 贡献度分布 | 各节点的任务完成占比 | 均衡分布 |

### 15.3 数据看板

主页办公室工作台（替代传统 Dashboard）实时展示：
- Agent 工位视图（在线/忙碌/空闲/离线状态）
- 每个 Agent 的实时任务和今日统计
- Token 吞吐量趋势图（按 Agent / 按 Capability）
- 信箱消息趋势图（按类型/优先级）
- 开发任务完成率和版本发布时间线
- 远程协作区状态（远程节点延迟和健康度）
- 贡献度排行榜（各节点/用户的贡献度排名）

## 16. 渐进式实施路线（更新）

```
v0.4  当前版本 — 6 模块 + Agent + Sync Bridge + n8n + Capability 体系
 ↓
v0.5  信箱基础 + 办公室 UI — 信箱系统 + 办公室工作台 + 需求经理 Agent
 ↓
v0.6  AI 评审 — CTO Agent + 代码上下文服务 + 技术可行性评估
 ↓
v0.7  AI 开发 — 研发总监 Agent + Agent Teams 自动编码 + claude-code Capability
 ↓
v0.8  自动发布 — Jenkins API 集成 + 用户验收 + 自动升级生产
 ↓
v0.9  Agent 互联 — 远程 Agent 注册 + Webhook Push + 服务账号 + AI 打工经济
 ↓
v1.0  联邦互联 + 多项目 — 跨实例 Agent 共享 + Git-as-a-Task + 生产级可靠性
```

## 17. 总结

FD-AutoPilot 的愿景是成为一个**赛博云办公室**——一个 AI Agent 互联、自我演进、开放协作的工作流平台。它有四个支柱：

1. **Agent 互联**：任意端的 Agent（本地/远程/联邦/第三方）通过统一协议注册到能力池，被 n8n 工作流按需调度。工作流不关心 Agent 在哪里运行，只关心它能做什么。

2. **自我演进**：系统通过信箱收集用户反馈，AI Agent 团队（需求经理 → CTO → 研发总监 → Agent Teams）自动完成开发闭环。系统用 AI 迭代自己。

3. **AI 打工经济**：任何人都可以把自己电脑上的 AI 能力注册到平台"打工"。个人算力成为可共享的资源，空闲的 Claude Code、Gemini CLI 都是潜在的劳动力。

4. **Git-as-a-Task**：帮任意 Git 仓库迭代项目不过是 Agent 任务中的一种。平台不仅迭代自身，还可以管理和驱动多个外部项目的 AI 开发流程。

这不是推倒重来——v0.4 的 Agent 定义/实例分离、Capability 路由、Sync Bridge、n8n 编排、客户端注册/心跳、断路器熔断等基础设施已经具备约 75% 的跨端互联就绪度。`CallMode.HTTP` + `callUrl`、`clientType: BRIDGE`、`AgentProvider SPI` 等扩展点早已预留。

核心信念：**最好的 AI 平台，是一间所有 AI 都可以走进来坐下来工作的办公室**。
