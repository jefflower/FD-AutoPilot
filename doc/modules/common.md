# Common Module (FD-Server)

`common` 是 fd-server 的公共基础设施模块，为整个应用提供底层支撑能力。模块设计遵循**零业务依赖**原则——不涉及工单、认证等具体业务逻辑，仅提供通用工具、配置、异常处理。

## 模块定位

| 维度 | 说明 |
|------|------|
| **包路径** | `com.jefflower.fdserver.common.*` |
| **职责** | 通用基础设施、异常处理、工具库、Web 配置 |
| **业务性** | 零业务 |
| **依赖关系** | 不依赖任何其他模块（auth/task/ticket）；被所有其他模块依赖 |
| **复用范围** | 全应用 + 未来微服务体系 |

### 依赖规则

```
common  ←──  auth  ←──  task  ←──  ticket
```

- common **不能**导入 auth / task / ticket 中的任何类
- 任何其他模块都可以导入 common 中的类
- common 只依赖第三方库（Spring Boot、Lombok 等）

## 内容清单

### 8 个文件，分 4 个功能区

```
common/
├── config/                           # Web 框架配置
│   ├── RestTemplateConfig.java       # HTTP 客户端配置（Freshdesk API）
│   └── SpaWebConfig.java             # SPA 路由支持
├── dto/
│   └── ApiResponse<T>.java           # 统一 API 响应包装
├── exception/                        # 异常处理体系
│   ├── BusinessException.java        # 自定义业务异常
│   └── GlobalExceptionHandler.java   # 全局异常拦截
└── util/                             # 工具库
    ├── PasswordValidator.java        # 密码强度校验
    ├── SqlValidator.java             # SQL 注入防护 + 限流
    └── SuperPasswordVerifier.java    # 密码编码/比对
```

---

## 功能详解

### 1. Config 配置（2 个）

#### RestTemplateConfig
```java
@Configuration
public class RestTemplateConfig {
    @Bean("freshdeskRestTemplate")
    public RestTemplate freshdeskRestTemplate() { ... }
}
```

**职责**：为全应用提供配置好的 HTTP 客户端，用于调用 Freshdesk REST API。

**配置项**：
| 配置 | 默认值 | 用途 |
|------|--------|------|
| `freshdesk.api-key` | （必配） | API 密钥，用于 Basic Auth |
| `freshdesk.api.connect-timeout` | 10000ms | 连接超时 |
| `freshdesk.api.read-timeout` | 30000ms | 读取超时 |

**使用方式**：
```java
@Autowired
@Qualifier("freshdeskRestTemplate")
private RestTemplate freshdeskRestTemplate;

// 调用 Freshdesk API
HttpHeaders headers = new HttpHeaders();
headers.setBasicAuth(apiKey, "");  // password 为空
```

**被依赖**：ticket 模块（`FreshdeskService`）

---

#### SpaWebConfig
```java
@Configuration
@ConditionalOnResource(resources = "classpath:static/index.html")
public class SpaWebConfig implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) { ... }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) { ... }
}
```

**职责**：支持前端 SPA（Single Page Application）路由。当 `static/index.html` 存在时自动激活。

**功能**：
- 所有非 API 路由（除 `/api/**`, `/h2-console/**`, `/actuator/**`）转发到 `index.html`
- 允许前端路由在客户端处理
- 静态资源（JS、CSS、图片）正常加载

**使用场景**：
- **开发**：fd-server 托管 fd-web 构建产物（`static/`）
- **生产**：一体化打包，无需前后端分离部署

**激活条件**：`static/index.html` 文件存在

---

### 2. DTO 数据传输对象（1 个）

#### ApiResponse<T>
```java
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    private Boolean success;        // 请求是否成功
    private String message;         // 消息（成功/错误说明）
    private T data;                 // 响应数据
    private String error;           // 详细错误信息

    // 静态工厂方法
    public static <T> ApiResponse<T> ok(T data) { ... }
    public static <T> ApiResponse<T> ok(String message, T data) { ... }
    public static <T> ApiResponse<T> error(String error, String message) { ... }
}
```

