# FD-AutoPilot Documentation

Welcome to the **FD-AutoPilot** documentation. This project is an intelligent ticket processing system that integrates Freshdesk with AI capabilities (Google NotebookLM for reply generation, Gemini CLI for translation) to automate translation and reply generation.

## Documentation Index

### 1. [Project Structure](project-structure.md)
> **Start Here for AI Analysis.**
> A detailed map of all files and directories in the codebase. Covers three sub-projects: fd-web (React 前端)、fd-client (Tauri + Rust 桌面客户端)、fd-server (Spring Boot 后端)。

### 2. [System Design](system-design.md)
> The comprehensive design document. Contains background, high-level architecture, database schema, API design, RabbitMQ message queue design, security model, and state flow diagrams.

### 3. [Client Architecture (FD-Client + FD-Web)](client-architecture.md)
> Detailed documentation for the client-side architecture (fd-web React frontend + fd-client Tauri/Rust backend).
> - **Key Topics**: Three-project relationship (fd-web → fd-server → fd-client), Tauri bridge layer, Dual MQ consumers (translation parallel, reply serial), NotebookLM "Shadow Window" hybrid observer + relay architecture, Context providers, AI Provider abstraction, Tauri command reference.

### 4. [Server Architecture (FD-Server)](server-architecture.md)
> Detailed documentation for the Spring Boot server application.
> - **Key Topics**: Modular architecture (auth/ticket/common), RBAC permission model (5-table), Module + Permission auto-registration, Ticket lifecycle, Freshdesk incremental sync, task distribution via MQ, JWT dual-token security.

### 5. [API Reference](api-reference.md)
> Complete REST API endpoint reference for `fd-server`, including all query parameters, request/response examples, and side effects.

---

## Quick Start

### Prerequisites
- **Node.js** v18+
- **Rust** (Latest Stable)
- **Java JDK 21** (Temurin)
- **Maven** 3.8+
- Access to RabbitMQ server (configured in `application.yml`)

### 1. Running the Server
```bash
cd fd-server
mvn spring-boot:run
```
*Server runs on port 9988 by default. Default admin: admin/admin123*

### 2. Running the Frontend (Development)
```bash
cd fd-web
npm install
npm run dev
```
*Vite dev server runs on port 1420. Proxies API requests to fd-server:9988.*

### 3. Publishing Frontend to Server
```bash
cd fd-web
npm run publish
```
*Builds frontend and copies to `fd-server/src/main/resources/static/`. Access via `http://localhost:9988`.*

### 4. Running the Tauri Client (Desktop)
```bash
cd fd-client
npm run tauri dev
```
*Tauri WebView loads pages from fd-server (port 9988). Requires fd-server running + fd-web published.*

### Development Modes

| Mode | Command | Access | 功能 |
|------|---------|--------|------|
| Web Dev | `cd fd-web && npm run dev` | `http://localhost:1420` | REST API 调用，任务轮询 |
| Server Embedded | `cd fd-web && npm run publish` + `mvn spring-boot:run` | `http://localhost:9988` | REST API 调用，任务轮询 |
| Tauri Desktop | `cd fd-client && npm run tauri dev` | Native window | AI 翻译 + Shadow Window（完整功能）|

---

## Architecture Overview

```
                        ┌────────────────────────┐
                        │   fd-web (React 19)    │
                        │   Vite + TailwindCSS    │
                        │   ┌──────────────────┐  │
                        │   │  shared/         │  │  ← 跨平台代码
                        │   │  (ai/, context/) │  │  ← Context、AI Provider、任务轮询
                        │   │  modules/        │  │
                        │   ├──────────────────┤  │
                        │   │  tauri/          │  │  ← Tauri-only (Shadow Window等)
                        │   └──────────────────┘  │
                        └──────────┬─────────────┘
                                   │ npm run publish
                                   ▼
Freshdesk API ──(cron)──→ fd-server (Spring Boot, H2, port 9988)
                           │  ├── auth/       (RBAC, JWT, 用户设置)
                           │  ├── task/       (任务调度、定时器、分发)
                           │  ├── ticket/     (工单业务)
                           │  └── common/     (公共基础)
                           │
                      TaskScheduler
                    (创建 TaskInstance)
                           │
                    REST API 轮询
                    /api/v1/tasks/mine
                           │
                    ┌──────┴──────┐
                    ▼              ▼
            (Web/浏览器)    fd-client (Tauri v2)
            REST 轮询         ├─ Gemini CLI (翻译)
            + 手动提交        ├─ Shadow Window (回复)
                              └─ POST /api/v1/tasks/{id}/complete
                                 (上报结果)
```

### Three-Project Relationship

| Project | Tech | Role |
|---------|------|------|
| **fd-web** | React 19 + Vite + TailwindCSS | UI 代码（浏览器 + Tauri WebView 通用） |
| **fd-server** | Spring Boot 3.4.1 + Java 21 | 后端 API + Task 调度 + WebView 加载 fd-web |
| **fd-client** | Tauri v2 + Rust | 桌面壳（WebView → fd-server）+ AI 翻译 + Shadow Window |

### 关键设计决策
- **前后端分离**: fd-web 是独立的 React 项目，可部署到 fd-server 作为静态文件，或通过 Vite 开发服务器独立运行
- **Tauri 桥接模式**: fd-web 通过 `isTauriEnv()` 检测 Tauri 环境，条件性启用 AI 功能
- **任务轮询模式**: 从客户端 RabbitMQ 消费迁到服务端 Task 调度，fd-web 通过 REST 轮询获取任务（支持浏览器模式）
- **混合 AI 引擎**: 翻译使用 Gemini CLI（快速、无头）；回复使用 NotebookLM Shadow Window（无公开 API）
- **并发模式**: 翻译支持可配置并发（MQTranslationContext batchSize=5）；回复固定串行（Shadow Window 限制）
- **模块化后端**: fd-server 使用 auth/task/ticket/common 包结构，严格的依赖规则（common ← auth ← task ← ticket）
- **RBAC 权限模型**: 5 表模型（SysUser、SysRole、SysPermission、SysUserRole、SysRolePermission）+ SysModule 动态模块管理
- **用户设置**: UserAppSettings 支持跨应用的用户配置持久化（Web/Tauri 模式通用）
