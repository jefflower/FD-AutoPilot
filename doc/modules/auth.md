# auth 模块文档

## 1. 模块概述

**包路径**: `com.jefflower.fdserver.auth.*`

**核心职责**:
- JWT 双 Token（Access + Refresh）认证机制，支持 Refresh Token Rotation
- RBAC 五表权限模型（Role, Permission, Module, RolePermission, UserRole）
- 权限自注册（其他模块通过 `ModulePermissionDefinition` 接口自动注册模块和权限）
- 用户生命周期管理（注册、审批、角色分配、密码重置）
- 用户应用设置存储（跨应用的 Key-Value 配置）
- Token 黑名单管理（支持登出撤销）

**设计理念**:
- 明确的模块边界：只负责身份认证和权限管理，不涉及业务逻辑
- 扩展性优先：通过 `ModulePermissionDefinition` 接口实现权限的自注册，为后续微服务化做准备
- 安全第一：双级缓存权限、Token 黑名单、超级密码保护、CORS 白名单

---

## 2. 模块架构

### 2.1 子模块结构

```
auth/
├── controller/
│   ├── AuthController.java              # 认证端点（登录/注册/Token 刷新/登出）
│   ├── UserManageController.java        # 用户管理端点（ADMIN 操作）
│   └── RolePermissionController.java    # 角色权限端点
├── service/
│   ├── AuthService.java                 # 认证核心逻辑
│   ├── RolePermissionService.java       # 权限查询和管理
│   ├── ModuleService.java               # 模块管理（权限初始化）
│   ├── TokenService.java                # JWT Token 生命周期管理
│   ├── UserAppSettingsService.java      # 用户应用设置存储
│   └── PermissionCacheService.java      # Redis + 本地双级缓存
├── entity/
│   ├── SysUser.java
│   ├── SysRole.java
│   ├── SysPermission.java
│   ├── SysModule.java
│   ├── SysUserRole.java
│   ├── SysRolePermission.java
│   └── UserAppSettings.java
├── repository/
│   ├── SysUserRepository.java
│   ├── SysRoleRepository.java
│   ├── SysPermissionRepository.java
│   └── ...（其他 Repository）
├── dto/
│   ├── LoginRequest.java
│   ├── LoginResponse.java
│   ├── RegisterRequest.java
│   ├── RefreshTokenRequest.java
│   ├── ApproveRequest.java
│   ├── UserDTO.java
│   └── ...
├── enums/
│   ├── UserRole.java                    # SUPER_ADMIN, ADMIN, USER, AUDITOR
│   ├── UserStatus.java                  # PENDING, APPROVED, REJECTED
│   └── Logical.java                     # 权限检查逻辑 AND/OR
├── security/
│   ├── JwtUtil.java                     # JWT 编解码和验证
│   ├── JwtAuthenticationFilter.java      # 请求拦截，Token 提取和验证
│   ├── SecurityConfig.java              # Spring Security 配置
│   └── PermissionAspect.java            # @RequiresPermission AOP 拦截
├── config/
│   ├── AuthDataInitializer.java         # 权限数据初始化（@PostConstruct）
│   └── JwtProperties.java               # JWT 配置类
├── constants/
│   └── TokenConstants.java              # Token 相关常量
└── util/
    ├── PasswordValidator.java           # 密码策略校验
    ├── SuperPasswordVerifier.java       # 超级密码验证
    └── ...
```

### 2.2 依赖关系

**auth 模块依赖**:
- `com.jefflower.fdserver.common.*` — 公共工具、异常、DTO 基类
- Spring Security 5.x
- JJWT (io.jsonwebtoken)
- Spring Data JPA
- Spring Boot Starter Data Redis (可选，支持分布式 Token 黑名单)
- BCrypt (spring-security-crypto)

**谁依赖 auth 模块**:
- `com.jefflower.fdserver.ticket.*` — 注入 `RolePermissionService`, `UserAppSettingsService`，使用 `@RequiresPermission` 注解，实现 `ModulePermissionDefinition` 接口

---

## 3. REST API 参考

### 3.1 认证端点 (AuthController)

**基路径**: `/api/v1/auth`

#### POST /login
认证用户并返回 Token 对。

**请求**:
```json
{
  "username": "string(3-64)",
  "password": "string(6-64)"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "expiresIn": 3600,
    "user": {
      "id": 1,
      "username": "admin",
      "status": "APPROVED",
      "roles": ["ADMIN"],
      "createdAt": "2026-02-16T10:00:00Z"
    }
  }
}
```

**错误**:
- `401` USER_NOT_FOUND: 用户不存在
- `401` WRONG_PASSWORD: 密码错误
- `403` USER_NOT_APPROVED: 用户未被审批（状态为 PENDING/REJECTED）

**权限**: 无需认证

---

#### POST /refresh
使用 Refresh Token 刷新 Access Token（支持 Refresh Token Rotation）。

