# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**FD-AutoPilot** 是一个智能工单处理系统，集成 Freshdesk 与 AI 能力（Google NotebookLM）来自动化翻译和回复生成。这是一个典型的微服务架构项目，包含 Java 后端和 Tauri + React 前端。

### 核心架构
- **fd-server**: Spring Boot 后端（Java 21），负责工单生命周期管理、Freshdesk 同步、任务分发
- **fd-client**: Tauri v2 + React 前端（Rust + TypeScript），既是用户界面也是 AI 任务执行引擎
- **消息队列**: RabbitMQ 用于异步任务分发（翻译、回复、审核）
- **数据库**: H2 文件数据库（持久化）

## 开发命令

### 服务端 (fd-server)
```bash
# 运行服务端（默认端口 9988）
cd fd-server
mvn spring-boot:run

# 构建
mvn clean package

# 运行测试
mvn test

# 跳过测试构建
mvn clean package -DskipTests
```

### 客户端 (fd-client)
```bash
# 开发模式（热重载）
cd fd-client
npm install
npm run tauri dev

# 生产构建
npm run build
npm run tauri build

# 仅前端开发（不启动 Tauri）
npm run dev

# 编译 Rust 部分
cd src-tauri
cargo build
cargo test
```

## 核心技术架构

### 状态流转机制
工单状态流转是整个系统的核心：
```
PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → COMPLETED
```

每个状态变化都会触发 RabbitMQ 消息发送到对应队列：
- `q.ticket.translation` (routing key: `ticket.task.translate`)
- `q.ticket.reply` (routing key: `ticket.task.reply`)
- `q.ticket.audit` (routing key: `ticket.task.audit`)

### NotebookLM Shadow Window 机制
这是项目最核心的创新点。由于 Google NotebookLM 没有公开 API，使用"影子窗口"技术：

1. **位置**: [fd-client/src/services/notebookShadow.ts](fd-client/src/services/notebookShadow.ts)
2. **原理**: 创建隐藏的 Webview 窗口（`label: notebook_window`）
3. **交互**:
   - 通过 Tauri 命令 `execute_notebook_js` 向影子窗口注入 JavaScript
   - 操作 DOM（查找输入框、点击发送按钮）
   - 轮询 DOM 提取 AI 响应
4. **反检测**: 模拟用户交互、清除聊天历史等措施

### RabbitMQ 消费者架构
客户端 Rust 后端作为 Worker 节点：

- **文件**: [fd-client/src-tauri/src/mq_consumer.rs](fd-client/src-tauri/src/mq_consumer.rs)
- **连接**: 默认 `47.110.152.25`（可在客户端设置中配置）
- **工作流**:
  1. Rust 接收 MQ 消息
  2. 发出 Tauri Event (`mq-translate-request` / `mq-reply-request`)
  3. React 前端拦截事件（在 [AppNew.tsx](fd-client/src/AppNew.tsx)）
  4. 触发相应的 UI 工作流

### Freshdesk 增量同步
- **位置**: `fd-server/src/main/java/.../service/FreshdeskService.java`
- **策略**:
  - Cron 定时任务（默认每 5 分钟）
  - 记录 `last_sync_time`
  - 使用 `updated_since` 参数仅获取增量工单
  - 新工单自动初始化为 `PENDING_TRANS` 并发送 MQ 消息

## 关键文件位置

### 后端核心
- **主入口**: `fd-server/src/main/java/com/jefflower/fdserver/FdServerApplication.java`
- **工单服务**: `fd-server/src/main/java/.../service/TicketService.java`
- **Freshdesk 集成**: `fd-server/src/main/java/.../service/FreshdeskService.java`
- **RabbitMQ 配置**: `fd-server/src/main/java/.../config/RabbitMqConfig.java`
- **API 控制器**:
  - `controller/TicketController.java` - 工单管理
  - `controller/AdminController.java` - 管理员功能（手动同步、用户审批）
  - `controller/AuthController.java` - 登录/注册
- **实体模型**: `entity/Ticket.java`, `entity/TicketTranslation.java`, `entity/TicketReply.java`

### 前端核心
- **主布局**: [fd-client/src/AppNew.tsx](fd-client/src/AppNew.tsx) - MQ 事件全局监听器
- **Shadow 服务**: [fd-client/src/services/notebookShadow.ts](fd-client/src/services/notebookShadow.ts)
- **工单处理组件**:
  - [fd-client/src/components/server/ServerTicketWorkspace.tsx](fd-client/src/components/server/ServerTicketWorkspace.tsx)
  - [fd-client/src/components/server/TranslationTasksTab.tsx](fd-client/src/components/server/TranslationTasksTab.tsx)
  - [fd-client/src/components/server/ReplyTasksTab.tsx](fd-client/src/components/server/ReplyTasksTab.tsx)
