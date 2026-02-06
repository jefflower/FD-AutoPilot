# Client Architecture (FD-Client)

The `fd-client` is a hybrid application built with **Tauri v2** and **React**. It serves as both the user interface for operators and the execution engine for AI tasks.

## Technology Stack
- **Framework**: Tauri v2 (Rust + Webview)
- **Frontend**: React 19, TypeScript, Vite 7
- **Styling**: TailwindCSS 3.4
- **State Management**: React Hooks + Context
- **Backend (Tauri)**: Rust (Tokio, Lapin for RabbitMQ)

## Core Components

### 1. RabbitMQ Consumer (`src-tauri/src/mq_consumer.rs`)
The client acts as a worker node. It connects to the RabbitMQ server located at the configured host (default `47.110.152.25`) and listens on two queues:
- `q.ticket.translation`: Receives tickets that need translation.
- `q.ticket.reply`: Receives tickets that need an AI-generated reply.

**Workflow:**
1.  **Receive**: The Rust backend receives a message.
2.  **Emit**: It emits a Tauri Event (`mq-translate-request` or `mq-reply-request`) to the frontend.
3.  **Process**: The React frontend intercepts this event (in `AppNew.tsx`) and triggers the appropriate UI workflow.

### 2. NotebookLM Shadow Service (`src/services/notebookShadow.ts`)
This is the core innovation of the project. Since Google NotebookLM does not provide a public API, we use a "Shadow Window" technique.

-   **Mechanism**: A secondary, hidden Webview window (`label: notebook_window`) is created.
-   **Interaction**: The main window sends JavaScript code to be executed in the shadow window via Tauri commands (`execute_notebook_js`).
-   **Extraction**:
    -   We inject scripts to manipulate the DOM (find input box, click send).
    -   We poll the DOM for new responses.
    -   Anti-detection measures are included (e.g., simulating user interactions, clearing chat history).
-   **Privacy**: The "Thinking" process of the AI is hidden; only the final result is extracted.

### 3. State Management Hooks
We use a set of custom hooks to manage business logic:
-   `useTickets.ts`: Handles fetching ticket lists from `fd-server` and local filtering.
-   `useTranslation.ts`: Manages the translation workflow state, including batch processing.
-   `useSync.ts`: Manages the synchronization status with Freshdesk.

## Directory Map (Source)
```text
src/
├── components/
│   ├── server/           # Components for Server Tasks (Translate/Reply)
│   │   ├── ServerTicketDetail.tsx  # The main workspace for a ticket
│   │   ├── ServerTicketList.tsx    # List view of tickets
│   │   └── ...
│   ├── SidebarNew.tsx    # Navigation
│   └── ...
├── services/
│   └── notebookShadow.ts # usage: NotebookShadowService.query(prompt)
├── AppNew.tsx            # Main Entry, Global MQ Event Listeners
└── ...
```

## AI Workflow (Hybrid)

The system uses a hybrid approach for AI tasks to optimize stability and privacy.

### 1. Translation (Rust Backend)
-   **Trigger**: RabbitMQ message on `q.ticket.translation`.
-   **Execution**: The Rust backend (`mq_consumer.rs`) receives the message and directly calls a local CLI tool (`gemini`) via `std::process::Command`.
-   **Benefit**: Faster, headless execution without needing a browser window.
-   **File**: `src-tauri/src/ai.rs`.

### 2. Reply Generation (Frontend Shadow Window)
-   **Trigger**: RabbitMQ message on `q.ticket.reply`.
-   **Execution**:
    1.  Rust receives the message and emits an event `mq-reply-request` to the frontend.
    2.  `AppNew.tsx` intercepts the event and activates the `NotebookShadowService`.
    3.  The service opens a hidden "Shadow Window", injects the prompt into NotebookLM, and scrapes the result.
-   **Benefit**: Allows using Google NotebookLM's web interface which has no public API.
-   **File**: `src/services/notebookShadow.ts`.