**请求**:
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "expiresIn": 3600
  }
}
```

**错误**:
- `401` INVALID_TOKEN: Token 无效或已过期
- `401` TOKEN_REVOKED: Token 已被撤销（黑名单）

**权限**: 无需认证

---

#### POST /logout
登出当前用户，撤销 Access Token。

**请求**: 空 body

**请求头**:
```
Authorization: Bearer <accessToken>
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

**错误**:
- `401` UNAUTHORIZED: 无效 Token

**权限**: 已认证用户

---

#### POST /register
用户自助注册，状态初始为 PENDING（需管理员审批）。

**请求**:
```json
{
  "username": "string(3-64)",
  "password": "string(6-64)"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "username": "newuser",
    "status": "PENDING",
    "roles": [],
    "createdAt": "2026-02-16T11:00:00Z"
  }
}
```

**错误**:
- `400` INVALID_USERNAME: 用户名长度不符（3-64 字符）
- `400` INVALID_PASSWORD: 密码策略不符（至少 6 字符，含大小写和数字）
- `409` USERNAME_ALREADY_EXISTS: 用户名已存在

**权限**: 无需认证

---

#### GET /check-admin
检查系统是否已初始化管理员账户。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "exists": true
  }
}
```

**权限**: 无需认证

---

#### POST /init-admin
初始化系统默认管理员账户（仅在系统首次启动时调用）。

**请求**:
```json
{
  "password": "string(6-64)",
  "superPassword": "string"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "username": "admin",
    "status": "APPROVED",
    "roles": ["SUPER_ADMIN"],
    "createdAt": "2026-02-16T09:00:00Z"
  }
}
```

**错误**:
- `400` ADMIN_ALREADY_EXISTS: 管理员已存在
- `400` INVALID_SUPER_PASSWORD: 超级密码错误

**权限**: 无需认证（但要求超级密码验证）

---

#### POST /super-reset-password
使用超级密码强制重置任意用户密码（用于管理员密码遗忘恢复）。

**请求**:
```json
{
  "username": "string",
  "newPassword": "string(6-64)",
  "superPassword": "string"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

**错误**:
- `400` USER_NOT_FOUND: 用户不存在
- `400` INVALID_SUPER_PASSWORD: 超级密码错误

**权限**: 无需认证（但要求超级密码验证）

---

#### GET /me/modules
获取当前用户有权访问的模块列表。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "code": "ticket",
      "name": "工单管理",
      "icon": "📋",
      "routePath": "/tickets",
      "permissions": [
        { "code": "ticket:read", "name": "查看工单" },
        { "code": "ticket:edit", "name": "编辑工单" }
      ]
    },
    {
      "code": "admin",
      "name": "系统管理",
      "icon": "⚙️",
      "routePath": "/admin",
      "permissions": [
        { "code": "user:manage", "name": "用户管理" }
      ]
    }
  ]
}
```

**权限**: 已认证用户

---

#### GET /me/permissions
获取当前用户全部权限 code 列表（用于前端权限校验）。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    "ticket:read",
    "ticket:edit",
    "user:read",
    "user:manage",
    "role:read"
  ]
}
```

**权限**: 已认证用户

---

### 3.2 用户管理端点 (UserManageController)

**基路径**: `/api/v1/auth/users`

#### GET /
查询用户列表（分页），支持按状态和用户名过滤。

**查询参数**:
- `page: int` — 页码（0 开始，默认 0）
- `size: int` — 页大小（默认 20）
- `status: enum(PENDING|APPROVED|REJECTED)` — 可选，用户状态过滤
- `username: string` — 可选，用户名搜索（模糊匹配）

**示例**: `GET /api/v1/auth/users?page=0&size=10&status=PENDING`

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "content": [
      {
        "id": 2,
        "username": "newuser",
        "status": "PENDING",
        "roles": [],
        "createdAt": "2026-02-16T11:00:00Z"
      }
    ],
    "totalElements": 1,
    "totalPages": 1,
    "currentPage": 0,
    "pageSize": 10
  }
}
```

**权限**: `user:read`

---

#### GET /pending
获取所有待审批用户列表。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 2,
      "username": "newuser",
      "status": "PENDING",
      "roles": [],
      "createdAt": "2026-02-16T11:00:00Z"
    }
  ]
}
```

**权限**: `user:read`

---

#### POST /{id}/approve
批准或拒绝用户注册申请。

**路径参数**:
- `id: long` — 用户 ID

**请求**:
```json
{
  "action": "APPROVE|REJECT",
  "remark": "string (可选)"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "username": "newuser",
    "status": "APPROVED",
    "roles": ["USER"],
    "createdAt": "2026-02-16T11:00:00Z"
  }
}
```

**错误**:
- `404` USER_NOT_FOUND: 用户不存在
- `400` INVALID_ACTION: action 值非法

**权限**: `user:manage`

---

#### PUT /{id}/role
修改用户角色。

**路径参数**:
- `id: long` — 用户 ID

**请求**:
```json
{
  "role": "ADMIN|USER|AUDITOR"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "username": "newuser",
    "status": "APPROVED",
    "roles": ["ADMIN"],
    "createdAt": "2026-02-16T11:00:00Z"
  }
}
```

**错误**:
- `404` USER_NOT_FOUND: 用户不存在
- `400` INVALID_ROLE: 角色值非法

