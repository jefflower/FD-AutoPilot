# Client Architecture (FD-Web + FD-Client)

客户端由两个独立项目组成：**fd-web**（React 前端 UI）和 **fd-client**（Tauri/Rust 桌面壳 + AI 执行引擎）。

## 三项目关系

```
fd-web (React 19 + Vite)
  │
  │  npm run publish → 构建并复制到 fd-server/static/
  ▼
fd-server (Spring Boot, port 9988)
  │  SpaWebConfig 托管 SPA 页面
  │
  ▼ WebView 加载
fd-client (Tauri v2, pure Rust)
  ├── MQ Consumer (RabbitMQ)
  ├── AI Engine (Gemini CLI + NotebookLM Shadow)
  └── Native APIs (文件、窗口、进程)
```

fd-web 代码在浏览器和 Tauri WebView 中均可运行。Tauri 特有功能（AI、Shadow Window）通过 `isTauriEnv()` 检测后条件加载。MQ 消费从客户端迁到服务端后，fd-web 通过 REST 轮询 task claim API 获取任务。

## Technology Stack

| Layer | Tech |
|-------|------|
| **fd-web Frontend** | React 19, TypeScript, Vite 7, TailwindCSS 3.4 |
| **State Management** | React Hooks + Context + Module-level Global State |
| **i18n** | i18next + react-i18next (zh-CN / en-US) |
| **fd-client Backend** | Rust (Tokio, Lapin for RabbitMQ, Reqwest for HTTP) |
| **Desktop Framework** | Tauri v2 |

## fd-web 项目结构

### 核心分层

```
fd-web/src/
├── shared/       # 跨模块共享（纯浏览器安全代码，无 Tauri 依赖）
│   ├── components/   # 通用 UI 组件
│   ├── hooks/        # useAuth, useToast
│   ├── ai/           # AI Provider 抽象 + 实现
│   ├── context/      # 任务管理 Context (工厂模式)
│   ├── services/     # serverApi.ts (REST API 封装)
│   ├── types/        # server.ts (后端类型定义)
│   ├── constants/    # agentMap.ts
│   ├── utils/        # statusLabels.ts
│   └── i18n/         # 国际化配置 + 翻译文件
│
├── modules/      # 按业务域划分页面
│   ├── auth/         # 登录/注册
│   ├── ticket/       # 工单列表/详情/翻译/回复/审核/推送
│   ├── admin/        # 用户管理/同步/知识库/数据库/日志
│   └── system/       # 设置/个人资料
│
├── tauri/        # Tauri 桥接层（仅 Tauri WebView 环境生效）
│   ├── bridge.ts     # isTauriEnv() + tauriInvoke/Emit/Listen
│   ├── hooks/        # useSettings, useNotebookShadow, useTicketProcess
│   └── services/     # notebookShadow.ts, trackingShadow.ts
│
├── router/       # React Router 路由配置 + 权限守卫
├── App.tsx       # 全局布局、Context Provider 包裹
└── main.tsx      # React 入口
```

### shared/ vs tauri/ 的区别

| 层 | 可运行环境 | 依赖 | 说明 |
|---|-----------|------|------|
| `shared/` | 浏览器 + Tauri | 仅标准 Web API | 包含 AI Provider、任务 Context、REST API 客户端等跨平台代码 |
| `tauri/` | 仅 Tauri WebView | `@tauri-apps/api`, Rust commands | Shadow Window 服务、Tauri 事件绑定等原生功能 |

### Tauri 桥接层 (`tauri/bridge.ts`)

```typescript
export const isTauriEnv = () => '__TAURI_INTERNALS__' in window;

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}
```

浏览器模式下，MQ/AI/Shadow 功能不可用（对应 Tab 隐藏或显示提示）。Tauri 模式下自动启用。

## fd-web 目录详图