**职责**：统一所有 API 响应格式，确保客户端接口一致。

**特性**：
- `@JsonInclude(NON_NULL)` — 响应中不包含 `null` 字段
- 泛型支持 — 任意数据类型
- 工厂方法 — 简化响应构造

**使用示例**：
```java
// 成功响应
return ResponseEntity.ok(ApiResponse.ok(user));
return ResponseEntity.ok(ApiResponse.ok("用户创建成功", user));

// 错误响应
return ResponseEntity.badRequest()
    .body(ApiResponse.error("INVALID_PASSWORD", "密码不符合要求"));
```

**响应示例**：
```json
{
    "success": true,
    "message": "查询成功",
    "data": { "id": 1, "name": "张三" }
}
```

```json
{
    "success": false,
    "error": "USER_NOT_FOUND",
    "message": "用户不存在"
}
```

**被依赖**：
- auth 模块 — 所有 Controller（登录、注册、用户管理）
- task 模块 — TaskController
- ticket 模块 — TicketController、ConfigController、KnowledgeController 等（共 8 个 Controller）

---

### 3. Exception 异常处理（2 个）

#### BusinessException
```java
public class BusinessException extends RuntimeException {
    private String errorCode;       // 错误代码（如 USER_NOT_FOUND）
    private int httpStatus;         // HTTP 状态码（默认 400）

    public BusinessException(String message) { ... }
    public BusinessException(String errorCode, String message) { ... }
    public BusinessException(String errorCode, String message, int httpStatus) { ... }
}
```

**职责**：业务异常统一入口，支持自定义错误码和 HTTP 状态码。

**使用示例**：
```java
// 用户不存在 (404)
throw new BusinessException("USER_NOT_FOUND", "用户不存在", HttpStatus.NOT_FOUND.value());

// 密码错误 (401)
throw new BusinessException("AUTH_FAILED", "用户名或密码错误", HttpStatus.UNAUTHORIZED.value());

// 权限不足 (403)
throw new BusinessException("NO_PERMISSION", "您没有权限执行此操作", HttpStatus.FORBIDDEN.value());

// 参数错误 (400)
throw new BusinessException("INVALID_INPUT", "输入参数不合法");
```

**被依赖**：auth 模块、ticket 模块（广泛用于业务校验）

---

#### GlobalExceptionHandler
```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<?> handleBusinessException(BusinessException e) { ... }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<?> handleAccessDenied() { ... }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<?> handleValidationError() { ... }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGenericException(Exception e) { ... }
}
```

**职责**：全局捕获异常，转换为统一的 `ApiResponse` 格式返回。

**处理规则**：

| 异常类型 | HTTP 状态码 | 响应格式 |
|---------|-----------|--------|
| `BusinessException` | 异常中指定（或 400） | `ApiResponse.error(errorCode, message)` |
| `AccessDeniedException` | 403 | 权限不足错误 |
| `MethodArgumentNotValidException` | 400 | 参数校验失败，列出字段错误 |
| 其他 Exception | 500 | 内部服务器错误 |

**使用示例**（无需手动调用，自动捕获）：
```
POST /api/v1/auth/login
请求体: { "username": "" }

响应 400:
{
    "success": false,
    "error": "INVALID_INPUT",
    "message": "username 不能为空"
}
```

---

### 4. Util 工具库（3 个）

#### PasswordValidator
```java
public final class PasswordValidator {
    public static ValidationResult validate(String password) { ... }
}

@Data
public class ValidationResult {
    private boolean valid;
    private String message;
}
```

**职责**：密码强度校验，在用户注册/修改密码时调用。

**验证规则**：
1. 非空
2. 至少 8 个字符
3. 至少包含 1 个字母（a-z, A-Z）
4. 至少包含 1 个数字（0-9）

**使用示例**：
```java
ValidationResult result = PasswordValidator.validate("Abc12345");
if (!result.isValid()) {
    throw new BusinessException("INVALID_PASSWORD", result.getMessage());
}
```

**被依赖**：auth 模块（`AuthService.register()`, `resetPassword()`）