**权限**: `user:manage`

---

#### POST /{id}/reset-password
管理员重置用户密码。

**路径参数**:
- `id: long` — 用户 ID

**请求**:
```json
{
  "password": "string(6-64)"
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

**错误**:
- `404` USER_NOT_FOUND: 用户不存在
- `400` INVALID_PASSWORD: 密码策略不符

**权限**: `user:manage`

---

### 3.3 角色权限端点 (RolePermissionController)

**基路径**: `/api/v1/auth`

#### GET /roles
获取所有系统角色。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "code": "SUPER_ADMIN",
      "name": "超级管理员",
      "description": "系统最高权限",
      "builtIn": true,
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 2,
      "code": "ADMIN",
      "name": "管理员",
      "description": "普通管理员",
      "builtIn": true,
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 3,
      "code": "AUDITOR",
      "name": "审核员",
      "description": "审核权限",
      "builtIn": true,
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 4,
      "code": "USER",
      "name": "普通用户",
      "description": "基础权限",
      "builtIn": true,
      "createdAt": "2026-02-16T09:00:00Z"
    }
  ]
}
```

**权限**: `role:read`

---

#### GET /roles/{roleId}/permissions
获取角色的权限列表。

**路径参数**:
- `roleId: long` — 角色 ID

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    "user:read",
    "user:manage",
    "role:read",
    "role:manage"
  ]
}
```

**权限**: `role:read`

---

#### PUT /roles/{roleId}/permissions
修改角色的权限集合。

**路径参数**:
- `roleId: long` — 角色 ID

**请求**:
```json
{
  "permissions": [
    "user:read",
    "user:manage",
    "ticket:read"
  ]
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    "user:read",
    "user:manage",
    "ticket:read"
  ]
}
```

**权限**: `role:manage`

---

#### GET /permissions
获取全部系统权限定义（按模块分类）。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "code": "user:read",
      "name": "查看用户",
      "module": "auth",
      "description": "查看用户列表和详情",
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 2,
      "code": "user:manage",
      "name": "用户管理",
      "module": "auth",
      "description": "创建、修改、删除用户",
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 10,
      "code": "ticket:read",
      "name": "查看工单",
      "module": "ticket",
      "description": "查看工单列表和详情",
      "createdAt": "2026-02-16T09:00:00Z"
    }
  ]
}
```

**权限**: `role:read`

---

#### GET /permissions/modules/{module}
获取特定模块的权限定义。

**路径参数**:
- `module: string` — 模块 code（如 "auth", "ticket"）

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "code": "user:read",
      "name": "查看用户",
      "module": "auth",
      "description": "查看用户列表和详情",
      "createdAt": "2026-02-16T09:00:00Z"
    },
    {
      "id": 2,
      "code": "user:manage",
      "name": "用户管理",
      "module": "auth",
      "description": "创建、修改、删除用户",
      "createdAt": "2026-02-16T09:00:00Z"
    }
  ]
}
```

**权限**: `role:read`

---

### 3.4 用户设置端点 (UserSettingsController)

**基路径**: `/api/v1/user/settings`

#### GET /{appCode}
获取当前用户在指定应用的设置。

**路径参数**:
- `appCode: string` — 应用标识（如 "fd-client", "fd-web"）

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "appCode": "fd-client",
    "settingsJson": "{\"theme\": \"dark\", \"language\": \"zh\"}",
    "createdAt": "2026-02-16T10:00:00Z",
    "updatedAt": "2026-02-16T11:00:00Z"
  }
}
```

**错误**:
- `404` SETTINGS_NOT_FOUND: 该应用的设置不存在（返回空）

**权限**: 已认证用户

---

#### PUT /{appCode}
保存或更新当前用户在指定应用的设置。

**路径参数**:
- `appCode: string` — 应用标识

**请求** (application/json):
```json
{
  "theme": "dark",
  "language": "zh",
  "fontSize": 14,
  "customConfig": {
    "key": "value"
  }
}
```

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "appCode": "fd-client",
    "settingsJson": "{\"theme\": \"dark\", \"language\": \"zh\", \"fontSize\": 14, \"customConfig\": {\"key\": \"value\"}}",
    "createdAt": "2026-02-16T10:00:00Z",
    "updatedAt": "2026-02-16T12:00:00Z"
  }
}
```

**错误**:
- `400` INVALID_JSON: 设置 JSON 格式错误

**权限**: 已认证用户

---

#### DELETE /{appCode}
删除当前用户在指定应用的设置。

**路径参数**:
- `appCode: string` — 应用标识

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

**权限**: 已认证用户

---

#### GET /
获取当前用户在所有应用的设置列表。

**响应** (200 OK):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "appCode": "fd-client",
      "settingsJson": "{\"theme\": \"dark\"}",
      "createdAt": "2026-02-16T10:00:00Z",
      "updatedAt": "2026-02-16T11:00:00Z"
    },
    {
      "appCode": "fd-web",
      "settingsJson": "{\"language\": \"en\"}",
      "createdAt": "2026-02-16T10:00:00Z",
      "updatedAt": "2026-02-16T11:00:00Z"
    }
  ]
}
```