```text
fd-web/src/
├── App.tsx                              # 全局布局、Context Provider、Tab 路由（React.lazy 懒加载）
├── main.tsx                             # React 入口
├── modules/
│   ├── admin/
│   │   ├── components/
│   │   │   ├── H2ConsolePanel.tsx       # H2 数据库控制台
│   │   │   └── SqlQueryPanel.tsx        # SQL 查询面板
│   │   └── pages/
│   │       ├── AdminUsersTab.tsx        # 用户管理
│   │       ├── DatabaseTab.tsx          # 数据库查询
│   │       ├── KnowledgeTab.tsx         # 知识库管理
│   │       ├── ManualSyncTab.tsx        # 手动同步 + 自动推送
│   │       └── ServerLogsTab.tsx        # 服务器日志
│   ├── auth/
│   │   └── pages/
│   │       ├── AuthLoginTab.tsx         # 登录（左右分屏 + 极光动画）
│   │       └── AuthRegisterTab.tsx      # 注册
│   ├── system/
│   │   └── pages/
│   │       ├── SettingsTab.tsx          # 设置（NotebookLM）
│   │       └── UserProfileTab.tsx       # 个人信息
│   └── ticket/
│       ├── components/
│       │   ├── ServerTicketDetail.tsx   # 工单详情（AI 操作 ~600 行）
│       │   ├── ServerTicketList.tsx     # 分页工单列表
│       │   └── ticket-detail/
│       │       ├── TranslationPreviewBar.tsx   # 翻译确认栏
│       │       ├── AiReplyPanel.tsx            # AI 回复流式显示
│       │       └── ReplyHistoryPanel.tsx       # 回复历史 + 审核控件
│       └── pages/
│           ├── ServerTicketsTab.tsx     # 工单列表 Tab
│           ├── ServerTaskWorkspace.tsx  # 多标签页工作区
│           ├── TranslationTasksTab.tsx  # 翻译任务（REST 轮询）
│           ├── ReplyTasksTab.tsx        # 回复任务（REST 轮询）
│           ├── AuditTasksTab.tsx        # 审核任务（卡片内联审核）
│           └── ApprovedTasksTab.tsx     # 待推送队列 + 批量推送
├── shared/
│   ├── ai/
│   │   ├── types.ts                     # AiTranslationProvider / AiReplyProvider 接口
│   │   ├── index.ts                     # 工厂函数 + re-exports
│   │   ├── parseUtils.ts                # JSON 解析工具
│   │   └── providers/
│   │       ├── geminiTranslationProvider.ts   # Gemini CLI 翻译
│   │       └── notebookLMReplyProvider.ts     # NotebookLM 回复生成
│   ├── components/
│   │   ├── SidebarNew.tsx               # 导航侧边栏
│   │   ├── Common.tsx                   # 通用 UI（LangLabel 等）
│   │   ├── FloatingTaskWidget.tsx       # 浮动任务指示器
│   │   ├── ConfirmDialog.tsx            # 确认对话框
│   │   ├── ErrorBoundary.tsx            # 错误边界
│   │   ├── Toast.tsx                    # 吐司提示
│   │   └── ToastProvider.tsx            # 吐司上下文
│   ├── context/
│   │   ├── createMQTaskContext.tsx      # 通用任务管理 Context 工厂
│   │   ├── MQTranslationContext.tsx     # 翻译 Context (轮询模式, batchSize=5)
│   │   ├── MQReplyContext.tsx           # 回复 Context (轮询模式, delay=1s)
│   │   └── MQAuditContext.tsx           # 审核 Context (轮询模式, 人工操作)
│   ├── hooks/
│   │   ├── useAuth.ts                   # JWT 认证（登录、注册、token 存储）
│   │   ├── useToast.ts                  # 吐司 Hook
│   │   ├── useAiTranslation.ts          # AI 翻译 Hook → GeminiTranslationProvider
│   │   ├── useAiReply.ts                # AI 回复 Hook → NotebookLMReplyProvider
│   │   └── useTicketProcess.ts          # 全局工单处理状态（模块级变量 + listener）
│   ├── services/
│   │   └── serverApi.ts                 # 后端 REST API 客户端封装
│   ├── types/
│   │   └── server.ts                    # 服务端 API 类型定义
│   ├── constants/
│   │   └── agentMap.ts                  # Freshdesk Agent ID → 名称映射
│   ├── utils/
│   │   └── statusLabels.ts              # 工单状态中文标签
│   └── i18n/
│       ├── config.ts                    # i18next 配置
│       └── locales/{en-US,zh-CN}/       # 翻译文件 (6×2)
├── tauri/
│   ├── bridge.ts                        # Tauri 环境检测 + 命令桥接
│   ├── hooks/
│   │   ├── useSettings.ts               # 本地设置管理（Tauri 仅）
│   │   └── useNotebookShadow.ts         # Shadow 窗口可见性
│   └── services/
│       ├── notebookShadow.ts            # NotebookLM 影子窗口核心（SELECTORS + observer + relay）
│       ├── trackingShadow.ts            # 追踪影子窗口
│       └── trackingUtils.ts             # 追踪工具
├── router/
│   ├── index.tsx                        # 路由配置入口
│   ├── routes.ts                        # 路由定义（关联 module + requiredPermission）
│   └── guards.tsx                       # 路由守卫（权限检查）
└── test/
    ├── setup.ts                         # Vitest 全局配置
    ├── renderHelper.tsx                 # RTL 辅助函数
    └── tauriMock.ts                     # Tauri API 模拟
```

