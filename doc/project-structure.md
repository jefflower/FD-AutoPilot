# Project Structure Map

This document provides a detailed map of the `FD-AutoPilot` codebase to help AI agents and developers understand the organization of files and directories.

## Root Directory (`/`)
- `data/`: Directory for storing persistent data (e.g., SQLite database files, H2 database files).
- `doc/`: Project documentation.
    - `api-reference.md`: HTTP API endpoints and usage.
    - `client-architecture.md`: Detail on the Tauri + React client.
    - `project-documentation.md`: High-level entry point and overview.
    - `server-architecture.md`: Detail on the Spring Boot server.
    - `system-design.md`: Original comprehensive system design doc.
- `fd-client/`: The Frontend/Client Application (Tauri + React).
- `fd-server/`: The Backend/Server Application (Spring Boot).
- `notebooklm-auto-extract.js`: Helper script for NotebookLM interaction.
- `notebooklm-test.html`: Test file for NotebookLM logic.

## Client Application (`fd-client/`)
Built with **Tauri v2**, **React 19**, **TypeScript**, and **TailwindCSS**.

### `src-tauri/` (Rust Backend for Client)
- `src/lib.rs`: Main entry point for the Tauri application logic. Exposes commands.
- `src/main.rs`: Application bootstrap.
- `src/mq_consumer.rs`: RabbitMQ consumer logic. Listens for `translate` and `reply` tasks.
- `src/settings.rs`: Settings management (persisted to disk).
- `tauri.conf.json`: Tauri configuration (windows, permissions, bundles).

### `src/` (Frontend Source)
- `main.tsx`: React entry point.
- `AppNew.tsx`: Main Layout and Routing component. Handles Sidebar and Tab switching.
- `components/`: UI Components.
    - `SidebarNew.tsx`: Main navigation sidebar.
    - `server/`: Components interacting with `fd-server` (e.g., `ServerTicketsTab.tsx`, `TranslationTasksTab.tsx`).
    - `admin/`: Admin-only components (e.g., `AdminUsersTab.tsx`).
    - `auth/`: Login and Register forms (`AuthLoginTab.tsx`).
- `hooks/`: Custom React Hooks.
    - `useAuth.ts`: Authentication state (Login, Register, Token storage).
    - `useSettings.ts`: Manages application settings (MQ config, API keys).
    - `useTickets.ts`: Fetches and filters tickets.
    - `useNotebookShadow.ts`: Hook for interacting with the NotebookLM shadow window.
- `services/`: Business Logic Services.
    - `notebookShadow.ts`: **Core Service**. Manages the hidden "Shadow" window for AI interactions. Injects JS to control NotebookLM.
- `types/`: Type definitions (`types.ts`).

## Server Application (`fd-server/`)
Built with **Spring Boot 3.4**, **Java 21**, **H2 Database**, and **RabbitMQ**.

### `src/main/java/com/jefflower/fdserver/`
- `FdServerApplication.java`: Main Spring Boot application class.
- `config/`: Configuration classes.
    - `RabbitMqConfig.java`: Queue, Exchange, and Routing Key setup.
    - `SecurityConfig.java`: Spring Security setup (JWT filters, CORS).
- `controller/`: REST API Controllers.
    - `AuthController.java`: Login/Register endpoints.
    - `TicketController.java`: Ticket management, syncing, and status updates.
    - `AdminController.java`: Manual Freshdesk sync triggers, User approvals, Sync Config.
    - `RequestController.java`: Logging raw client requests.
- `dto/`: Data Transfer Objects (Requests/Responses).
- `entity/`: JPA Entities (Database Tables).
    - `Ticket.java`: Main ticket record.
    - `TicketTranslation.java`: Translation details.
    - `TicketReply.java`: Draft replies.
    - `SysUser.java`: User accounts.
- `repository/`: Spring Data JPA Repositories.
- `service/`: Business Logic.
    - `FreshdeskService.java`: Syncs tickets from Freshdesk API.
    - `TicketService.java`: Orchestrates ticket flow and RabbitMQ message sending.
- `security/`: JWT handling and Authentication logic.

## Key Configuration Files
- `fd-server/src/main/resources/application.yml`: Server config (H2 path, RabbitMQ creds, Freshdesk Key).
- `fd-client/src-tauri/tauri.conf.json`: Client window and capability config.