**权限**: 已认证用户

---

## 4. 模块间开放 Service 接口

### 4.1 AuthService
**包路径**: `com.jefflower.fdserver.auth.service.AuthService`

其他模块可通过 `@Autowired` 注入使用，但通常通过 Controller 间接使用。

```java
public interface AuthService {
    // 认证
    LoginResponse login(String username, String password) throws AuthException;
    LoginResponse refreshToken(String refreshToken) throws AuthException;
    void logout(String accessToken);

    // 用户管理
    SysUser register(String username, String password) throws AuthException;
    SysUser getUserById(Long userId);
    SysUser getUserByUsername(String username);
    Page<SysUser> getAllUsers(int page, int size, UserStatus status, String username);
    List<SysUser> getPendingUsers();
    SysUser approveUser(Long userId, boolean approved) throws AuthException;
    SysUser updateUserRole(Long userId, String role) throws AuthException;
    void resetPassword(Long userId, String newPassword) throws AuthException;
}
```

### 4.2 RolePermissionService
**包路径**: `com.jefflower.fdserver.auth.service.RolePermissionService`

被 `PermissionAspect` 和其他模块权限检查使用。

```java
public interface RolePermissionService {
    // 权限查询
    Set<String> getUserPermissions(Long userId);  // 支持缓存
    boolean hasPermission(Long userId, String permissionCode);
    boolean hasPermissions(Long userId, String[] permissions, Logical logical);

    // 权限管理
    void assignPermissionsToRole(Long roleId, Set<String> permissionCodes);
    Set<String> getRolePermissions(Long roleId);
}
```

### 4.3 ModuleService
**包路径**: `com.jefflower.fdserver.auth.service.ModuleService`

用于权限初始化和模块信息查询。

```java
public interface ModuleService {
    // 模块权限查询
    List<Map<String, Object>> getUserModulesWithPermissions(Long userId);
    List<String> getUserPermissionCodes(Long userId);

    // 模块注册（由 AuthDataInitializer 调用）
    void registerModulePermissions(ModulePermissionDefinition definition);
}
```

### 4.4 UserAppSettingsService
**包路径**: `com.jefflower.fdserver.auth.service.UserAppSettingsService`

其他模块可注入使用，用于存储和获取用户应用设置。

```java
public interface UserAppSettingsService {
    // 设置查询
    Optional<String> getSettings(Long userId, String appCode);
    Optional<UserAppSettings> getSettingsEntity(Long userId, String appCode);
    List<UserAppSettings> getAllSettings(Long userId);

    // 设置管理
    String saveSettings(Long userId, String appCode, String settingsJson);
    void deleteSettings(Long userId, String appCode);

    // 便捷方法
    <T> Optional<T> getSettingsAsObject(Long userId, String appCode, Class<T> clazz);
    void saveSettingsFromObject(Long userId, String appCode, Object object);
}
```

### 4.5 PermissionCacheService
**包路径**: `com.jefflower.fdserver.auth.service.PermissionCacheService`

管理权限缓存（Redis + 本地），被 `RolePermissionService` 使用。

```java
public interface PermissionCacheService {
    Set<String> getUserPermissions(Long userId);
    void evictUserPermissions(Long userId);
    void evictByRoleId(Long roleId);  // 角色权限变更时清缓存
}
```

---

## 5. 权限检查机制

### 5.1 @RequiresPermission 注解

在 Controller 或 Service 方法上使用，通过 AOP 拦截权限检查。

**定义位置**: `com.jefflower.fdserver.auth.annotation.RequiresPermission`

```java
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {
    String[] value();                   // 权限 code 数组
    Logical logical() default AND;      // 逻辑：AND（全部满足）或 OR（满足任意一个）
}
```

**使用示例**:

```java
@RestController
@RequestMapping("/api/v1/auth/users")
public class UserManageController {

    @GetMapping
    @RequiresPermission(value = {"user:read"}, logical = Logical.AND)
    public ApiResponse<Page<SysUser>> getAllUsers(
            @RequestParam int page,
            @RequestParam int size) {
        // ...
    }

    @PostMapping("/{id}/approve")
    @RequiresPermission(value = {"user:manage"}, logical = Logical.AND)
    public ApiResponse<SysUser> approveUser(@PathVariable Long id) {
        // ...
    }
}
```

### 5.2 权限检查流程

1. **请求到达** → JwtAuthenticationFilter 提取 Token，设置 SecurityContext
2. **AOP 拦截** → PermissionAspect 拦截 @RequiresPermission 方法
3. **权限查询** → RolePermissionService.getUserPermissions(userId) 获取当前用户全部权限
4. **权限验证** → 按 logical 参数判断是否满足权限条件
5. **放行或拒绝** → 满足则继续执行方法，否则抛出 `PermissionDeniedException`

### 5.3 超级管理员自动放行

标注 `@RequiresPermission` 的方法，如果当前用户是 SUPER_ADMIN，自动放行（不做权限检查）。

---

## 6. 权限自注册机制

