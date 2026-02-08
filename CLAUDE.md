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

# Rust 部分单独编译/测试
cd src-tauri
cargo build                            # 编译 Rust
cargo test                             # Rust 测试
```

**注意**: 前端没有配置 ESLint、Prettier 或测试框架（无 vitest/jest）。也没有 CI/CD 流水线。

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
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → COMPLETED
```

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
   - DOM 选择器：使用 `.to-user-container .message-text-content` 只提取 bot 回复（避免 prompt 中的 `[timestamp]` 干扰 JSON 解析）
   - 完成检测：`.xap-copy-to-clipboard` 复制按钮出现 + `isJsonBalanced` + `botIdle` + `botResponded` 多重校验
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
- `MQTranslationContext` — 管理翻译任务队列、处理中任务、完成历史、MQ 消费者启停
- `MQReplyContext` — 管理回复任务队列，结构与翻译 Context 对称，但默认 batchSize=1（回复需要 Shadow Window 串行执行）。传递 `onStreamChunk` 回调将流式文本写入全局状态，供 `ServerTicketDetail` 显示
- `useTicketProcess` — 全局工单处理状态（`status`, `tempTranslation`, `tempAiReply`, `streamingText`），使用模块级变量 + listener 模式跨组件共享，`streamingText` 用于 MQ 流式文本桥接
- **统一 AI Hooks**（按钮点击和 MQ 自动触发走同一代码路径）：
  - `useAiReply` — AI 回复生成（Shadow Window → NotebookLM），支持 `onStreamChunk`/`onParsed`/`onPromptReady` 回调
  - `useAiTranslation` — AI 翻译（Rust Gemini CLI），支持 `onStatusChange`/`onError` 回调
- 其他 Hooks: `useAuth`, `useSettings`, `useTickets`, `useSync`, `useNotebookShadow`
- 共享常量: `constants/agentMap.ts` — Freshdesk Agent ID → 名称映射（统一引用，避免多处定义）

## 关键文件位置

### 后端 (fd-server/src/main/java/com/jefflower/fdserver/)
- **工单服务**: `service/TicketService.java` — 工单工作流编排核心
- **Freshdesk 同步**: `service/FreshdeskService.java` + `scheduler/SyncScheduler.java`
- **MQ 发布**: `service/MqPublisherService.java`
- **RabbitMQ 配置**: `config/RabbitMQConfig.java`（队列、交换机、绑定）
- **安全配置**: `config/SecurityConfig.java` + `security/JwtUtil.java` + `security/JwtAuthenticationFilter.java`
- **实体**: `entity/Ticket.java`, `entity/TicketTranslation.java`, `entity/TicketReply.java`, `entity/TicketAudit.java`, `entity/SysUser.java`

### 客户端前端 (fd-client/src/)
- **主入口**: `AppNew.tsx` — 全局布局、Context Provider 包裹、Tab 路由
- **Shadow 服务**: `services/notebookShadow.ts` — NotebookLM 影子窗口核心逻辑（混合 observer + relay 架构）
- **API 客户端**: `services/serverApi.ts` — 后端 REST API 封装
- **Context**: `context/MQTranslationContext.tsx`, `context/MQReplyContext.tsx` — MQ 任务队列管理、事件监听、去重
- **统一 AI Hooks**: `hooks/useAiReply.ts`, `hooks/useAiTranslation.ts` — 按钮和 MQ 共用的 AI 处理逻辑
- **全局状态**: `hooks/useTicketProcess.ts` — 工单处理状态 + 流式文本桥接
- **共享常量**: `constants/agentMap.ts` — Agent ID 映射
- **Server 模式组件**: `components/server/` — 工单列表、翻译任务、回复任务、审核任务、`ServerTaskWorkspace`（多标签页工作区）、`FloatingTaskWidget`（浮动任务指示器）

### 客户端 Rust 后端 (fd-client/src-tauri/src/)
- **Tauri 命令注册**: `lib.rs` — 所有 `#[tauri::command]` 和 `invoke_handler` 注册
- **MQ 消费者**: `mq_consumer.rs`（~27KB，包含翻译和回复两个独立消费者）
- **AI 翻译**: `ai.rs` — Gemini CLI 调用封装
- **Freshdesk API**: `api.rs` — 本地直连 Freshdesk 的 HTTP 客户端

## API 规范

所有 API 前缀: `/api/v1`，除登录/注册外需携带 `Authorization: Bearer <token>`

### 核心端点
- `POST /auth/login` | `POST /auth/register` — 认证
- `GET /tickets` — 查询工单（分页、状态过滤）
- `POST /tickets/{id}/translation` — 上报翻译结果
- `POST /tickets/{id}/reply` — 上报回复内容
- `POST /tickets/{id}/audit` — 上报审核结果
- `POST /tickets/{id}/ai-translate` | `POST /tickets/{id}/ai-reply` — 手动触发 AI 任务
- `POST /sync/freshdesk` — 手动触发同步
- `GET /admin/users/pending` | `POST /admin/users/{id}/approve` — 用户审批

## 数据模型

- **Ticket** (1) → (1) **TicketTranslation**
- **Ticket** (1) → (N) **TicketReply**（通常只有一个活跃草稿）
- **Ticket** (1) → (N) **TicketAudit**
- **SysUser** — 角色: ADMIN/USER，状态: PENDING/APPROVED/REJECTED

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
