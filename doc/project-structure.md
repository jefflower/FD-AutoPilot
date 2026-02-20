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
│   │   │   ├── AuthLoginTab.tsx               # 登录（新增 OAuth 按钮）
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
│   │   │       ├── MobilePreviewModal.tsx      # iframe 手机预览模态框
│   │   │       └── ticket-detail/
│   │   │           ├── TranslationPreviewBar.tsx
│   │   │           ├── AiReplyPanel.tsx
│   │   │           └── ReplyHistoryPanel.tsx
│   │   ├── admin/                             # 管理模块
│   │   │   ├── pages/
│   │   │   │   ├── AdminUsersTab.tsx          # 用户管理（新增部门列、来源列、头像、显示名）
│   │   │   │   ├── OrgSyncTab.tsx             # 组织架构同步管理（新增）
│   │   │   │   ├── ManualSyncTab.tsx          # 同步管理
│   │   │   │   ├── KnowledgeTab.tsx           # 知识库
│   │   │   │   ├── DatabaseTab.tsx            # 数据库查询
│   │   │   │   └── ServerLogsTab.tsx          # 服务端日志
│   │   │   └── components/
│   │   │       ├── SqlQueryPanel.tsx
│   │   │       └── H2ConsolePanel.tsx
│   │   ├── mobile/                            # 移动端模块
│   │   │   └── pages/
│   │   │       └── MobileAuditPage.tsx        # 移动审核页面（独立入口，无需登录）
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

采用 **Maven 多模块**架构（parent POM + 5 个子模块），编译顺序：common → auth → task → ticket → app。

```
fd-server/                                     # parent POM (packaging: pom)
├── pom.xml                                    # dependencyManagement + pluginManagement
│
├── fd-server-common/                          # (jar) 公共基础模块
│   └── src/main/java/.../common/
│       ├── config/
│       │   ├── RestTemplateConfig.java        # HTTP 客户端配置
│       │   └── SpaWebConfig.java              # SPA 路由（@ConditionalOnResource）
│       ├── dto/
│       │   └── ApiResponse.java               # 通用响应包装
│       ├── exception/
│       │   ├── BusinessException.java         # 业务异常
│       │   └── GlobalExceptionHandler.java    # 全局异常处理
│       └── util/
│           ├── PasswordValidator.java
│           ├── SqlValidator.java              # SQL 安全校验
│           └── SuperPasswordVerifier.java     # 超级密码验证
│
├── fd-server-auth/                            # (jar) 认证授权模块
│   ├── src/main/java/.../auth/
│   │   ├── controller/                        # AuthController, UserManageController, RolePermissionController, UserSettingsController, OrgSyncController, OAuthController
│   │   ├── service/                           # AuthService, ModuleService, TokenService, RolePermissionService, UserAppSettingsService, AuthConfigService, OrgSyncService, OAuthService 等
│   │   ├── entity/                            # SysUser, SysRole, SysPermission, SysUserRole, SysRolePermission, SysModule, UserAppSettings, SysDepartment, AuthConfig, OrgSyncLog
│   │   ├── repository/                        # 对应各实体 JpaRepository（新增 SysDepartmentRepository, AuthConfigRepository, OrgSyncLogRepository）
│   │   ├── dto/                               # LoginRequest/Response, RegisterRequest, DepartmentDTO, ExternalUserDTO, OAuthUserInfo, OAuthLoginRequest, OrgSyncResult, AuthConfigDTO 等
│   │   ├── enums/                             # UserStatus, OrgSyncStatus, OAuthPlatform
│   │   ├── security/                          # JwtUtil, JwtAuthenticationFilter, RequiresPermission, PermissionAspect
│   │   └── config/                            # SecurityConfig, AuthDataInitializer, AuthPermissionDefinition
│   └── src/test/java/.../auth/service/        # AuthServiceTest
│
├── fd-server-task/                            # (jar) 任务调度模块
│   ├── src/main/java/.../task/
│   │   ├── controller/                        # TaskController, TaskAdminController
│   │   ├── service/                           # TaskDistributionService, TaskScheduleService, TaskHandler
│   │   ├── entity/                            # TaskDefinition, TaskInstance
│   │   ├── repository/                        # TaskDefinitionRepository, TaskInstanceRepository
│   │   ├── enums/                             # TaskStatus, ExecutionMode, TriggerType
│   │   ├── scheduler/                         # TaskRecoveryScheduler, TaskCronScheduler, TaskSchedulerRegistry
│   │   ├── dto/                               # TaskCompleteRequest
│   │   └── config/                            # TaskConfig, TaskPermissionDefinition
│   └── src/test/java/                         # (暂无测试)
│
├── fd-server-ticket/                          # (jar) 工单业务模块
│   ├── src/main/java/.../ticket/
│   │   ├── controller/                        # TicketController, SyncController, QueueController, ConfigController, KnowledgeController, DatabaseController, WebhookController, RequestController, AuditTokenController
│   │   ├── service/                           # TicketService, MqPublisherService, FreshdeskSyncService, ReplyPushService 等
│   │   │   └── notify/                        # 通知策略模式子包
│   │   │       ├── NotifyStrategy.java        # 通知策略接口
│   │   │       ├── WeChatWorkNotifyStrategy.java  # 企业微信策略实现
│   │   │       ├── DingTalkNotifyStrategy.java    # 钉钉策略实现
│   │   │       └── NotifyService.java         # 策略路由层
│   │   ├── entity/                            # Ticket, TicketTranslation, TicketReply, TicketAudit, SystemConfig, AuditToken 等
│   │   ├── repository/                        # 对应各实体 JpaRepository + AuditTokenRepository
│   │   ├── dto/                               # 工单相关 DTO、MobileAuditDetailResponse、MobileAuditSubmitRequest、MobileAuditSubmitResponse、NotifyChannelConfig
│   │   ├── enums/                             # TicketStatus, AuditResult, SyncStatus, TriggerType, AuditTokenStatus
│   │   ├── scheduler/                         # SyncScheduler, ReplyPushRetryScheduler
│   │   ├── client/                            # FreshdeskApiClient
│   │   └── config/                            # RabbitMQConfig, MqInitializer, TicketPermissionDefinition, SystemPermissionDefinition, TicketTaskDefinitionInitializer
│   └── src/test/java/.../ticket/service/      # TicketServiceTest, FreshdeskSyncServiceTest
│
└── fd-server-app/                             # (jar) 启动入口
    ├── src/main/java/.../FdServerApplication.java  # @SpringBootApplication + @EnableScheduling
    └── src/main/resources/
        ├── application.yml                    # 应用配置（H2、RabbitMQ、Redis、JWT）
        ├── data.sql                           # 初始数据
        ├── logback-spring.xml                 # 日志配置
        └── static/                            # 前端静态资源（with-frontend Profile 构建）
```

