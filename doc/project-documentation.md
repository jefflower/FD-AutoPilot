# FD-AutoPilot Documentation

Welcome to the **FD-AutoPilot** documentation. This project is an intelligent ticket processing system that integrates Freshdesk with AI capabilities (Google NotebookLM for reply generation, Gemini CLI for translation) to automate translation and reply generation.

## Documentation Index

### 1. [Project Structure](project-structure.md)
> **Start Here for AI Analysis.**
> A detailed map of all files and directories in the codebase. Covers both frontend (Tauri + React) and backend (Spring Boot) with every component, hook, context, entity, and service listed.

### 2. [System Design](system-design.md)
> The comprehensive design document. Contains background, high-level architecture, database schema, API design, RabbitMQ message queue design, security model, and state flow diagrams.

### 3. [Client Architecture (FD-Client)](client-architecture.md)
> Detailed documentation for the Tauri + React client application.
> - **Key Topics**: Dual MQ consumers (translation parallel, reply serial), NotebookLM "Shadow Window" hybrid observer + relay architecture, Context providers (MQTranslationContext, MQReplyContext), state management hooks (useTicketProcess, useAiReply, useAiTranslation), Tauri command reference.

### 4. [Server Architecture (FD-Server)](server-architecture.md)
> Detailed documentation for the Spring Boot server application.
> - **Key Topics**: Ticket lifecycle, Freshdesk incremental sync, task distribution via MQ, sync configuration management, JWT security.

### 5. [API Reference](api-reference.md)
> Complete REST API endpoint reference for `fd-server`, including all query parameters, request/response examples, and side effects.

---

## Quick Start

### Prerequisites
- **Node.js** v18+
- **Rust** (Latest Stable)
- **Java JDK 21**
- **Maven** 3.8+
- Access to RabbitMQ server (configured in `application.yml`)

### Running the Server
```bash
cd fd-server
mvn spring-boot:run
```
*Server runs on port 9988 by default.*

### Running the Client
```bash
cd fd-client
npm install
npm run tauri dev
```

---

## Architecture Overview

```
Freshdesk API ──(cron sync)──→ fd-server (Spring Boot, H2, port 9988)
                                   │
                              RabbitMQ
                            ┌──────┴──────┐
                            ▼              ▼
               q.ticket.translation   q.ticket.reply
                            │              │
                            ▼              ▼
                     fd-client (Tauri v2 + React 19)
                     ├─ Rust MQ Consumer (lapin)
                     ├─ Gemini CLI (translation, parallel)
                     ├─ Shadow Window (NotebookLM reply, serial)
                     └─ React UI (task management, streaming display)
                            │
                            ▼
                   POST /api/v1/tickets/{id}/*
                   (submit results back to server)
```

### Key Design Decisions
- **Hybrid AI**: Translation uses Gemini CLI (fast, headless); Reply uses NotebookLM Shadow Window (no public API available)
- **Dual MQ Consumers**: Translation supports configurable concurrency; Reply is fixed serial (Shadow Window limitation)
- **Unified Code Paths**: Button clicks and MQ auto-triggers share the same hooks (`useAiReply`, `useAiTranslation`)
- **Global State**: `useTicketProcess` uses module-level variables + listener pattern (not Context) for cross-component process state sharing, including `streamingText` for real-time MQ reply display