### 6.1 ModulePermissionDefinition 接口

其他模块（如 ticket）通过实现此接口自动注册模块和权限。

**定义位置**: `com.jefflower.fdserver.auth.interfaces.ModulePermissionDefinition`

```java
public interface ModulePermissionDefinition {
    // 模块元数据
    String getModuleCode();           // 模块唯一标识，如 "ticket", "admin"
    String getModuleName();           // 模块中文名称
    String getModuleDescription();    // 模块描述
    String getModuleIcon();           // 模块图标（emoji 或 icon name）
    String getModuleRoutePath();      // 前端路由，如 "/tickets"
    int getModuleSortOrder();         // 排序权重

    // 权限定义：Map<权限code, 权限名称>
    // 示例：{
    //   "ticket:read" -> "查看工单",
    //   "ticket:edit" -> "编辑工单",
    //   "ticket:delete" -> "删除工单"
    // }
    Map<String, String> getPermissions();

    // 默认角色分配：Map<权限code, [角色列表]>
    // 示例：{
    //   "ticket:read" -> ["USER", "AUDITOR", "ADMIN"],
    //   "ticket:edit" -> ["ADMIN"],
    //   "ticket:delete" -> ["ADMIN"]
    // }
    Map<String, List<String>> getDefaultRoleAssignments();
}
```

### 6.2 实现示例（ticket 模块）

```java
@Component
public class TicketModuleDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() {
        return "ticket";
    }

    @Override
    public String getModuleName() {
        return "工单管理";
    }

    @Override
    public String getModuleDescription() {
        return "工单处理和管理系统";
    }

    @Override
    public String getModuleIcon() {
        return "📋";
    }

    @Override
    public String getModuleRoutePath() {
        return "/tickets";
    }

    @Override
    public int getModuleSortOrder() {
        return 10;
    }

    @Override
    public Map<String, String> getPermissions() {
        return Map.ofEntries(
            Map.entry("ticket:read", "查看工单"),
            Map.entry("ticket:edit", "编辑工单"),
            Map.entry("ticket:delete", "删除工单"),
            Map.entry("ticket:audit", "工单审核"),
            Map.entry("ticket:export", "工单导出")
        );
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        return Map.ofEntries(
            Map.entry("ticket:read", List.of("USER", "AUDITOR", "ADMIN")),
            Map.entry("ticket:edit", List.of("ADMIN")),
            Map.entry("ticket:delete", List.of("ADMIN")),
            Map.entry("ticket:audit", List.of("AUDITOR", "ADMIN")),
            Map.entry("ticket:export", List.of("ADMIN"))
        );
    }
}
```

### 6.3 权限数据初始化流程

**启动时** (`AuthDataInitializer` @PostConstruct):

1. 创建 4 个基础角色: SUPER_ADMIN, ADMIN, AUDITOR, USER
2. **扫描所有 @Component 实现 ModulePermissionDefinition 的类**
3. 对每个 definition，以模块 code 为 key：
   - 如果模块不存在，创建 SysModule 记录
   - 对每个权限 code：
     - 如果权限不存在，创建 SysPermission 记录，关联此模块
     - 按 defaultRoleAssignments 分配权限给对应角色
4. 确保 SUPER_ADMIN 拥有所有权限
5. **增量迁移** 旧版本数据（若有）

---

## 7. 数据模型

### 7.1 用户表 (SysUser)

```java
@Entity
@Table(name = "sys_user", uniqueConstraints = {@UniqueConstraint(columnNames = "username")})
public class SysUser {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String username;

    @JsonIgnore  // 不暴露到 API
    @Column(nullable = false)
    private String password;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status;  // PENDING, APPROVED, REJECTED

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "sys_user_role",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<SysRole> roles;
}
```

### 7.2 角色表 (SysRole)

```java
@Entity
@Table(name = "sys_role", uniqueConstraints = {@UniqueConstraint(columnNames = "code")})
public class SysRole {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;  // SUPER_ADMIN, ADMIN, USER, AUDITOR

    @Column(nullable = false, length = 128)
    private String name;  // 中文名称

    @Column(length = 256)
    private String description;

    @Column(nullable = false)
    private Boolean builtIn;  // 是否内置，内置角色不可删除

    @CreationTimestamp
    private LocalDateTime createdAt;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
        name = "sys_role_permission",
        joinColumns = @JoinColumn(name = "role_id"),
        inverseJoinColumns = @JoinColumn(name = "permission_id")
    )
    private Set<SysPermission> permissions;
}
```

### 7.3 权限表 (SysPermission)

```java
@Entity
@Table(name = "sys_permission", uniqueConstraints = {@UniqueConstraint(columnNames = "code")})
public class SysPermission {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;  // ticket:read, user:manage

    @Column(nullable = false, length = 128)
    private String name;  // 权限中文名称

    @Column(nullable = false, length = 64)
    private String module;  // 所属模块

    @Column(length = 256)
    private String description;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
```

### 7.4 模块表 (SysModule)

