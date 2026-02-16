# 项目结构地图

本文档提供了 `FD-AutoPilot` 代码库的详细地图，帮助 AI 代理和开发人员理解文件和目录的组织结构。

## 根目录（`/`）
- `data/`: 持久化数据存储目录（H2 数据库文件）。
- `doc/`: 项目文档。
- `fd-server/`: 后端应用（Spring Boot），含 RBAC 权限、工单业务、SPA 托管。
- `fd-web/`: 前端应用（React 19 + Vite 7），独立 Web 项目。
- `fd-client/`: 桌面客户端（Tauri v2，纯 Rust），WebView 加载 fd-web。

## 三项目关系

```
fd-web (React 前端)
  ├── npm run dev          → localhost:5173（开发模式，代理 /api → fd-server:9988）
  ├── npm run publish      → 构建并复制到 fd-server/static/（一键发布）
  └── npm run build        → dist/（供 fd-client 打包或 fd-server 托管）

fd-server (Spring Boot 后端)
  ├── mvn spring-boot:run  → localhost:9988（API + 可选 SPA 托管）
  └── SpaWebConfig         → 当 static/index.html 存在时自动激活 SPA 路由

fd-client (Tauri 桌面壳)
  ├── npm run tauri dev    → WebView 加载 fd-web dev server (5173)
  └── npm run tauri build  → WebView 加载 fd-web/dist（离线打包）
```

### 开发模式

| 场景 | 启动命令 | 说明 |
|------|---------|------|
| 前端独立开发 | `cd fd-web && npm run dev` | 浏览器访问 5173，API 代理到 9988 |
| 全栈开发 | fd-server:run + fd-web:dev | 前后端分离热重载 |
| Tauri 桌面开发 | fd-server:run + fd-web:dev + `cd fd-client && npm run tauri dev` | 三端联调 |
| 集成预览 | `cd fd-web && npm run publish` + fd-server:run | 浏览器访问 9988，前后端同源 |

---

## 前端应用（`fd-web/`）

基于 **React 19**、**Vite 7**、**TypeScript**、**TailwindCSS 3.4**、**React Router 7** 构建。