---

#### SqlValidator
```java
public final class SqlValidator {
    private static final int DEFAULT_MAX_ROWS = 1000;

    public static ValidationResult validate(String rawSql) { ... }
    public static String ensureLimit(String rawSql, int maxRows) { ... }
}

@Data
public class ValidationResult {
    private boolean valid;
    private int httpStatus;
    private String message;
}
```

**职责**：防止 SQL 注入和恶意查询，用于数据库查询功能。

**验证规则**：

| 检查项 | 规则 | 处理 |
|--------|------|------|
| **前缀白名单** | 只允许 `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `WITH` | 其他 REJECT |
| **危险关键字拦截** | 禁止 `DROP`, `ALTER`, `TRUNCATE`, `DELETE`, `INSERT`, `UPDATE`, `CREATE`, `GRANT`, `REVOKE` | 检测到 REJECT |
| **敏感表保护** | 禁止直接操作 `SYS_USER` 表（除名称含 `SYS_USER` 的查询） | 检测到 REJECT |
| **多语句检测** | 禁止 `;` 分隔多个 SQL 语句 | 检测到 REJECT |
| **字符串字面量** | 引号内的内容不参与关键字检查 | 安全处理 |
| **注释去除** | 移除 `--` 和 `/* */` 注释 | 预处理 |

**限流功能**：
```java
// 自动追加 LIMIT 1000（默认）
String safeSql = SqlValidator.ensureLimit(userSql, 1000);
// 示例：SELECT * FROM tickets → SELECT * FROM tickets LIMIT 1000
```

**使用示例**：
```java
// 合法查询
ValidationResult result = SqlValidator.validate("SELECT * FROM tickets WHERE id = 1");
if (result.isValid()) {
    executeQuery(result.getMsg());  // 执行查询
}

// 非法查询（会被拒绝）
SqlValidator.validate("DROP TABLE sys_user");  // REJECT
SqlValidator.validate("DELETE FROM tickets");  // REJECT
SqlValidator.validate("INSERT INTO sys_user VALUES (...);");  // REJECT
```

**被依赖**：ticket 模块（`DatabaseQueryService` — 管理员 SQL 查询功能）

---

#### SuperPasswordVerifier
```java
public final class SuperPasswordVerifier {
    public static boolean verify(String rawInput, String configuredValue) { ... }
    public static String encode(String rawPassword) { ... }
}
```

**职责**：密码编码和比对，使用 BCrypt 哈希算法确保密码安全存储。

**功能**：
- `encode(rawPassword)` — 将明文密码加密为 BCrypt 哈希值
- `verify(rawInput, configuredValue)` — 验证输入密码是否匹配存储的哈希值

**安全设计**：
- 使用 BCrypt 慢哈希算法（防暴力破解）
- 如果检测到明文密码，日志中会发出警告

**使用示例**：
```java
// 注册用户
String encodedPassword = SuperPasswordVerifier.encode("Abc12345");
sysUser.setPassword(encodedPassword);
userRepository.save(sysUser);

// 登录验证
boolean matched = SuperPasswordVerifier.verify(inputPassword, storedHash);
if (!matched) {
    throw new BusinessException("AUTH_FAILED", "密码错误", 401);
}
```

**被依赖**：auth 模块（`AuthService` 登录/注册）、ticket 模块（用户密码重置）

---

## 对外开放能力

### 被依赖的类（其他模块可导入）

| 类 | 用途 | 被依赖模块 |
|----|----|---------|
| `com.jefflower.fdserver.common.dto.ApiResponse<T>` | API 统一响应 | auth, task, ticket（19 个 Controller） |
| `com.jefflower.fdserver.common.exception.BusinessException` | 业务异常 | auth, ticket |
| `com.jefflower.fdserver.common.util.PasswordValidator` | 密码校验 | auth |
| `com.jefflower.fdserver.common.util.SuperPasswordVerifier` | 密码编码/比对 | auth, ticket |
| `com.jefflower.fdserver.common.util.SqlValidator` | SQL 防注入 | ticket |
| `com.jefflower.fdserver.common.config.RestTemplateConfig` | HTTP 客户端（Bean） | 无直接导入，通过 @Autowired |

### 不开放的类

以下 config 类仅供框架加载，**不允许其他模块导入**：

- `SpaWebConfig` — Spring 框架自动加载
- `RestTemplateConfig` — 仅作为 Bean 工厂，其他模块通过 DI 获取 Bean，不导入类

---

## 依赖树

### 后端依赖关系图

```
            Spring Boot 3.4.1
                    │
    ┌───────────────┼───────────────┐
    │               │               │