```java
@Entity
@Table(name = "sys_module", uniqueConstraints = {@UniqueConstraint(columnNames = "code")})
public class SysModule {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;  // ticket, admin

    @Column(nullable = false, length = 128)
    private String name;  // 中文名称

    @Column(length = 256)
    private String description;

    @Column(length = 64)
    private String icon;  // emoji 或 icon name

    @Column(length = 128)
    private String routePath;  // 前端路由

    @Column(nullable = false)
    private Integer sortOrder;  // 排序权重

    @Column(nullable = false)
    private Boolean enabled;  // 是否启用

    @Column(nullable = false)
    private Boolean builtIn;  // 是否内置

    @CreationTimestamp
    private LocalDateTime createdAt;
}
```

### 7.5 关联表

**sys_user_role** (用户-角色多对多):
```
user_id (FK → sys_user.id)
role_id (FK → sys_role.id)
unique (user_id, role_id)
```

**sys_role_permission** (角色-权限多对多):
```
role_id (FK → sys_role.id)
permission_id (FK → sys_permission.id)
unique (role_id, permission_id)
```

### 7.6 用户应用设置表 (UserAppSettings)

```java
@Entity
@Table(name = "user_app_settings",
       uniqueConstraints = {@UniqueConstraint(columnNames = {"user_id", "app_code"})})
public class UserAppSettings {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;  // FK → sys_user.id

    @Column(nullable = false, length = 64)
    private String appCode;  // fd-client, fd-web

    @Column(nullable = false, columnDefinition = "TEXT")
    private String settingsJson;  // JSON 格式的设置内容

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
```

---

## 8. 安全机制详解

### 8.1 JWT 双 Token 机制

**Access Token** (短期):
- 有效期: 1 小时（可配置）
- 用途: 每次 API 请求验证身份
- 包含: 用户 ID, 用户名, 过期时间, 签名

**Refresh Token** (长期):
- 有效期: 7 天（可配置）
- 用途: 获取新的 Access Token
- 包含: 用户 ID, 过期时间, 签名
- **Refresh Token Rotation**: 每次刷新时颁发新的 Refresh Token，旧 Token 加入黑名单

**好处**:
1. Access Token 短期，即使泄露风险较小
2. Refresh Token 在服务端可撤销（黑名单机制）
3. 支持会话管理（强制下线用户）

### 8.2 Token 黑名单

**实现**:
- Redis (分布式) + ConcurrentHashMap (本地缓存) 双层
- 登出时将 Token 加入黑名单，黑名单时效 = Token 过期时间

**验证流程**:
1. JwtAuthenticationFilter 解析 Token
2. 检查是否在黑名单中（先查本地缓存，再查 Redis）
3. 若在黑名单，抛出 `TokenRevokedException`

### 8.3 密码安全

**密码加密**: BCrypt（自适应哈希，自动随机 Salt）

**密码策略**:
- 最小长度: 6 字符
- 建议: 包含大小写和数字
- 不存储明文
- 密码字段 `@JsonIgnore` 不暴露到 API

**密码重置途径**:
1. 用户忘记密码 → 联系管理员
2. 管理员重置 → `/api/v1/auth/users/{id}/reset-password`
3. 超级密码恢复 → `/api/v1/auth/super-reset-password`（适用于管理员密码遗忘）

### 8.4 超级密码保护

系统初始化时设置超级密码（在环境变量或配置文件中），用于：
- `/init-admin` — 初始化管理员
- `/super-reset-password` — 强制重置任意用户密码

**存储**: 环境变量 `SUPER_PASSWORD` 或配置文件 `spring.security.super-password`（建议环境变量）

### 8.5 CORS 跨域配置

**允许来源**:
- `http://localhost:*` — 开发环境本地
- `http://localhost:1420` — Tauri 客户端开发
- `tauri://localhost` — Tauri 生产
- `https://tauri.localhost` — Tauri 某些版本

**允许方法**: GET, POST, PUT, DELETE, OPTIONS

**允许请求头**: Authorization, Content-Type

**配置位置**: `SecurityConfig.corsConfigurationSource()`

### 8.6 HTTP 安全头

**生产环境** (`https`):
- `Strict-Transport-Security: max-age=31536000`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

---

## 9. 缓存策略

### 9.1 权限缓存 (PermissionCacheService)

**双级缓存**:
1. **本地缓存** (ConcurrentHashMap): 热点数据, 速度快
2. **Redis 缓存**: 分布式环境下的共享缓存

**缓存 Key**: `auth:user:permissions:{userId}`

**缓存失效触发**:
- 角色权限修改 → 清该角色所有用户缓存
- 用户角色修改 → 清该用户缓存
- 手动调用 `evictUserPermissions(userId)`

**缓存有效期**: 可配置（默认 30 分钟）

### 9.2 Token 黑名单缓存

**存储**: Redis (分布式) + ConcurrentHashMap (本地)

**Key 格式**: `auth:token:revoked:{tokenJti}`

**有效期**: 等同于 Token 过期时间

---

## 10. 数据初始化流程

### 10.1 AuthDataInitializer 启动流程

**时机**: 应用启动时（`@PostConstruct`）

**步骤**:

