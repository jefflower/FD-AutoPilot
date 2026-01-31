# FD-AutoPilot 项目说明文档

## 1. 项目概览 (Project Overview)

FD-AutoPilot 是一个智能化的工单处理辅助系统，旨在通过自动化手段提升 Freshdesk 工单的处理效率。系统通过集成 AI 能力（如 Google NotebookLM），实现多语言工单的自动翻译、智能回复生成以及人工审核闭环。

核心价值：
- **自动化翻译**：打破语言障碍，支持多语言工单处理。
- **智能辅助回复**：基于 AI 生成标准回复建议，减少人工输入。
- **高效流转**：通过消息队列（RabbitMQ）实现任务的异步分发与处理。
- **双端协同**：服务端负责数据管理与流程控制，客户端（Tauri）负责执行具体的 AI 交互任务。

---

## 2. 系统架构 (Architecture)

系统采用 **C/S (Client/Server)** 架构，通过 RabbitMQ 进行异步通信。

### 架构组件
1.  **服务端 (fd-server)**:
    -   **角色**: 中央控制节点。
    -   **职责**:
        -   对接 Freshdesk API 同步工单。
        -   管理工单全生命周期状态（PENDING_TRANS -> COMPLETED）。
        -   通过 RabbitMQ 发布待处理任务（翻译、回复、审核）。
        -   提供 REST API 供客户端上报结果及查询数据。
    -   **数据存储**: H2 Database (嵌入式文件存储)。

2.  **客户端 (fd-client)**:
    -   **角色**: 任务执行节点 & 用户操作界面。
    -   **职责**:
        -   **MQ 消费者**: 监听 RabbitMQ 队列，获取翻译/回复任务。
        -   **AI 执行器**: 调用本地或远程 AI 服务（如 NotebookLM）进行翻译和回复生成。
        -   **人工审核**: 提供界面供客服人员审核、修改 AI 生成的内容。
        -   **结果上报**: 将处理结果回传至 fd-server。

3.  **消息队列 (RabbitMQ)**:
    -   **角色**: 异步消息总线。
    -   **职责**: 解耦服务端与客户端，确保任务可靠分发。

---

## 3. 技术栈 (Technology Stack)

### 服务端 (fd-server)
-   **语言**: Java 21
-   **框架**: Spring Boot 3.4.1
-   **数据库**: H2 Database (File-based)
-   **ORM**: Spring Data JPA
-   **安全**: Spring Security + JWT
-   **消息队列**: Spring AMQP (RabbitMQ)
-   **构建工具**: Maven

### 客户端 (fd-client)
-   **核心框架**: Tauri v2
-   **前端 (Frontend)**:
    -   React 19
    -   TypeScript
    -   Vite 7
    -   TailwindCSS 3.4
-   **后端 (Rust Backend)**:
    -   `rusqlite`: 本地 SQLite 数据库操作
    -   `reqwest`: HTTP 请求客户端
    -   `lapin`: AMQP (RabbitMQ) 客户端
    -   `tokio`: 异步运行时
    -   `tauri-plugin-opener/dialog`: 系统交互插件

---

## 4. 目录结构 (Directory Structure)

```text
FD-AutoPilot/
├── doc/                    # 项目文档 (系统设计、API 说明等)
├── fd-client/              # 客户端项目 (Tauri + React)
│   ├── src/                # 前端源码
│   ├── src-tauri/          # Rust 后端源码
│   ├── package.json        # 前端依赖配置
│   └── ...
├── fd-server/              # 服务端项目 (Spring Boot)
│   ├── src/main/java       # Java 源码
│   ├── src/main/resources  # 配置文件 (application.yml)
│   ├── pom.xml             # Maven 依赖配置
│   └── ...
├── notebooklm-auto-extract.js # 辅助脚本
└── data/                   # 数据目录
```

---

## 5. 环境准备与配置 (Setup & Configuration)

### 前置要求
-   **Node.js**: v18+
-   **Rust**: 最新稳定版 (用于编译 Tauri 客户端)
-   **Java**: JDK 21
-   **Maven**: 3.8+
-   **RabbitMQ**: 服务端配置地址为 `47.110.152.25:5672` (开发环境需确保网络连通或修改为本地)

### 服务端配置 (`fd-server/src/main/resources/application.yml`)
关键配置项包括：
-   **数据库**: H2 文件路径 (`jdbc:h2:file:/var/lib/h2/db` 需根据环境调整)
-   **RabbitMQ**: Host, Port, Username, Password
-   **Freshdesk**: Domain, API Key
-   **JWT**: Secret, Expiration

### 客户端配置
客户端主要通过界面设置或本地配置文件进行管理，运行时依赖 RabbitMQ 连接配置。

---

## 6. 运行指南 (Running the Project)

### 启动服务端
```bash
cd fd-server
mvn spring-boot:run
```
*服务默认端口: 9988*

### 启动客户端 (开发模式)
```bash
cd fd-client
npm install  # 首次运行需安装依赖
npm run tauri dev
```

---

## 7. 核心功能流程 (Key Workflows)

1.  **工单同步**:
    -   服务端定时从 Freshdesk 拉取更新的工单。
    -   新工单生成翻译任务推送到 `q.ticket.translation`。

2.  **自动翻译**:
    -   客户端监听 `q.ticket.translation`。
    -   调用翻译服务将工单内容从源语言翻译为目标语言。
    -   结果上报服务端，状态变更为 `PENDING_REPLY`。

3.  **智能回复**:
    -   服务端推送任务至 `q.ticket.reply`。
    -   客户端接收任务，结合知识库/AI 生成回复建议。
    -   结果上报服务端，状态变更为 `PENDING_AUDIT`。

4.  **人工审核**:
    -   客服在客户端界面查看待审核工单。
    -   对比翻译与原文，修改并确认回复内容。
    -   审核通过后，服务端自动调用 Freshdesk API 回复客户，工单流转至 `COMPLETED`。

---

## 8. 常见问题 (FAQ)

-   **Q: 客户端无法连接 MQ?**
    -   A: 请检查 `Settings` 页面中的 MQ 配置是否正确，以及网络是否允许连接到远程 MQ 服务端口。
-   **Q: 数据库文件在哪里?**
    -   A: 服务端配置为 `/var/lib/h2/db`，在 Windows/Mac 本地运行时可能需要修改为绝对路径或用户目录下的路径。
