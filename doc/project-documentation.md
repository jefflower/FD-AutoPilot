# FD-AutoPilot Documentation

Welcome to the **FD-AutoPilot** documentation. This project is an intelligent ticket processing system that integrates Freshdesk with AI capabilities (Google NotebookLM) to automate translation and reply generation.

## 📚 Documentation Index

### 1. [Project Structure](project-structure.md)
> **Start Here for AI Analysis.**
> A detailed map of the files and directories in the codebase. Essential for understanding where code lives.

### 2. [System Design](system-design.md)
> The original comprehensive design document. Contains the background, high-level architecture, database schema, and detailed state flow diagrams.

### 3. [Client Architecture (FD-Client)](client-architecture.md)
> Specific documentation for the Tauri + React client application.
> - **Key Topics**: RabbitMQ Consumer, NotebookLM "Shadow Window" Service, React Components.

### 4. [Server Architecture (FD-Server)](server-architecture.md)
> Specific documentation for the Spring Boot server application.
> - **Key Topics**: Ticket Lifecycle, Freshdesk Sync Logic, Task Distribution.

### 5. [API Reference](api-reference.md)
> Details of the REST API endpoints provided by the `fd-server`.

---

## 🚀 Quick Start

### Prerequisites
-   **Node.js** v18+
-   **Rust** (Latest Stable)
-   **Java JDK 21**
-   **Maven** 3.8+
-   Access to the RabbitMQ server (Configured in `application.yml`).

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