1. **创建基础角色** (若不存在):
   - SUPER_ADMIN (超级管理员, 权限: 全部)
   - ADMIN (管理员, 权限: 用户管理、权限管理、知识库)
   - AUDITOR (审核员, 权限: 工单审核)
   - USER (普通用户, 权限: 工单查看、回复、个人设置)

2. **扫描并注册模块权限**:
   - 使用 `ApplicationContext.getBeansOfType(ModulePermissionDefinition.class)`
   - 对每个 definition:
     - 创建 SysModule (如不存在)
     - 为每个权限创建 SysPermission
     - 按 defaultRoleAssignments 分配权限给角色

3. **权限同步**:
   - SUPER_ADMIN 角色确保拥有**全部权限**（自动添加新权限）
   - 其他角色按 defaultRoleAssignments 分配

4. **创建默认管理员** (仅首次启动，可选):
   - 用户名: `admin`
   - 密码: 从环境变量 `DEFAULT_ADMIN_PASSWORD` 或配置文件读取
   - 角色: SUPER_ADMIN
   - 状态: APPROVED

---

## 11. 扩展性指南

### 11.1 添加新模块和权限

**步骤** (以 ticket 模块为例):

1. 在 ticket 模块中创建 `TicketModuleDefinition` 类，实现 `ModulePermissionDefinition` 接口

2. 在方法中定义模块和权限:
   ```java
   @Component
   public class TicketModuleDefinition implements ModulePermissionDefinition {
       // ... 见 6.2 实现示例
   }
   ```

3. 应用启动时，`AuthDataInitializer` 自动扫描并注册

4. 在 ticket 模块的 Controller 方法上使用 `@RequiresPermission`:
   ```java
   @GetMapping
   @RequiresPermission(value = {"ticket:read"})
   public ApiResponse<List<Ticket>> listTickets() {
       // ...
   }
   ```

### 11.2 自定义权限检查

除 `@RequiresPermission` 注解外，也可在 Service 中手动检查权限:

```java
@Service
public class TicketService {
    @Autowired
    private RolePermissionService rolePermissionService;

    public Ticket editTicket(Long ticketId, TicketUpdateRequest req, Long userId) {
        // 手动权限检查
        if (!rolePermissionService.hasPermission(userId, "ticket:edit")) {
            throw new PermissionDeniedException("无权编辑工单");
        }

        // 业务逻辑
        // ...
    }
}
```

### 11.3 用户设置集成

其他模块可注入 `UserAppSettingsService` 存储用户配置:

```java
@Service
public class NotificationService {
    @Autowired
    private UserAppSettingsService settingsService;

    public void sendNotification(Long userId, String message) {
        // 获取用户通知设置
        Optional<String> settingsJson = settingsService.getSettings(userId, "notifications");

        if (settingsJson.isPresent()) {
            NotificationSettings settings = JsonUtil.parse(
                settingsJson.get(), NotificationSettings.class);

            if (settings.isEmailEnabled()) {
                // 发送邮件
            }
        }
    }
}
```

---

## 12. 依赖关系

### 12.1 auth 模块依赖的包

```
com.jefflower.fdserver.common.*      ← 基础设施
  ↓
com.jefflower.fdserver.auth.*        ← 认证授权
  ↓
com.jefflower.fdserver.ticket.*      ← 业务逻辑
```

**auth 模块直接依赖**:
- `com.jefflower.fdserver.common.*` — 异常、DTO 基类、工具
- Spring Security 5.x
- Spring Data JPA
- JJWT (io.jsonwebtoken:jjwt-api, jjwt-impl, jjwt-jackson)
- Spring Boot Starter Data Redis (可选)
- BCrypt (org.springframework.security:spring-security-crypto)

**谁依赖 auth 模块**:
- `com.jefflower.fdserver.ticket.*` — 通过 @Autowired 注入 service, 实现 ModulePermissionDefinition, 使用 @RequiresPermission 注解

### 12.2 模块间接口隔离

auth 模块向外暴露的**公开接口**:

1. **Service 接口** (可被其他模块注入):
   - `RolePermissionService` — 权限查询
   - `UserAppSettingsService` — 用户设置
   - `AuthService` (通过 Controller)

2. **注解** (可被其他模块使用):
   - `@RequiresPermission` — 权限检查

3. **接口** (可被其他模块实现):
   - `ModulePermissionDefinition` — 权限自注册

**禁止暴露的内部实现**:
- `JwtUtil`, `JwtAuthenticationFilter` — 仅内部使用
- `PermissionCacheService` — 仅被 `RolePermissionService` 使用
- Repository 类 — 仅被 Service 使用

---

## 13. 配置参数

### 13.1 JWT 配置

**配置文件** (`application.yml`):

```yaml
spring:
  security:
    jwt:
      secret: "your-secret-key-at-least-64-characters-long-for-HS512"
      access-token-expiry: 3600        # 秒, 默认 1 小时
      refresh-token-expiry: 604800     # 秒, 默认 7 天
      issuer: "fd-server"
      audience: "fd-client"

    super-password: "${SUPER_PASSWORD:super123}"  # 环境变量或配置

    cors:
      allowed-origins: "http://localhost:*,tauri://localhost,https://tauri.localhost"
      allowed-methods: "GET,POST,PUT,DELETE,OPTIONS"
      allow-credentials: true
```