### 目录树
```
fd-web/
├── src/
│   ├── main.tsx                               # React 入口
│   ├── App.tsx                                # 主布局、Context Provider、Tab 路由
│   ├── index.css                              # 全局样式（TailwindCSS）
│   ├── vite-env.d.ts                          # Vite 类型定义
│   │
│   ├── router/                                # 路由系统
│   │   ├── routes.ts                          # 路由定义（path, module, requiredPermission）
│   │   ├── guards.tsx                         # AuthGuard + PermissionGuard
│   │   └── index.tsx                          # 懒加载组件导出
│   │
│   ├── shared/                                # 跨模块共享（不依赖 Tauri）
│   │   ├── components/                        # UI 组件库
│   │   │   ├── SidebarNew.tsx                 # 主导航侧边栏
│   │   │   ├── Common.tsx                     # 通用 UI 组件（LangLabel 等）
│   │   │   ├── ErrorBoundary.tsx              # 全局错误边界
│   │   │   ├── Toast.tsx                      # Toast 通知
│   │   │   ├── ToastProvider.tsx              # Toast Context Provider
│   │   │   ├── ConfirmDialog.tsx              # 确认对话框
│   │   │   └── FloatingTaskWidget.tsx         # 浮动 MQ 任务指示器
│   │   ├── hooks/
│   │   │   ├── useAuth.ts                     # JWT 认证状态（登录/注册/Token）
│   │   │   └── useToast.ts                    # Toast 通知 Hook
│   │   ├── services/
│   │   │   └── serverApi.ts                   # fd-server REST API 客户端（含 Token 刷新）
│   │   ├── types/
│   │   │   └── server.ts                      # 所有后端 API 类型定义
│   │   ├── constants/
│   │   │   └── agentMap.ts                    # Freshdesk Agent ID → 名称映射
│   │   ├── utils/
│   │   │   └── statusLabels.ts                # 工单状态标签映射
│   │   └── i18n/                              # 国际化
│   │       ├── config.ts                      # i18next 配置
│   │       ├── types.ts                       # 类型定义
│   │       └── locales/{zh-CN,en-US}/         # 语言包
│   │
│   ├── modules/                               # 按业务域划分的页面模块
│   │   ├── auth/pages/                        # 认证页面
│   │   │   ├── AuthLoginTab.tsx               # 登录
│   │   │   └── AuthRegisterTab.tsx            # 注册
│   │   ├── ticket/                            # 工单模块
│   │   │   ├── pages/
│   │   │   │   ├── ServerTicketsTab.tsx        # 工单列表
│   │   │   │   ├── TranslationTasksTab.tsx    # MQ 翻译任务
│   │   │   │   ├── ReplyTasksTab.tsx          # MQ 回复任务
│   │   │   │   ├── AuditTasksTab.tsx          # 审核任务
│   │   │   │   ├── ApprovedTasksTab.tsx       # 已批准/待推送
│   │   │   │   └── ServerTaskWorkspace.tsx    # 多标签页工作区
│   │   │   └── components/
│   │   │       ├── ServerTicketDetail.tsx      # 工单详情（AI 操作）
│   │   │       ├── ServerTicketList.tsx        # 分页工单列表
│   │   │       └── ticket-detail/
│   │   │           ├── TranslationPreviewBar.tsx
│   │   │           ├── AiReplyPanel.tsx
│   │   │           └── ReplyHistoryPanel.tsx
│   │   ├── admin/                             # 管理模块
│   │   │   ├── pages/
│   │   │   │   ├── AdminUsersTab.tsx          # 用户管理
│   │   │   │   ├── ManualSyncTab.tsx          # 同步管理
│   │   │   │   ├── KnowledgeTab.tsx           # 知识库
│   │   │   │   ├── DatabaseTab.tsx            # 数据库查询
│   │   │   │   └── ServerLogsTab.tsx          # 服务端日志
│   │   │   └── components/
│   │   │       ├── SqlQueryPanel.tsx
│   │   │       └── H2ConsolePanel.tsx
│   │   └── system/pages/                      # 系统模块
│   │       ├── SettingsTab.tsx                 # 设置（NotebookLM）
│   │       └── UserProfileTab.tsx             # 个人资料
│   │
│   ├── shared/                                # 跨模块共享（浏览器 + Tauri 通用）
│   │   ├── ai/                                # AI Provider 抽象（迁入自 tauri/）
│   │   │   ├── types.ts                       # 接口定义
│   │   │   ├── index.ts                       # 工厂函数
│   │   │   ├── parseUtils.ts                  # JSON 解析工具
│   │   │   └── providers/
│   │   │       ├── geminiTranslationProvider.ts
│   │   │       └── notebookLMReplyProvider.ts
│   │   ├── components/                        # 通用 UI 组件
│   │   ├── context/                           # 任务管理 Context（迁入自 tauri/）
│   │   │   ├── createMQTaskContext.tsx         # 工厂函数
│   │   │   ├── MQTranslationContext.tsx       # 翻译（轮询模式）
│   │   │   ├── MQReplyContext.tsx             # 回复（轮询模式）
│   │   │   └── MQAuditContext.tsx             # 审核（轮询模式）
│   │   ├── hooks/                             # 通用 Hooks（迁入自 tauri/）
│   │   ├── services/                          # REST API 客户端等
│   │   ├── types/, constants/, utils/, i18n/  # 其他共享代码
│   │
│   ├── tauri/                                 # Tauri 桥接层（仅 Tauri WebView 环境生效）
│   │   ├── bridge.ts                          # Tauri 环境检测 + 命令桥接
│   │   ├── hooks/
│   │   │   ├── useSettings.ts                 # 本地设置（Tauri 仅）
│   │   │   └── useNotebookShadow.ts           # Shadow Window 可见性
│   │   └── services/
│   │       ├── notebookShadow.ts              # NotebookLM Shadow Window 核心
│   │       ├── trackingShadow.ts              # 追踪 Shadow
│   │       └── trackingUtils.ts               # 追踪工具
│   │
│   └── test/                                  # 测试配置
│       ├── setup.ts
│       ├── tauriMock.ts
│       └── renderHelper.tsx
│
├── package.json                               # 依赖和脚本
├── vite.config.ts                             # Vite 配置（端口 5173，API 代理）
├── tsconfig.json                              # TypeScript 配置
├── tsconfig.node.json                         # Node 端 TS 配置
├── tailwind.config.js                         # TailwindCSS 配置
├── postcss.config.js                          # PostCSS 配置
└── index.html                                 # HTML 入口
```

### npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（端口 5173，代理 /api → 9988） |
| `npm run build` | TypeScript 检查 + Vite 构建（输出 dist/） |
| `npm run publish` | 构建并复制到 fd-server/static/（一键发布到服务端） |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 监听模式测试 |
| `npm run test:coverage` | 覆盖率报告 |

### 关键设计原则

- **shared/ vs tauri/**: shared/ 下的代码在浏览器和 Tauri WebView 中均可运行；tauri/ 下的代码依赖 `@tauri-apps/api`，通过 `isTauriEnv()` 条件加载
- **模块化页面**: modules/ 按业务域划分，每个模块有独立的 pages/ 和 components/
- **代码分割**: 非首屏组件使用 `React.lazy` + `Suspense` 懒加载

---

## 桌面客户端（`fd-client/`）

基于 **Tauri v2**（纯 Rust），WebView 加载 fd-web 前端。

### 目录树
```
fd-client/
├── src-tauri/                                 # Tauri/Rust 后端（已精简）
│   ├── src/
│   │   ├── lib.rs                             # Tauri 命令注册（AI + Shadow Window）
│   │   ├── main.rs                            # 应用引导
│   │   ├── ai.rs                              # Gemini CLI 翻译引擎
│   │   ├── models.rs                          # 共享数据模型
│   │   └── api.rs                             # Freshdesk HTTP 客户端（备用）
│   ├── tauri.conf.json                        # Tauri 配置
│   └── Cargo.toml                             # Rust 依赖
└── package.json                               # 仅含 @tauri-apps/cli
```

### Tauri 配置要点

- `devUrl`: `http://localhost:5173`（开发时加载 fd-web dev server）
- `frontendDist`: `../../fd-web/dist`（生产构建时加载 fd-web 打包产物）
- `beforeDevCommand`: 空（不再由 fd-client 启动前端）
- `CSP`: null（支持 Shadow Window 跨域注入）

---

## 后端应用（`fd-server/`）

基于 **Spring Boot 3.4.1**、**Java 21**、**H2 数据库**、**RabbitMQ**、**Redis** 构建。

采用**单体内模块化**架构，按业务域划分三个包：

```
fd-server/src/main/java/com/jefflower/fdserver/
├── FdServerApplication.java                   # Spring Boot 主类
│
├── auth/                                      # 认证授权模块（+用户设置）
│   ├── controller/
│   │   ├── AuthController.java                # 登录/注册/me 端点
│   │   ├── UserManageController.java          # 用户 CRUD/审批/角色
│   │   ├── RolePermissionController.java      # RBAC 角色权限管理
│   │   └── UserSettingsController.java        # 用户应用设置 CRUD
│   ├── service/
│   │   ├── AuthService.java                   # 认证核心逻辑
│   │   ├── ModuleService.java                 # 模块权限查询
│   │   ├── ModulePermissionDefinition.java    # 权限自注册接口
│   │   └── UserAppSettingsService.java        # 用户设置管理
│   ├── entity/
│   │   ├── SysUser.java                       # 用户
│   │   ├── SysRole.java                       # 角色
│   │   ├── SysPermission.java                 # 权限
│   │   ├── SysUserRole.java                   # 用户-角色关联
│   │   ├── SysRolePermission.java             # 角色-权限关联
│   │   ├── SysModule.java                     # 模块（auth/ticket/system）
│   │   └── UserAppSettings.java               # 用户应用设置
│   ├── repository/                            # 对应各实体 JpaRepository
│   ├── dto/                                   # LoginRequest/Response, RegisterRequest 等
│   ├── enums/                                 # UserRole, UserStatus
│   ├── annotation/
│   │   └── RequiresPermission.java            # 方法级权限注解
│   ├── aspect/
│   │   └── PermissionAspect.java              # AOP 权限切面
│   ├── security/
│   │   ├── JwtUtil.java                       # JWT 双 Token（access + refresh）
│   │   └── JwtAuthenticationFilter.java       # Security 过滤器
│   ├── config/
│   │   ├── SecurityConfig.java                # Spring Security 配置
│   │   ├── AuthDataInitializer.java           # 增量同步（模块/角色/权限自动注册）
│   │   └── AuthPermissionDefinition.java      # auth 模块 4 个权限定义
│   └── util/
│       ├── PasswordValidator.java
│       └── SuperPasswordVerifier.java
│
├── task/                                      # 任务调度模块（新增）
│   ├── controller/
│   │   ├── TaskClaimController.java           # 任务领取/完成/释放
│   │   └── TaskAdminController.java           # 任务管理后台
│   ├── service/
│   │   ├── TaskClaimService.java              # 任务领取核心逻辑
│   │   ├── TaskExecutionService.java          # 任务执行
│   │   ├── TaskDefinitionService.java         # 任务定义管理
│   │   └── TaskStatisticsService.java         # 统计和报表
│   ├── entity/
│   │   ├── TaskDefinition.java                # 任务定义
│   │   ├── TaskInstance.java                  # 任务实例
│   │   └── TaskExecutionLog.java              # 执行日志
│   ├── repository/                            # TaskDefinition/Instance/Log Repository
│   ├── enums/
│   │   ├── TaskStatus.java                    # PENDING, CLAIMED, COMPLETED, FAILED
│   │   └── TaskType.java                      # MANUAL, SCHEDULED, CRON
│   ├── scheduler/
│   │   ├── TaskRecoveryScheduler.java         # 超时任务回收
│   │   └── TaskCronScheduler.java             # Cron 定时调度
│   ├── dto/                                   # 任务相关 DTO
│   └── config/
│       └── TaskPermissionDefinition.java      # task 模块权限定义
│
├── ticket/                                    # 工单业务模块
│   ├── controller/
│   │   ├── TicketController.java              # 工单 CRUD、翻译/回复/审核提交
│   │   ├── SyncController.java                # Freshdesk 同步管理
│   │   ├── QueueController.java               # MQ 队列/DLQ 管理
│   │   ├── ConfigController.java              # 系统配置（自动推送、企微）
│   │   ├── KnowledgeController.java           # 知识库 CRUD
│   │   ├── DatabaseController.java            # SQL 查询
│   │   ├── WebhookController.java             # Freshdesk Webhook
│   │   └── RequestController.java             # 调试端点
│   ├── service/
│   │   ├── TicketService.java                 # 工单工作流编排
│   │   ├── MqPublisherService.java            # RabbitMQ 发布
│   │   ├── MqQueueService.java                # 队列管理
│   │   ├── DlqConsumerService.java            # 死信队列消费
│   │   ├── FreshdeskSyncService.java          # 增量同步
│   │   ├── SyncConfigService.java             # 同步配置
│   │   ├── ReplyPushService.java              # 回复推送
│   │   ├── SystemConfigService.java           # 系统配置
│   │   ├── WeChatWorkNotifyService.java       # 企微通知
│   │   ├── KnowledgeNoteService.java          # 知识库
│   │   ├── DatabaseQueryService.java          # 数据库查询
│   │   └── RequestService.java                # 请求记录
│   ├── entity/                                # Ticket, Translation, Reply, Audit, SystemConfig, KnowledgeNote, SyncLog, SyncConfig, FailedReplyPush, RequestRecord
│   ├── repository/                            # 对应各实体 JpaRepository
│   ├── dto/                                   # 工单相关 DTO
│   ├── enums/                                 # TicketStatus, AuditResult, SyncStatus, TriggerType
│   ├── scheduler/
│   │   ├── SyncScheduler.java                 # Cron 同步调度
│   │   └── ReplyPushRetryScheduler.java       # 推送重试调度
│   ├── client/
│   │   └── FreshdeskApiClient.java            # Freshdesk HTTP 客户端
│   └── config/
│       ├── RabbitMQConfig.java                # 队列、交换机、路由键
│       ├── MqInitializer.java                 # MQ 初始化
│       ├── TicketPermissionDefinition.java    # ticket 模块 6 个权限
│       └── SystemPermissionDefinition.java    # system 模块 8 个权限
│
├── common/                                    # 公共基础模块
│   ├── config/
│   │   ├── RestTemplateConfig.java            # HTTP 客户端配置
│   │   └── SpaWebConfig.java                  # SPA 路由（@ConditionalOnResource）
│   ├── dto/
│   │   └── ApiResponse.java                   # 通用响应包装
│   └── util/
│       ├── SqlValidator.java                  # SQL 安全校验
│       └── SuperPasswordVerifier.java         # 超级密码验证
│
├── src/main/resources/
│   ├── application.yml                        # 应用配置（H2、RabbitMQ、Redis、JWT）
│   └── static/                                # 前端静态资源（npm run publish 写入）
├── src/test/java/                             # 测试代码（70 个测试用例）
└── pom.xml                                    # Maven 配置（含 with-frontend Profile）
```

### 模块间依赖规则

```
common（底层） ← auth（中层） ← task ← ticket（上层）
```
- common 不依赖任何业务模块
- auth 只依赖 common
- task 只依赖 auth 和 common
- ticket 可依赖 task、auth 和 common

### Maven Profile

| Profile | 命令 | 说明 |
|---------|------|------|
| 默认 | `mvn clean package` | 仅后端，不含前端 |
| with-frontend | `mvn clean package -Pwith-frontend` | 自动执行 fd-web npm install + build，复制 dist 到 static |

---

## 关键配置文件

| 文件 | 说明 |
|------|------|
| `fd-server/src/main/resources/application.yml` | 后端配置（H2、RabbitMQ、Redis、JWT、Freshdesk） |
| `fd-web/vite.config.ts` | 前端构建配置（端口 5173、API 代理、代码分割） |
| `fd-web/tsconfig.json` | TypeScript 配置（strict、path alias `@/*`） |
| `fd-client/src-tauri/tauri.conf.json` | Tauri 配置（devUrl、frontendDist、窗口） |
| `fd-client/src-tauri/Cargo.toml` | Rust 依赖（lapin、reqwest、serde、tokio） |

## 数据模型

### RBAC 五表（auth 模块）
- **SysUser** → **SysUserRole** → **SysRole** → **SysRolePermission** → **SysPermission**
- **SysModule**: 模块实体（auth/ticket/system），一对多关联 SysPermission

### 工单业务（ticket 模块）
- **Ticket** (1→N) **TicketTranslation**
- **Ticket** (1→N) **TicketReply**
- **Ticket** (1→N) **TicketAudit**
- **SystemConfig**: 系统配置键值对
- **KnowledgeNote**: 知识库注意事项
- **SyncLog/SyncConfig**: 同步日志和配置
- **FailedReplyPush**: 推送失败重试记录

## Enums

### 后端 Enums

| Enum | 模块 | 值 |
|------|------|-----|
| TicketStatus | ticket | PENDING_TRANS, TRANSLATING, PENDING_REPLY, REPLYING, PENDING_AUDIT, AUDITING, APPROVED, COMPLETED |
| AuditResult | ticket | PASS, REJECT |
| SyncStatus | ticket | SUCCESS, FAILED, RUNNING |
| TriggerType | ticket | CRON, MANUAL |
| UserRole | auth | SUPER_ADMIN, ADMIN, USER, AUDITOR |
| UserStatus | auth | PENDING, APPROVED, REJECTED |