### 模块间依赖规则

```
common（底层） ← auth（中层） ← task ← ticket（上层）
```
- common 不依赖任何业务模块（Maven: 无内部依赖）
- auth 只依赖 common（Maven: `fd-server-common`）
- task 只依赖 auth（Maven: `fd-server-auth`，传递获得 common）
- ticket 可依赖 task（Maven: `fd-server-task`，传递获得 auth + common）
- app 聚合 ticket（Maven: `fd-server-ticket`，传递获得所有模块）

### Maven 命令

| 操作 | 命令 |
|------|------|
| 全量构建 | `cd fd-server && mvn clean package` |
| 跳过测试 | `mvn clean package -DskipTests` |
| 运行应用 | `mvn spring-boot:run -pl fd-server-app` |
| 仅编译某模块 | `mvn compile -pl fd-server-common,fd-server-auth` |
| 模块测试 | `mvn test -pl fd-server-auth` |
| 含前端构建 | `mvn clean package -Pwith-frontend` |
| 可执行 JAR | `fd-server-app/target/fd-server-app-0.0.1-SNAPSHOT.jar` |

---

## 关键配置文件

| 文件 | 说明 |
|------|------|
| `fd-server/fd-server-app/src/main/resources/application.yml` | 后端配置（H2、RabbitMQ、Redis、JWT、Freshdesk） |
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
- **Ticket** (1→N) **AuditToken** — 一次性移动审核令牌（无状态，单令牌绑定一张工单）
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
| AuditTokenStatus | ticket | ACTIVE, USED, EXPIRED |
| SyncStatus | ticket | SUCCESS, FAILED, RUNNING |
| TriggerType | ticket | CRON, MANUAL |
| UserRole | auth | SUPER_ADMIN, ADMIN, USER, AUDITOR |
| UserStatus | auth | PENDING, APPROVED, REJECTED |