### 13.2 缓存配置

```yaml
spring:
  cache:
    type: redis
    redis:
      time-to-live: 1800000  # 毫秒, 权限缓存 30 分钟

auth:
  permission-cache:
    ttl: 1800  # 秒, 权限缓存有效期
    enable-local-cache: true
```

---

## 14. Maven 多模块化建议

### 14.1 未来 artifact 坐标

```
com.jefflower:fd-server-auth:1.0.0
```

**pom.xml** (`fd-server-auth/pom.xml`):

```xml
<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.jefflower</groupId>
    <artifactId>fd-server-auth</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <name>FD Server Auth Module</name>
    <description>User authentication and authorization for FD Server</description>

    <parent>
        <groupId>com.jefflower</groupId>
        <artifactId>fd-server</artifactId>
        <version>1.0.0</version>
    </parent>

    <dependencies>
        <!-- auth 模块仅依赖 common -->
        <dependency>
            <groupId>com.jefflower</groupId>
            <artifactId>fd-server-common</artifactId>
            <version>1.0.0</version>
        </dependency>

        <!-- Spring Security -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>

        <!-- JWT -->
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-api</artifactId>
            <version>0.12.3</version>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-impl</artifactId>
            <version>0.12.3</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-jackson</artifactId>
            <version>0.12.3</version>
            <scope>runtime</scope>
        </dependency>

        <!-- Redis (可选) -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- JPA -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>

        <!-- Tests -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

### 14.2 单体 → 多模块迁移步骤

**Phase 1: 代码组织** (本步骤)
- 在现有单体内按包结构隔离 auth 模块
- 更新模块依赖声明 (pom.xml 注释)

**Phase 2: Maven 多模块** (后续)
- 父 POM: `fd-server`
- 子模块: `fd-server-common`, `fd-server-auth`, `fd-server-ticket`
- 更新 import 依赖

**Phase 3: 独立部署** (更后续)
- auth 作为独立 Spring Boot 应用运行
- 通过 REST API 或 gRPC 与其他模块通信

---

## 15. 常见问题 (FAQ)

**Q1: 如何刷新权限缓存?**
```java
@Autowired
private RolePermissionService rolePermissionService;

// 用户权限缓存更新
rolePermissionService.evictUserPermissions(userId);

// 角色权限变更时更新所有该角色用户
rolePermissionService.evictByRoleId(roleId);
```

**Q2: 如何处理 Token 过期?**

前端在 401 INVALID_TOKEN 时，使用 Refresh Token 调用 `/refresh` 获取新 Access Token，并重试原请求。

**Q3: Refresh Token Rotation 的意义?**

每次刷新时颁发新的 Refresh Token，旧的加入黑名单。这样即使 Refresh Token 被盗，攻击者也只能使用一次，然后被服务端检测到异常（收到旧 Token 的刷新请求）。

**Q4: SUPER_ADMIN 和 ADMIN 的区别?**

- SUPER_ADMIN: 自动拥有全部权限，不能删除，数量唯一
- ADMIN: 权限由管理员分配，支持自定义

**Q5: 用户首次登录需要设置密码吗?**

不需要。用户在注册时设置密码，注册后状态为 PENDING，等待管理员在 `/approve` 时批准。批准后自动分配 USER 角色，即可登录。

**Q6: 跨应用用户设置同步?**

不同应用的设置独立存储（appCode 不同），通过 `GET /user/settings` 获取该用户所有应用的设置，但修改和删除是按应用隔离的。

---

## 16. 附录：权限检查决策树

```
请求到达 JwtAuthenticationFilter
  │
  ├─ 提取 Authorization header 中的 Token
  │
  ├─ 验证 Token 签名和过期时间
  │
  ├─ 检查 Token 是否在黑名单中
  │   ├─ 在黑名单 → 401 TOKEN_REVOKED
  │   └─ 不在黑名单 → 继续
  │
  ├─ 从 Token 中解析用户 ID，设置 SecurityContext
  │
  ├─ 放行到 Controller/Service
  │
  └─ 若方法标注 @RequiresPermission → PermissionAspect 拦截
      │
      ├─ 当前用户是 SUPER_ADMIN?
      │   ├─ 是 → 自动放行
      │   └─ 否 → 继续检查
      │
      ├─ 查询用户权限集合 (RolePermissionService)
      │   └─ 使用缓存 (本地 + Redis)
      │
      ├─ 按 logical 参数判断
      │   ├─ AND: 全部权限都有?
      │   └─ OR: 至少有一个权限?
      │
      ├─ 权限检查通过?
      │   ├─ 是 → 执行方法
      │   └─ 否 → 403 PERMISSION_DENIED
```

---

**文档版本**: 1.0
**最后更新**: 2026-02-16
**维护者**: 架构团队
**相关文档**: [项目文档总览](../project-documentation.md) | [服务端架构](../server-architecture.md)
