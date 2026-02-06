# Server Architecture (FD-Server)

The `fd-server` is a centralized Java Spring Boot application that manages the lifecycle of tickets, synchronizes with Freshdesk, and coordinates valid tasks via RabbitMQ.

## Technology Stack
- **Language**: Java 21
- **Framework**: Spring Boot 3.4.1
- **Database**: H2 Database (File-based, persistent)
- **ORM**: Spring Data JPA
- **Messaging**: RabbitMQ (via Spring AMQP)
- **Security**: Spring Security + JWT

## Core Modules

### 1. Data Model (`src/main/java/.../entity`)
The data model is centered around the `Ticket` entity.
-   **Ticket**: The root aggregate. Contains `subject`, `content`, `status`, `externalId` (Freshdesk ID).
-   **TicketTranslation**: One-to-One with Ticket. Stores the translated title and content.
-   **TicketReply**: One-to-Many with Ticket (conceptually, though usually one active draft). Stores the proposed reply in both languages.
-   **SysUser**: Users for the system (Admin/User).

### 2. Business Logic
#### Ticket Synchronization (`FreshdeskService.java`)
-   **Cron Job**: A scheduled task runs every 5 minutes (configurable).
-   **Incremental Sync**: It queries Freshdesk for tickets updated since the `last_sync_time`.
-   **Task Generation**:
    -   If a ticket is new and status is `Open`, it is saved as `PENDING_TRANS`.
    -   A message is immediately sent to `q.ticket.translation` via RabbitMQ.

#### Task Distribution (`TicketService.java`)
State changes trigger MQ messages:
-   `PENDING_TRANS` -> Send to `q.ticket.translation`
-   `PENDING_REPLY` -> Send to `q.ticket.reply` (after translation is received)
-   `PENDING_AUDIT` -> Send to `q.ticket.audit` (after reply is generated)

### 3. API Layer (`TicketController.java`)
Exposes REST endpoints for the client to:
-   Fetch lists of tickets (pagination supported).
-   Submit translation results (`POST /api/v1/tickets/{id}/translation`).
-   Submit reply drafts (`POST /api/v1/tickets/{id}/reply`).
-   Submit audit decisions (`POST /api/v1/tickets/{id}/audit`).
-   **Manual Triggers**:
    -   Trigger AI Translation: `POST /api/v1/tickets/{id}/ai-translate`
    -   Trigger AI Reply: `POST /api/v1/tickets/{id}/ai-reply`
-   **Admin**:
    -   Sync Config & Status: `/api/v1/sync/*`
    -   User Approval: `/api/v1/admin/users/*`

## Configuration
Configuration is managed in `application.yml`.
```yaml
freshdesk:
  domain: your-domain.freshdesk.com
  api-key: your-api-key
  sync:
    cron: "0 0/5 * * * ?" # Every 5 minutes

spring:
  datasource:
    url: jdbc:h2:file:/var/lib/h2/db # Persistent H2 path
  rabbitmq:
    host: 47.110.152.25
```