## Core Components

### 1. 任务消费模式（REST 轮询）

**架构变更**: MQ 消费已从客户端迁移到服务端。客户端现通过 REST 轮询获取任务：

**Workflow:**
1. **Server**: TaskScheduler 创建 TaskInstance（状态: PENDING），通过 Webhook 或定时器通知客户端
2. **Client**: 定期轮询 `GET /api/v1/tasks/mine` 获取待处理任务列表
3. **Claim**: 客户端调用 `POST /api/v1/tasks/{id}/claim` 领取任务（状态转为 CLAIMED）
4. **Execute**: 本地执行任务逻辑（翻译/回复/审核）
5. **Complete**: 调用 `POST /api/v1/tasks/{id}/complete` 上报结果（状态转为 COMPLETED/FAILED）

| Context | 轮询间隔 | 并发模式 | 说明 |
|---------|---------|---------|------|
| MQTranslationContext | 2s | 并行 (batchSize=5) | 翻译任务并发执行 |
| MQReplyContext | 3s | 串行 (delay=1s) | 回复任务串行执行，避免影响输入焦点 |
| MQAuditContext | 3s | 串行 (delay=500ms) | 审核任务串行执行，人工操作模式 |

**优点**:
- 客户端无需维护 RabbitMQ 连接，降低复杂度
- 支持多客户端同时工作（自动负载均衡）
- 服务端可集中管理任务生命周期和重试策略

### 2. NotebookLM Shadow Service (`fd-web/src/tauri/services/notebookShadow.ts`)
Google NotebookLM 无公开 API，使用 **Shadow Window** 技术 + **混合 observer + relay 架构 (v3)**。

- **Window**: 隐藏 Webview 窗口 (`label: notebook_shadow`)，`initialization_script` 建立 `window.__TAURI__` IPC 桥接
- **Query Flow** (`NotebookShadowService.query(prompt)`):
  1. **mainScript** (IIFE): 清理历史 → 输入 prompt → 点击发送 → 建立 setInterval observer
  2. **Observer** (shadow window 内): 读取 bot 回复 → 检测完成 → 写入 `window.__SHADOW_LATEST_RESULT`
  3. **Relay** (定期注入): 读取全局变量 → `forward_shadow_event` 中继到主窗口
  4. **Generator** 产出 `{ text, status }` chunks