- **状态钩子**:
  - `hooks/useTickets.ts` - 工单数据获取
  - `hooks/useAuth.ts` - 认证状态（JWT Token）
  - `hooks/useSettings.ts` - 应用配置（MQ、API 密钥）
  - `hooks/useTicketProcess.ts` - 工单处理流程

### Rust 后端
- **主入口**: [fd-client/src-tauri/src/lib.rs](fd-client/src-tauri/src/lib.rs)
- **MQ 消费**: [fd-client/src-tauri/src/mq_consumer.rs](fd-client/src-tauri/src/mq_consumer.rs)
- **设置管理**: [fd-client/src-tauri/src/settings.rs](fd-client/src-tauri/src/settings.rs)

## 配置文件

### 服务端配置
- **文件**: `fd-server/src/main/resources/application.yml`
- **关键配置项**:
  - `freshdesk.domain` - Freshdesk 实例域名
  - `freshdesk.api-key` - API 密钥
  - `freshdesk.sync.cron` - 同步周期
  - `spring.datasource.url` - H2 数据库路径
  - `spring.rabbitmq.*` - RabbitMQ 连接配置
  - `jwt.secret` - JWT 签名密钥

### 客户端配置
- **Tauri 配置**: [fd-client/src-tauri/tauri.conf.json](fd-client/src-tauri/tauri.conf.json)
- **Cargo 依赖**: [fd-client/src-tauri/Cargo.toml](fd-client/src-tauri/Cargo.toml)
  - `lapin` - RabbitMQ 客户端
  - `reqwest` - HTTP 客户端
  - `rusqlite` - SQLite（本地数据）

## API 规范

所有 API 前缀: `/api/v1`

### 认证
- `POST /api/v1/auth/login` - 登录（返回 JWT）
- `POST /api/v1/auth/register` - 注册（初始状态 `PENDING`）

### 工单管理
- `GET /api/v1/tickets` - 查询工单（支持分页、状态过滤）
- `POST /api/v1/tickets/{id}/translation` - 上报翻译结果
- `POST /api/v1/tickets/{id}/reply` - 上报回复内容
- `POST /api/v1/tickets/{id}/audit` - 上报审核结果
- `POST /api/v1/tickets/{id}/ai-translate` - 手动触发 AI 翻译
- `POST /api/v1/tickets/{id}/ai-reply` - 手动触发 AI 回复

### 管理员功能
- `POST /api/v1/sync/freshdesk` - 手动触发 Freshdesk 同步
- `GET /api/v1/admin/users/pending` - 查询待审核用户
- `POST /api/v1/admin/users/{id}/approve` - 审批用户

**认证**: 除登录/注册外，所有接口需携带 `Authorization: Bearer <token>`

## 数据模型关系

- **Ticket** (1) → (1) **TicketTranslation** - 工单翻译
- **Ticket** (1) → (N) **TicketReply** - 回复草稿（通常只有一个活跃草稿）
- **SysUser** - 用户账户（支持 ADMIN/USER 角色）

## 开发注意事项

### 混合 AI 工作流
系统使用混合策略来优化稳定性和隐私：

1. **翻译任务**: 由 Rust 后端直接调用本地 CLI 工具（`gemini`）完成，无需浏览器窗口
   - 文件: `src-tauri/src/ai.rs`
   - 优点: 更快、无头执行

2. **回复生成**: 使用 Shadow Window 技术调用 NotebookLM
   - 原因: NotebookLM 无公开 API
   - 流程: Rust 接收 MQ → 发出事件 → React 激活 Shadow Service

### 状态管理
- 前端使用 React Hooks + Context 模式，没有引入 Redux 等状态管理库
- 客户端会话状态持久化到 Tauri 的本地存储（SQLite）

### 安全机制
- **JWT 认证**: 无状态认证，Token 存储在客户端
- **角色权限**: ADMIN（全量权限）/ USER（业务权限）
- **用户审批**: 新注册用户需管理员批准才能登录

## 文档参考

完整文档位于 [doc/](doc/) 目录：
- [doc/project-documentation.md](doc/project-documentation.md) - 项目总览（AI 分析的起点）
- [doc/system-design.md](doc/system-design.md) - 详细系统设计（包含状态流转图）
- [doc/client-architecture.md](doc/client-architecture.md) - 客户端架构详解
- [doc/server-architecture.md](doc/server-architecture.md) - 服务端架构详解
- [doc/api-reference.md](doc/api-reference.md) - API 详细参考
- [doc/project-structure.md](doc/project-structure.md) - 文件结构地图