RestTemplateConfig SpaWebConfig  Exception Handler
    │               │
    └─────────┬─────┘
              │
              ↓
         [common]  ← 无上层依赖，自洽
              ↑
    ┌─────────┼─────────┐
    │         │         │
  [auth]   [task]   [ticket]
    ├─────────┼─────────┤
    │         │         │
  Controllers Services  Entities
    │         │         │
    └─────────┴─────────┘
         使用 common
```

### Maven 依赖声明

```xml
<!-- common 模块的 pom.xml 片段 -->
<dependencies>
    <!-- Spring Boot -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <!-- JPA (for RestTemplate bean initialization) -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>

    <!-- Lombok -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>

    <!-- 测试 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>

<!-- 注意：common 不依赖 auth / task / ticket 模块 -->
```

---

## 未来微服务化建议

### Maven 多模块化

当 fd-server 演化为微服务体系时，建议：

1. **抽取 common 为独立 Maven 模块**：
   ```
   fd-server-parent/
   ├── fd-server-common/           # Maven 模块，artifactId: fd-server-common
   │   ├── src/main/java/com/jefflower/fdserver/common/
   │   └── pom.xml
   ├── fd-server-auth/             # 认证服务
   │   ├── pom.xml                 # depends on fd-server-common
   │   └── src/
   ├── fd-server-ticket/           # 工单服务
   │   ├── pom.xml                 # depends on fd-server-common, fd-server-auth
   │   └── src/
   └── pom.xml (parent)
   ```

2. **Artifact 坐标**：
   ```xml
   <groupId>com.jefflower</groupId>
   <artifactId>fd-server-common</artifactId>
   <version>${project.version}</version>
   ```

3. **发布策略**：
   - 将 `fd-server-common` 发布到私有 Maven 仓库
   - 其他服务（如 fd-server-auth、fd-server-ticket）依赖此 jar
   - 版本管理：与 parent pom 同步

4. **跨服务共享**：
   ```xml
   <!-- fd-server-auth/pom.xml -->
   <dependency>
       <groupId>com.jefflower</groupId>
       <artifactId>fd-server-common</artifactId>
       <version>${parent.version}</version>
   </dependency>
   ```

### 扩展建议

#### 新增通用工具

如果未来有新的跨模块通用需求，加入 util 目录：
- `StringEncryptionUtil` — 字段加密（如敏感数据）
- `DateFormatUtil` — 日期格式化
- `CsvExporterUtil` — CSV 导出工具
- `ApiVersioningUtil` — API 版本管理

#### 新增公共配置

按需扩展 config 目录：
- `CacheConfig` — Redis 缓存配置
- `LoggingConfig` — 日志配置
- `MetricsConfig` — 监控指标配置

#### 新增公共异常

按需扩展 exception 目录：
```java
public class TechnicalException extends RuntimeException { ... }  // 技术异常
public class ExternalServiceException extends RuntimeException { ... }  // 外部服务异常
```

---

## 总结

| 方面 | 说明 |
|------|------|
| **关键职责** | 通用异常、API 响应、工具库、Web 配置 |
| **零业务性** | 不涉及工单、认证、消息队列等业务 |
| **复用性强** | 被 auth / task / ticket 所有模块依赖 |
| **独立性高** | 不依赖任何业务模块，可独立部署为 jar |
| **未来可行** | 设计充分考虑微服务化，可直接拆分为独立服务 |

common 模块是 fd-server 的**基石**，为整个应用提供稳定、可靠的底层支撑。