- **Mutex**: 全局互斥锁确保同时只有一个查询执行
- **DOM Selectors**: 集中在 `SELECTORS` 常量对象中管理

### 2. Task Management Context 工厂 (`fd-web/src/shared/context/`)

#### createMQTaskContext (Factory)
通用工厂函数，从 `MQTaskConfig` 对象生成 React Context + Provider + hook。消除 95% 重复代码。支持 REST 轮询和任务执行的完整生命周期。

**Config**: `taskType`, `pollUrl`, `claimUrl`, `completeUrl`, `releaseUrl`, `defaultBatchSize`, `concurrencyMode`, `interTaskDelayMs`, `pollIntervalMs`

**Internal**: REST 轮询 → task dedup → 并发/串行调度 → 完成历史记录 → 自动重试

#### MQTranslationContext
- Config: `concurrencyMode: 'parallel'`, `defaultBatchSize: 5`, `pollIntervalMs: 2000`
- 支持并行翻译多个工单
- 集成 `runTranslation` 作为 taskProcessor

#### MQReplyContext
- Config: `concurrencyMode: 'serial'`, `defaultBatchSize: 1`, `interTaskDelayMs: 1000`, `pollIntervalMs: 3000`
- 串行处理（避免多个 Shadow Window 冲突）
- 支持流式文本通过 `onStreamChunk` 回调桥接到 UI

#### MQAuditContext
- Config: `concurrencyMode: 'serial'`, `defaultBatchSize: 1`, `interTaskDelayMs: 500`, `pollIntervalMs: 3000`
- taskProcessor 返回 Promise，等待用户手动审核
- 非 `PENDING_AUDIT` 状态的工单自动跳过
- 导出 `completeAudit(ticketId, success)` 和 `getAuditingTicket(ticketId)`

### 3. AI Provider 抽象 (`fd-web/src/shared/ai/`)
定义 Provider 接口 (`AiTranslationProvider`, `AiReplyProvider`) 和实现：
- `GeminiTranslationProvider` — 包装 Tauri `translate_ticket_direct_cmd` invoke（Tauri 模式下）或本地 HTTP API（Web 模式下）
- `NotebookLMReplyProvider` — 包装 `NotebookShadowService` + 流式处理 + JSON 解析（Tauri 模式下专用）
- Factory 函数 `getTranslationProvider(name)` / `getReplyProvider(name, config)` 支持未来切换 AI 提供商

### 4. 状态管理

#### Hooks

| Hook | Location | Purpose | 环境 |
|------|----------|---------|------|
| `useAuth` | `shared/hooks/` | JWT 认证（登录、注册、token 存储） | 浏览器 + Tauri |
| `useToast` | `shared/hooks/` | 全局吐司提示 | 浏览器 + Tauri |
| `useAiReply` | `shared/hooks/` | AI 回复 → NotebookLMReplyProvider | 浏览器 + Tauri |
| `useAiTranslation` | `shared/hooks/` | AI 翻译 → GeminiTranslationProvider | 浏览器 + Tauri |
| `useTicketProcess` | `shared/hooks/` | 全局工单处理状态（模块级变量 + listener） | 浏览器 + Tauri |
| `useSettings` | `tauri/hooks/` | 本地设置（Tauri 仅） | Tauri 仅 |
| `useNotebookShadow` | `tauri/hooks/` | Shadow 窗口可见性（Tauri 仅） | Tauri 仅 |

#### 共享常量
- `shared/constants/agentMap.ts` — Freshdesk Agent ID → 名称映射

## fd-client Rust 后端 (`fd-client/src-tauri/src/`)

fd-client 已极简化为纯 Rust 项目，专注 AI 翻译和 Shadow Window 功能。不再包含 MQ 消费者和本地设置存储。WebView 加载 fd-server 托管的 fd-web 页面。

```text
src-tauri/src/
├── lib.rs           # Tauri commands 注册
├── main.rs          # 应用引导
├── ai.rs            # Gemini CLI 翻译引擎
├── models.rs        # 共享数据模型 (Ticket, Conversation, etc.)
└── api.rs           # Freshdesk HTTP client (本地直连，备用)
```

## Tauri Commands (registered in `lib.rs`)

| Category | Commands | 说明 |
|----------|----------|------|
| File | `select_folder`, `save_text_file_cmd` | 文件系统操作 |
| Translation | `translate_ticket_direct_cmd` | Gemini CLI 翻译 |
| NotebookLM | `open_notebook_window`, `execute_notebook_js`, `get_shadow_result`, `toggle_notebook_window`, `get_notebook_window_visibility`, `forward_shadow_event` | Shadow Window 管理 |
| NotebookLM Selectors | `get_notebook_selectors_cmd`, `save_notebook_selectors_cmd`, `reset_notebook_selectors_cmd` | DOM 选择器管理 |

## AI Workflow (Provider-based)

### 1. 翻译 (`GeminiTranslationProvider`)
- **触发**: REST API `POST /api/v1/tasks/claim` 获取翻译任务，或 UI 按钮手动触发
- **执行**: `useAiTranslation` → `GeminiTranslationProvider.translate()` → `invoke('translate_ticket_direct_cmd')` → Rust `ai.rs` → `gemini` CLI
- **并发**: 支持并行（MQTranslationContext 默认 `batchSize: 5`）
- **结果**: 自动通过 `serverApi.ticket.submitTranslation()` 保存，或 UI 预览确认后提交
- **集成**: 支持浏览器模式（HTTP API）和 Tauri 模式（本地 CLI）

### 2. 回复生成 (`NotebookLMReplyProvider`)
- **触发**: REST API `POST /api/v1/tasks/claim` 获取回复任务，或 UI 按钮手动触发
- **执行**: `useAiReply` → `NotebookLMReplyProvider.generateReply()` → `NotebookShadowService.query(prompt)` → Shadow Window → NotebookLM
- **并发**: 仅串行（Shadow Window 限制，MQReplyContext 强制 `batchSize: 1`）
- **结果**: 解析为 `[targetReply, zhReply]` JSON 数组。自动保存或 UI 确认
- **JSON 解析**: 反向搜索 `["` pattern（避免匹配 prompt 中的 `[timestamp]`），共享于 `parseUtils.ts`
- **集成**: 仅限 Tauri 模式（依赖 Shadow Window）

### 3. 审核 (`MQAuditContext`)
- **触发**: REST API 轮询获取待审核工单
- **执行**: UI 卡片内联审核（PASS / REJECT）
- **交互**: 人工操作，无自动化
- **结果**: 通过 `serverApi.ticket.submitAudit()` 提交审核结论

## Performance Optimization

### Component Lazy Loading (`App.tsx`)
首屏同步加载：`SidebarNew`, `AuthLoginTab`, `AuthRegisterTab`

其余 Tab 通过 `React.lazy()` + `Suspense` 懒加载（Settings, TranslationTasks, ReplyTasks, ServerTickets, AuditTasks, ApprovedTasks, AdminUsers, ManualSync, ServerLogs, Database, Knowledge, UserProfile, FloatingTaskWidget）

### Vite Build Optimization (`vite.config.ts`)
- **Manual Chunks**: `react-vendor`, `tauri-vendor`, `i18n-vendor`
- **Chunk Size Warning Limit**: 500KB

## UI Features

### Authentication Page (`AuthLoginTab.tsx`)
- 左右分屏：左侧工单流水线动画，右侧登录表单
- 视效：极光背景、浮动粒子、S-wave 流水线、玻璃态表单
- "忘记密码？"链接：引导联系管理员

### DevTools
- Tauri DevTools 通过右键菜单 → "Inspect Element" 打开
