package com.jefflower.fdserver.ai.config;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.CallMode;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.ai.service.AgentBinding;
import com.jefflower.fdserver.ai.service.AgentBindingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Component
@Order(10)
public class AiDataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AiDataInitializer.class);
    private final AgentDefinitionRepository repository;
    private final AgentBindingRepository bindingRepository;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;
    private final DataSource dataSource;

    public AiDataInitializer(AgentDefinitionRepository repository,
            AgentBindingRepository bindingRepository,
            CapabilityDefinitionRepository capabilityDefinitionRepository,
            DataSource dataSource) {
        this.repository = repository;
        this.bindingRepository = bindingRepository;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
        this.dataSource = dataSource;
    }

    // --- Install Guide constants ---
    private static final String GEMINI_CLI_INSTALL_GUIDE = "{"
            + "\"prerequisites\":[\"Node.js 18+\"],"
            + "\"steps\":["
            + "\"1. 安装 Node.js 18 或更高版本：https://nodejs.org/\","
            + "\"2. 安装 Gemini CLI：npm install -g @anthropic-ai/gemini-cli\","
            + "\"3. 认证登录：gemini auth\","
            + "\"4. 验证安装：gemini --version\""
            + "],"
            + "\"platforms\":{"
            + "\"mac\":\"在终端 (Terminal) 中执行以上命令\","
            + "\"windows\":\"在 PowerShell 或 CMD 中执行以上命令\""
            + "}"
            + "}";

    private static final String CLAUDE_CLI_INSTALL_GUIDE = "{"
            + "\"prerequisites\":[\"Node.js 18+\"],"
            + "\"steps\":["
            + "\"1. 安装 Node.js 18 或更高版本：https://nodejs.org/\","
            + "\"2. 安装 Claude Code：npm install -g @anthropic-ai/claude-code\","
            + "\"3. 认证登录：claude auth（需要 Anthropic API Key 或 OAuth 登录）\","
            + "\"4. 验证安装：claude --version\""
            + "],"
            + "\"platforms\":{"
            + "\"mac\":\"在终端 (Terminal) 中执行以上命令\","
            + "\"windows\":\"在 PowerShell 或 CMD 中执行以上命令\""
            + "}"
            + "}";

    private static final String NOTEBOOKLM_PY_INSTALL_GUIDE = "{"
            + "\"prerequisites\":[\"Python 3.10+\",\"pip\",\"Google 账号（用于 NotebookLM 登录）\"],"
            + "\"steps\":["
            + "\"1. 安装 Python 环境\","
            + "\"   - Mac (Homebrew)：brew install python@3.12\","
            + "\"   - Mac (官方安装包)：从 https://www.python.org/downloads/macos/ 下载 .pkg 并安装\","
            + "\"   - Windows：从 https://www.python.org/downloads/windows/ 下载安装包，安装时务必勾选 'Add Python to PATH'\","
            + "\"   - 验证：python3 --version（Mac）或 python --version（Windows）\","
            + "\"   - 验证 pip：pip3 --version（Mac）或 pip --version（Windows）\","
            + "\"2. 安装 notebooklm-py\","
            + "\"   - Mac：pip3 install notebooklm-py\","
            + "\"   - Windows：pip install notebooklm-py\","
            + "\"   - 首次安装会自动下载 Playwright 浏览器引擎（约 200MB），需要网络连接\","
            + "\"3. 登录 Google 账号\","
            + "\"   - 执行：notebooklm login\","
            + "\"   - 会自动打开浏览器，使用 Google 账号完成 OAuth 登录\","
            + "\"   - 登录成功后终端会显示 'Authenticated as: xxx@gmail.com'\","
            + "\"   - 验证登录状态：notebooklm status\","
            + "\"4. 创建 Notebook（知识库）\","
            + "\"   - 执行：notebooklm create \\\"你的知识库名称\\\"（例如：notebooklm create \\\"客服知识库\\\"）\","
            + "\"   - 创建成功后会返回 notebook ID（一串 UUID），请记录下来\","
            + "\"   - 也可以使用 --json 参数获取结构化输出：notebooklm create \\\"客服知识库\\\" --json\","
            + "\"   - 添加知识源（可选）：notebooklm source add \\\"https://your-docs-url\\\" 或 notebooklm source add ./file.pdf\","
            + "\"   - 查看已有 Notebook 列表：notebooklm list\","
            + "\"5. 配置 Notebook ID 到 Agent\","
            + "\"   - 进入系统的 '我的 Agent' 页面\","
            + "\"   - 所有使用 NotebookLM 能力的 Agent（如 '故障工单回复'、'物流查询回复'、'处理完成回复' 等）都需要配置对应的 Notebook ID\","
            + "\"   - 点击 Agent 卡片上的配置/设置按钮\","
            + "\"   - 将第 4 步获取的 Notebook ID 填入 'Notebook ID' 字段并保存\","
            + "\"   - 不同 Agent 可以配置相同或不同的 Notebook ID，建议按业务场景分配不同的知识库\","
            + "\"6. 验证完整流程\","
            + "\"   - 执行：notebooklm list（应能看到已创建的 Notebook）\","
            + "\"   - 执行：notebooklm ask \\\"测试问题\\\"（验证能正常对话）\""
            + "],"
            + "\"platforms\":{"
            + "\"mac\":\"推荐使用 Homebrew 安装 Python：brew install python@3.12。如遇权限问题可用 pip3 install --user notebooklm-py\","
            + "\"windows\":\"从 python.org 下载安装包，安装时务必勾选 'Add Python to PATH'。如遇权限问题可用 pip install --user notebooklm-py\""
            + "},"
            + "\"notes\":\"1. notebooklm-py 使用 Playwright 浏览器引擎与 Google NotebookLM 交互，首次安装需下载浏览器组件（约 200MB）。"
            + "2. 登录凭据保存在 ~/.notebooklm/ 目录下，session 过期后需重新执行 notebooklm login。"
            + "3. 每个需要使用 NotebookLM 的 Agent 都需要单独配置 Notebook ID，不同 Agent 可以使用不同的 Notebook（知识库）。"
            + "4. 建议为不同业务场景创建独立的 Notebook，例如：客服知识库、物流知识库等。\""
            + "}";

    private static final String NOTEBOOKLM_RAG_INSTALL_GUIDE = "{"
            + "\"prerequisites\":[\"Python 3.10+\",\"pip\",\"Google 账号（用于 NotebookLM 登录）\"],"
            + "\"steps\":["
            + "\"1. 安装 Python 环境\","
            + "\"   - Mac (Homebrew)：brew install python@3.12\","
            + "\"   - Mac (官方安装包)：从 https://www.python.org/downloads/macos/ 下载 .pkg 并安装\","
            + "\"   - Windows：从 https://www.python.org/downloads/windows/ 下载安装包，安装时务必勾选 'Add Python to PATH'\","
            + "\"   - 验证：python3 --version（Mac）或 python --version（Windows）\","
            + "\"   - 验证 pip：pip3 --version（Mac）或 pip --version（Windows）\","
            + "\"2. 安装 CLI：pip3 install notebooklm-py（包含 notebooklm CLI 命令行工具）\","
            + "\"   - 首次安装会自动下载 Playwright 浏览器引擎（约 200MB），需要网络连接\","
            + "\"3. 登录 Google 账号\","
            + "\"   - 执行：notebooklm login\","
            + "\"   - 会自动打开浏览器，使用 Google 账号完成 OAuth 登录\","
            + "\"   - 登录成功后终端会显示 'Authenticated as: xxx@gmail.com'\","
            + "\"   - 验证登录状态：notebooklm status\","
            + "\"4. 创建 Notebook（知识库）\","
            + "\"   - 执行：notebooklm create \\\"你的知识库名称\\\"（例如：notebooklm create \\\"客服知识库\\\"）\","
            + "\"   - 创建成功后会返回 notebook ID（一串 UUID），请记录下来\","
            + "\"   - 也可以使用 --json 参数获取结构化输出：notebooklm create \\\"客服知识库\\\" --json\","
            + "\"   - 添加知识源（可选）：notebooklm source add \\\"https://your-docs-url\\\" 或 notebooklm source add ./file.pdf\","
            + "\"   - 查看已有 Notebook 列表：notebooklm list\","
            + "\"5. 配置 Notebook ID 到 Agent\","
            + "\"   - 进入系统的 '我的 Agent' 页面\","
            + "\"   - 所有使用 NotebookLM 能力的 Agent（如 '故障工单回复'、'物流查询回复'、'处理完成回复' 等）都需要配置对应的 Notebook ID\","
            + "\"   - 点击 Agent 卡片上的配置/设置按钮\","
            + "\"   - 将第 4 步获取的 Notebook ID 填入 'Notebook ID' 字段并保存\","
            + "\"   - 不同 Agent 可以配置相同或不同的 Notebook ID，建议按业务场景分配不同的知识库\","
            + "\"6. 验证完整流程\","
            + "\"   - 执行：notebooklm list（应能看到已创建的 Notebook）\","
            + "\"   - 执行：notebooklm ask \\\"测试问题\\\"（验证能正常对话）\""
            + "],"
            + "\"platforms\":{"
            + "\"mac\":\"推荐使用 Homebrew 安装 Python：brew install python@3.12。如遇权限问题可用 pip3 install --user notebooklm-py\","
            + "\"windows\":\"从 python.org 下载安装包，安装时务必勾选 'Add Python to PATH'。如遇权限问题可用 pip install --user notebooklm-py\""
            + "},"
            + "\"notes\":\"NotebookLM RAG 模式使用 notebooklm CLI 工具，将工单内容作为临时 source 添加到知识库，提问后自动清理。适用于超过 6000 字符的长内容工单。"
            + "RAG 模式每次执行会：①将工单内容写入临时文件 ②作为 source 添加到 Notebook ③等待处理完成后提问 ④自动清理临时 source。单次执行耗时约 1-3 分钟。"
            + "登录凭据保存在 ~/.notebooklm/ 目录下，session 过期后需重新执行 notebooklm login。"
            + "每个需要使用 NotebookLM 的 Agent 都需要单独配置 Notebook ID，不同 Agent 可以使用不同的 Notebook（知识库）。\""
            + "}";

    private static final String ANTIGRAVITY_TOOLS_INSTALL_GUIDE = "{"
            + "\"prerequisites\":[\"Antigravity Tools 桌面应用\",\"至少一个已登录的 Google Antigravity IDE 账号\"],"
            + "\"steps\":["
            + "\"1. 下载 Antigravity Tools：\","
            + "\"   - GitHub 仓库：github.com/lbjlaq/Antigravity-Manager\","
            + "\"   - 前往 Releases 页面下载对应平台的安装包\","
            + "\"2. Mac 安装：\","
            + "\"   - Homebrew（推荐）：brew install --cask antigravity-tools\","
            + "\"   - 手动安装：下载 .dmg 文件并拖入 Applications\","
            + "\"     Apple Silicon：Antigravity.Tools_x.x.x_aarch64.dmg\","
            + "\"     Intel：Antigravity.Tools_x.x.x_x64.dmg\","
            + "\"     通用版：Antigravity.Tools_x.x.x_universal.dmg\","
            + "\"3. Windows 安装：\","
            + "\"   - 下载 .msi 或 .exe 安装包并运行\","
            + "\"4. 启动应用并登录 Google 账号\","
            + "\"5. 确保代理服务运行在 localhost:8045（默认端口）\","
            + "\"6. 验证：curl http://127.0.0.1:8045/v1/models\""
            + "],"
            + "\"platforms\":{"
            + "\"mac\":\"应用安装到 /Applications/Antigravity Tools.app，更新：brew upgrade --cask antigravity-tools\","
            + "\"windows\":\"默认安装到 C:\\\\Users\\\\<用户名>\\\\AppData\\\\Local\\\\antigravity-tools\\\\\""
            + "},"
            + "\"config\":{"
            + "\"configDir\":\"~/.antigravity_tools/\","
            + "\"configFile\":\"~/.antigravity_tools/gui_config.json\","
            + "\"accountsFile\":\"~/.antigravity_tools/accounts.json\","
            + "\"logsDir\":\"~/.antigravity_tools/logs/\","
            + "\"defaultPort\":8045,"
            + "\"defaultApiKey\":\"在 gui_config.json 中配置 proxy.api_key\""
            + "}"
            + "}";

    // --- Input/Output Schema constants ---
    private static final String TRANSLATE_INPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"ticketContent\":{\"type\":\"string\",\"description\":\"工单原文内容 JSON（含 subject/description/conversations）\"},\"targetLang\":{\"type\":\"string\",\"description\":\"目标语言代码\"}},\"required\":[\"ticketContent\",\"targetLang\"]}";

    private static final String TRANSLATE_OUTPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"subject\":{\"type\":\"string\"},\"description\":{\"type\":\"string\"},\"conversations\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"number\"},\"bodyText\":{\"type\":\"string\"}},\"required\":[\"id\",\"bodyText\"]}}},\"required\":[\"subject\",\"description\",\"conversations\"]}";

    private static final String REPLY_INPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"ticketContent\":{\"type\":\"string\",\"description\":\"工单原文内容 JSON（含 subject/description/conversations）\"},\"lastAuditRemark\":{\"type\":\"string\",\"description\":\"审核驳回备注\"}},\"required\":[\"ticketContent\"]}";

    private static final String REPLY_OUTPUT_SCHEMA = "{\"type\":\"object\",\"properties\":{\"targetReply\":{\"type\":\"string\"},\"zhReply\":{\"type\":\"string\"}},\"required\":[\"targetReply\",\"zhReply\"]}";

    private static final String DEFAULT_TEMPLATE_ENGINE = "simple";

    @Override
    @Transactional
    public void run(String... args) {
        // 0. 清理 PostgreSQL 自动生成的过时 CHECK 约束（新增枚举值后约束不会自动更新）
        dropOutdatedCheckConstraints();

        // 1. 初始化内置 Capability（必须在 Agent 初始化之前）
        initBuiltInCapabilities();

        // 2. 初始化内置 Agent（含 requiredCapability）
        initBuiltInAgents();

        // 3. 回填旧数据的 requiredCapability
        backfillRequiredCapability();

        // 4. 清理已移除的内置 Agent
        cleanupRemovedBuiltInAgents(Set.of("ticket-translate", "ticket-reply", "n8n-workflow-designer",
                "logistics-reply", "completion-reply", "ticket-reply-long"));

        // 5. 初始化默认能力绑定
        ensureDefaultBinding("ticket-translate", "ticket-translate");
        ensureDefaultBinding("ticket-reply", "ticket-reply");
        ensureDefaultBinding("logistics-reply", "logistics-reply");
        ensureDefaultBinding("completion-reply", "completion-reply");
        ensureDefaultBinding("ticket-reply-long", "ticket-reply-long");
    }

    /**
     * 清理 Hibernate 自动生成的 enum CHECK 约束，并移除已废弃字段的 NOT NULL 约束。
     *
     * 使用独立 JDBC 连接（autoCommit=true），每条 DDL 独立事务，
     * 避免 PostgreSQL "current transaction is aborted" 问题。
     */
    private void dropOutdatedCheckConstraints() {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(true);

            String[] tables = { "ai_agent_definition", "ai_capability_definition" };
            for (String table : tables) {
                // 查询该表的所有 CHECK 约束名
                List<String> constraintNames = new ArrayList<>();
                try (Statement stmt = conn.createStatement();
                     ResultSet rs = stmt.executeQuery(
                         "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS " +
                         "WHERE UPPER(TABLE_NAME) = UPPER('" + table + "') AND CONSTRAINT_TYPE = 'CHECK'")) {
                    while (rs.next()) {
                        String name = rs.getString(1);
                        // 跳过 NOT NULL 约束（PostgreSQL 内部以 CHECK 形式存储）
                        if (name != null && name.contains("not_null")) continue;
                        constraintNames.add(name);
                    }
                } catch (Exception e) {
                    log.debug("[AiDataInitializer] Failed to query constraints for {}: {}", table, e.getMessage());
                }

                // 逐个删除 CHECK 约束
                for (String name : constraintNames) {
                    try (Statement stmt = conn.createStatement()) {
                        stmt.executeUpdate("ALTER TABLE " + table + " DROP CONSTRAINT \"" + name + "\"");
                        log.info("[AiDataInitializer] Dropped CHECK constraint: {}.{}", table, name);
                    } catch (Exception e) {
                        log.debug("[AiDataInitializer] Failed to drop constraint {}.{}: {}", table, name, e.getMessage());
                    }
                }
            }

            // 已废弃字段允许 NULL
            String[] nullableSqls = {
                    "ALTER TABLE ai_agent_definition ALTER COLUMN execution_env DROP NOT NULL",
                    "ALTER TABLE ai_agent_definition ALTER COLUMN provider_type DROP NOT NULL"
            };
            for (String sql : nullableSqls) {
                try (Statement stmt = conn.createStatement()) {
                    stmt.executeUpdate(sql);
                } catch (Exception e) {
                    log.debug("[AiDataInitializer] Nullable alter skipped: {}", e.getMessage());
                }
            }

            log.info("[AiDataInitializer] Cleaned up outdated enum check constraints");
        } catch (Exception e) {
            log.warn("[AiDataInitializer] Constraint cleanup failed (non-fatal): {}", e.getMessage());
        }
    }

    /**
     * 初始化内置 Capability Definition。
     * 使用 findByCode 做幂等检查，已存在则跳过。
     */
    private void initBuiltInCapabilities() {
        ensureBuiltInCapability("gemini-cli", "Gemini CLI", ProviderType.GEMINI_CLI,
                "{\"command\":\"gemini --version\"}", GEMINI_CLI_INSTALL_GUIDE, 0, true, null);

        ensureBuiltInCapability("claude-cli", "Claude CLI", ProviderType.CLAUDE_CLI,
                "{\"command\":\"claude --version\"}", CLAUDE_CLI_INSTALL_GUIDE, 1, true, null);

        ensureBuiltInCapability("notebooklm-py", "NotebookLM Python", ProviderType.NOTEBOOKLM_PY,
                "{\"command\":\"python -c \\\"import notebooklm\\\"\"}", NOTEBOOKLM_PY_INSTALL_GUIDE,
                2, true,
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");

        ensureBuiltInCapability("notebooklm-rag", "NotebookLM RAG", ProviderType.NOTEBOOKLM_RAG,
                "{\"command\":\"notebooklm --version\"}", NOTEBOOKLM_RAG_INSTALL_GUIDE,
                5, true,
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");

        ensureBuiltInCapability("antigravity-tools", "Antigravity Tools", ProviderType.ANTIGRAVITY_TOOLS,
                null, ANTIGRAVITY_TOOLS_INSTALL_GUIDE, 3, true,
                "{\"model\":{\"type\":\"string\",\"label\":\"Model\",\"required\":false,\"description\":\"模型名称（默认 gemini-2.5-flash）\"},\"systemPrompt\":{\"type\":\"string\",\"label\":\"System Prompt\",\"required\":false,\"description\":\"系统提示词\"},\"temperature\":{\"type\":\"number\",\"label\":\"Temperature\",\"required\":false,\"description\":\"生成温度（0-2）\"}}");

        ensureBuiltInCapability("shadow-window", "Shadow Window", ProviderType.TRACKING_SHADOW,
                null, null, 4, false,
                "{\"targetUrl\":{\"type\":\"string\",\"label\":\"Target URL\",\"required\":true,\"description\":\"目标网页 URL\"}}");
    }

    private void ensureBuiltInCapability(String code, String name, ProviderType providerType,
            String detectConfig, String installGuide,
            int sortOrder, boolean enabled, String configSchema) {
        var existing = capabilityDefinitionRepository.findByCode(code);
        if (existing.isPresent()) {
            // 生产数据保护：已存在的 Capability 不再强制更新 configSchema，仅打印差异提示
            CapabilityDefinition cap = existing.get();
            if (configSchema != null && !configSchema.equals(cap.getConfigSchema())) {
                log.warn(
                        "[AiDataInitializer] Capability '{}' configSchema differs from code definition (DB value preserved). "
                                + "Code: {}, DB: {}",
                        code, configSchema, cap.getConfigSchema());
            }
            return;
        }
        CapabilityDefinition cap = new CapabilityDefinition();
        cap.setCode(code);
        cap.setName(name);
        cap.setProviderType(providerType);
        cap.setDetectConfig(detectConfig);
        cap.setInstallGuide(installGuide);
        cap.setSortOrder(sortOrder);
        cap.setEnabled(enabled);
        cap.setBuiltIn(true);
        cap.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        cap.setConfigSchema(configSchema);
        capabilityDefinitionRepository.save(cap);
        log.info("[AiDataInitializer] Created built-in capability: {}", code);
    }

    /**
     * 初始化内置 Agent（含 requiredCapability 参数）。
     */
    private void initBuiltInAgents() {
        // === 工单处理 Agent（n8n 工作流 + Sync Bridge 使用） ===
        ensureBuiltInAgent(
                "ticket-translate",
                "工单翻译并分类",
                "通过 Gemini CLI 翻译工单内容并完成业务分类",
                null,
                null,
                "ticket-translate",
                "ticket",
                null,
                null,
                null,
                "You are a professional customer service translator and classifier.\n\n"
                        + "Task: Translate the following ticket JSON into {{targetLang}}, classify the ticket into one of 4 categories, and determine if the issue is already resolved.\n\n"
                        + "CATEGORIES:\n"
                        + "- PRODUCT_FAULT: Product quality issues, usage problems, returns/exchanges\n"
                        + "- LOGISTICS_INQUIRY: Shipping status, delivery time, tracking inquiries\n"
                        + "- BUSINESS_COOPERATION: Agency cooperation, bulk purchasing, business partnership\n"
                        + "- OTHER: Cannot be categorized into above\n\n"
                        + "RESOLVED DETECTION:\n"
                        + "- Set \"resolved\" to true ONLY when the customer explicitly confirms the issue is resolved, expresses thanks for resolution, or indicates no further help is needed\n"
                        + "- Set \"resolved\" to false for all other cases (new issues, ongoing problems, questions, etc.)\n\n"
                        + "LOGISTICS ORDER EXTRACTION (only when category is LOGISTICS_INQUIRY):\n"
                        + "- Extract the customer's order number into \"orderNumber\" field (e.g., SSN7592, ALS01442016127, #12345)\n"
                        + "- Extract the logistics tracking number into \"trackingNumber\" field (e.g., SF1234567890, YT1234567890123, 4PX tracking codes)\n"
                        + "- If multiple numbers found, use the most relevant one\n"
                        + "- If not found, set to empty string \"\"\n"
                        + "- These fields are ONLY needed when category is LOGISTICS_INQUIRY, omit them otherwise\n\n"
                        + "STRICT OUTPUT FORMAT:\n"
                        + "- Output ONLY a raw JSON object. Start with { and end with }.\n"
                        + "- Do NOT wrap in markdown code fences (```).\n"
                        + "- Do NOT add any text before or after the JSON.\n"
                        + "- Keep the JSON structure identical, only translate text values.\n"
                        + "- ADD a \"category\" field at the top level with one of: PRODUCT_FAULT, LOGISTICS_INQUIRY, BUSINESS_COOPERATION, OTHER\n"
                        + "- ADD a \"resolved\" field at the top level with true or false\n"
                        + "- When category is LOGISTICS_INQUIRY, ADD \"orderNumber\" and \"trackingNumber\" fields\n\n"
                        + "Ticket JSON:\n{{ticketContent}}",
                0,
                TRANSLATE_INPUT_SCHEMA,
                TRANSLATE_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "gemini-cli");

        ensureBuiltInAgent(
                "ticket-reply",
                "故障工单回复",
                "通过 NotebookLM Python 生成工单回复",
                null,
                null,
                "ticket-reply",
                "ticket",
                null,
                null,
                null, // notebookId 不再在全局配置中硬编码，需用户在「我的 Agent」中自行配置
                "根据下面的工单内容，使用用户工单的语言做出回复及回复的中文翻译。\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Hello, thanks for contacting us.\",\"你好，感谢联系我们。\"]\n\n"
                        + "工单内容：\n{{ticketContent}}"
                        + "{{#if lastAuditRemark}}\n\n"
                        + "【审核驳回意见】：\n{{lastAuditRemark}}\n"
                        + "请务必根据以上审核意见调整你的回复，避免重复之前的问题。"
                        + "{{/if}}",
                1,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");

        // === n8n 工作流设计师 Agent ===
        ensureBuiltInAgent(
                "n8n-workflow-designer",
                "n8n 工作流设计师",
                "通过 AI 对话设计和管理 n8n 工作流",
                null,
                null,
                "n8n-workflow-designer",
                "workflow",
                null,
                null,
                null,
                "你是一个专业的 n8n 工作流设计师。根据用户的需求设计和修改 n8n 工作流。\n\n"
                        + "## 工作区参考文档\n{{workspaceDocs}}\n\n"
                        + "## 当前工作流 JSON\n{{currentWorkflowJson}}\n\n"
                        + "## 工作流中相关 Agent 的提示词\n{{relatedAgentPrompts}}\n\n"
                        + "## 对话历史\n{{conversationHistory}}\n\n"
                        + "## 用户消息\n{{userMessage}}\n\n"
                        + "## 输出要求\n"
                        + "你的回复必须严格遵循以下结构化 JSON 格式（用 ```json 包裹），不要输出其他格式：\n\n"
                        + "```json\n"
                        + "{\n"
                        + "  \"explanation\": \"设计思路说明，解释你做了什么以及为什么\",\n"
                        + "  \"workflowJson\": { ... 完整的 n8n 工作流 JSON 对象 ... },\n"
                        + "  \"agentPromptAdjustments\": [\n"
                        + "    {\n"
                        + "      \"agentCode\": \"agent-code\",\n"
                        + "      \"agentName\": \"Agent 名称\",\n"
                        + "      \"reason\": \"为什么需要调整提示词\",\n"
                        + "      \"suggestedPrompt\": \"建议的新 systemPrompt 完整内容\"\n"
                        + "    }\n"
                        + "  ],\n"
                        + "  \"apiAdjustments\": [\n"
                        + "    {\n"
                        + "      \"endpoint\": \"/api/v1/xxx\",\n"
                        + "      \"method\": \"POST/GET/PUT/DELETE\",\n"
                        + "      \"description\": \"需要新增或修改的 API 说明\",\n"
                        + "      \"suggestedChanges\": \"具体的调整建议\"\n"
                        + "    }\n"
                        + "  ]\n"
                        + "}\n"
                        + "```\n\n"
                        + "### 字段说明\n"
                        + "- **explanation**: 必填。用自然语言说明设计思路、修改内容、每个节点的作用\n"
                        + "- **workflowJson**: 必填。完整的 n8n 工作流 JSON 对象（不是字符串！）\n"
                        + "- **agentPromptAdjustments**: 如果工作流变更需要配套调整 Agent 提示词则填写，否则为空数组\n"
                        + "- **apiAdjustments**: 如果工作流设计需要新增或修改后端 API 则填写，否则为空数组\n\n"
                        + "### 注意事项\n"
                        + "1. workflowJson 必须是合法的 n8n 工作流 JSON 对象，包含 nodes、connections、settings\n"
                        + "2. 参考\"工作流中相关 Agent 的提示词\"了解现有 Agent 的工作方式\n"
                        + "3. 如果修改了工作流中调用 Agent 的方式，务必在 agentPromptAdjustments 中给出配套的提示词调整\n"
                        + "4. 如果工作流需要调用目前不存在的 API，在 apiAdjustments 中说明",
                10,
                null,
                null,
                DEFAULT_TEMPLATE_ENGINE,
                "claude-cli");

        // === 物流查询回复 Agent ===
        ensureBuiltInAgent(
                "logistics-reply",
                "物流查询回复",
                "针对物流查询类工单生成专业回复",
                null, null,
                "logistics-reply",
                "ticket",
                null, null,
                null, // agentConfig（notebookId 需要后续在管理后台配置）
                "根据下面的物流查询工单内容，使用用户工单的语言做出回复及回复的中文翻译。\n\n"
                        + "回复要点：\n"
                        + "- 确认收到物流查询请求\n"
                        + "- 提供可能的物流进度说明\n"
                        + "- 告知预计处理时间\n"
                        + "- 语气专业友好\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Hello, thanks for contacting us.\",\"你好，感谢联系我们。\"]\n\n"
                        + "工单内容：\n{{ticketContent}}"
                        + "{{#if lastAuditRemark}}\n\n"
                        + "【审核驳回意见】：\n{{lastAuditRemark}}\n"
                        + "请务必根据以上审核意见调整你的回复，避免重复之前的问题。"
                        + "{{/if}}",
                2,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");

        // === 处理完成回复 Agent ===
        ensureBuiltInAgent(
                "completion-reply",
                "处理完成回复",
                "针对已解决/客户致谢类工单生成确认回复",
                null, null,
                "completion-reply",
                "ticket",
                null, null,
                null, // agentConfig（notebookId 需要后续在管理后台配置）
                "根据下面的工单内容，客户已确认问题解决或表示感谢。使用用户工单的语言做出礼貌的确认回复及中文翻译。\n\n"
                        + "回复要点：\n"
                        + "- 感谢客户的反馈\n"
                        + "- 确认问题已圆满解决\n"
                        + "- 欢迎后续联系\n"
                        + "- 语气温暖亲切\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Thank you for your feedback!\",\"感谢您的反馈！\"]\n\n"
                        + "工单内容：\n{{ticketContent}}",
                3,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-py");

        // === 长内容工单回复 Agent（RAG 模式） ===
        // systemPrompt 与 ticket-reply 一致，包含 {{ticketContent}}
        // resolvedPrompt（含完整内容）会被 Executor 整体作为 source 上传到 NotebookLM
        ensureBuiltInAgent(
                "ticket-reply-long",
                "长内容工单回复",
                "通过 NotebookLM RAG 模式生成长工单回复（适用于内容超过 6000 字符的工单）",
                null, null,
                "ticket-reply-long",
                "ticket",
                null, null, null,
                "根据下面的工单内容，使用用户工单的语言做出回复及回复的中文翻译。\n\n"
                        + "严格输出要求：\n"
                        + "- 直接输出纯 JSON 数组，第一个元素为原文回复，第二个元素为中文翻译\n"
                        + "- 回复内容要精简专业\n"
                        + "- 禁止使用 markdown 代码块（```）包裹\n"
                        + "- 禁止在 JSON 前后添加任何文字说明\n"
                        + "- 输出必须以 [ 开头，以 ] 结尾\n\n"
                        + "正确示例：[\"Hello, thanks for contacting us.\",\"你好，感谢联系我们。\"]\n\n"
                        + "工单内容：\n{{ticketContent}}"
                        + "{{#if lastAuditRemark}}\n\n"
                        + "【审核驳回意见】：\n{{lastAuditRemark}}\n"
                        + "请务必根据以上审核意见调整你的回复，避免重复之前的问题。"
                        + "{{/if}}",
                4,
                REPLY_INPUT_SCHEMA,
                REPLY_OUTPUT_SCHEMA,
                DEFAULT_TEMPLATE_ENGINE,
                "notebooklm-rag");

        // 给需要用户配置 notebookId 的 Agent 设置 userConfigSchema
        setUserConfigSchema("ticket-reply",
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");
        setUserConfigSchema("logistics-reply",
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");
        setUserConfigSchema("completion-reply",
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");
        setUserConfigSchema("ticket-reply-long",
                "{\"notebookId\":{\"type\":\"string\",\"label\":\"Notebook ID\",\"required\":true,\"description\":\"NotebookLM 知识库 ID\"}}");
    }

    /**
     * 回填旧数据的 requiredCapability。
     * 遍历所有 AgentDefinition，对 requiredCapability == null 的记录按 providerType 映射回填。
     */
    @SuppressWarnings("deprecation")
    private void backfillRequiredCapability() {
        List<AgentDefinition> allAgents = repository.findAll();
        for (AgentDefinition agent : allAgents) {
            if (agent.getRequiredCapability() != null) {
                continue;
            }
            String mappedCapability = mapProviderTypeToCapability(agent.getProviderType());
            if (mappedCapability != null) {
                agent.setRequiredCapability(mappedCapability);
                repository.save(agent);
                log.info("[AiDataInitializer] Backfilled requiredCapability for agent '{}': {}",
                        agent.getCode(), mappedCapability);
            }
        }
    }

    /**
     * 按 providerType 映射到 Capability code。
     * HTTP_API 和 LOCAL_FUNCTION 不回填。
     */
    @SuppressWarnings("deprecation")
    private String mapProviderTypeToCapability(ProviderType providerType) {
        if (providerType == null)
            return null;
        return switch (providerType) {
            case GEMINI_CLI -> "gemini-cli";
            case CLAUDE_CLI -> "claude-cli";
            case NOTEBOOKLM, NOTEBOOKLM_PY -> "notebooklm-py";
            case NOTEBOOKLM_RAG -> "notebooklm-rag";
            case TRACKING_SHADOW -> "shadow-window";
            case ANTIGRAVITY_TOOLS -> "antigravity-tools";
            default -> null; // HTTP_API, LOCAL_FUNCTION, deprecated types
        };
    }

    /**
     * 清理已移除的内置 Agent。仅删除 builtIn=true 且 code 不在当前定义集合中的记录。
     * 同时清理指向已删除 Agent 的能力绑定。
     */
    private void cleanupRemovedBuiltInAgents(Set<String> currentBuiltInCodes) {
        List<AgentDefinition> builtInAgents = repository.findByBuiltInTrue();
        for (AgentDefinition agent : builtInAgents) {
            if (!currentBuiltInCodes.contains(agent.getCode())) {
                // 清理指向该 Agent 的绑定
                bindingRepository.findByCapability(agent.getCapability()).ifPresent(binding -> {
                    if (agent.getCode().equals(binding.getAgentCode())) {
                        bindingRepository.delete(binding);
                        log.info("[AiDataInitializer] Removed stale binding: {} -> {}", binding.getCapability(),
                                binding.getAgentCode());
                    }
                });
                repository.delete(agent);
                log.info("[AiDataInitializer] Removed obsolete built-in agent: {}", agent.getCode());
            }
        }
    }

    /**
     * 设置 Agent 的 userConfigSchema（仅当当前值为空时写入，不覆盖已有配置）。
     */
    private void setUserConfigSchema(String agentCode, String schema) {
        repository.findByCode(agentCode).ifPresent(def -> {
            if (def.getUserConfigSchema() == null || def.getUserConfigSchema().isBlank()) {
                def.setUserConfigSchema(schema);
                repository.save(def);
                log.info("[AiDataInit] 设置 {} 的 userConfigSchema", agentCode);
            }
        });
    }

    /**
     * 确保默认能力绑定存在。仅当该 capability 尚未配置绑定时才创建。
     */
    private void ensureDefaultBinding(String capability, String agentCode) {
        if (bindingRepository.findByCapability(capability).isPresent()) {
            return; // 已有绑定，不覆盖
        }
        // 确认目标 Agent 存在
        if (repository.findByCode(agentCode).isEmpty()) {
            log.warn("[AiDataInitializer] Cannot create default binding: agent '{}' not found", agentCode);
            return;
        }
        AgentBinding binding = new AgentBinding();
        binding.setCapability(capability);
        binding.setAgentCode(agentCode);
        bindingRepository.save(binding);
        log.info("[AiDataInitializer] Created default binding: {} -> {}", capability, agentCode);
    }

    @SuppressWarnings("deprecation")
    private void ensureBuiltInAgent(String code, String name, String description,
            ProviderType providerType, ExecutionEnv executionEnv,
            String capability, String groupCode,
            CallMode callMode, String callUrl,
            String agentConfig, String systemPrompt, int sortOrder,
            String inputSchema, String outputSchema,
            String templateEngine, String requiredCapability) {
        var existing = repository.findByCode(code);
        if (existing.isPresent()) {
            // 重启自动同步：systemPrompt / inputSchema / outputSchema 以代码为准，自动覆盖
            // agentConfig 由用户在管理后台配置（如 notebookId），不覆盖
            AgentDefinition def = existing.get();
            boolean updated = false;

            // systemPrompt 自动同步
            if (systemPrompt != null && !systemPrompt.equals(def.getSystemPrompt())) {
                log.info("[AiDataInitializer] Agent '{}' systemPrompt updated from code definition", code);
                def.setSystemPrompt(systemPrompt);
                updated = true;
            }
            // inputSchema 自动同步
            if (inputSchema != null && !inputSchema.equals(def.getInputSchema())) {
                log.info("[AiDataInitializer] Agent '{}' inputSchema updated from code definition", code);
                def.setInputSchema(inputSchema);
                updated = true;
            }
            // outputSchema 自动同步
            if (outputSchema != null && !outputSchema.equals(def.getOutputSchema())) {
                log.info("[AiDataInitializer] Agent '{}' outputSchema updated from code definition", code);
                def.setOutputSchema(outputSchema);
                updated = true;
            }
            // agentConfig 差异检测（不覆盖，由用户管理）
            if (agentConfig == null ? def.getAgentConfig() != null : !agentConfig.equals(def.getAgentConfig())) {
                log.debug(
                        "[AiDataInitializer] Agent '{}' agentConfig differs from code definition (DB value preserved). "
                                + "Code: {}, DB: {}",
                        code, agentConfig, def.getAgentConfig());
            }

            // 回填 groupCode（仅旧值为 null 时）
            if (def.getGroupCode() == null && groupCode != null) {
                def.setGroupCode(groupCode);
                updated = true;
            }

            // 清空已废弃的 callMode、callUrl、templateEngine、executionEnv、providerType
            if (def.getCallMode() != null) {
                def.setCallMode(null);
                updated = true;
            }
            if (def.getCallUrl() != null) {
                def.setCallUrl(null);
                updated = true;
            }
            if (def.getTemplateEngine() != null) {
                def.setTemplateEngine(null);
                updated = true;
            }
            // executionEnv 已由 CapabilityDefinition 定义，Agent 层不再使用
            if (def.getExecutionEnv() != null) {
                def.setExecutionEnv(null);
                updated = true;
                log.info("[AiDataInitializer] Cleared deprecated executionEnv for agent: {}", code);
            }
            // providerType 可从 requiredCapability → CapabilityDefinition.providerType 推导
            if (def.getProviderType() != null) {
                def.setProviderType(null);
                updated = true;
                log.info("[AiDataInitializer] Cleared deprecated providerType for agent: {}", code);
            }

            // Backfill requiredCapability
            if (def.getRequiredCapability() == null && requiredCapability != null) {
                def.setRequiredCapability(requiredCapability);
                updated = true;
                log.info("[AiDataInitializer] Backfilled requiredCapability for agent '{}': {}", code,
                        requiredCapability);
            }

            if (updated) {
                repository.save(def);
                log.info("[AiDataInitializer] Backfilled fields for agent: {}", code);
            }
            return;
        }

        AgentDefinition def = new AgentDefinition();
        def.setCode(code);
        def.setName(name);
        def.setDescription(description);
        // providerType 和 executionEnv 不再在 Agent 层设置（由 CapabilityDefinition 定义）
        def.setCapability(capability);
        def.setGroupCode(groupCode);
        def.setCallMode(callMode);
        def.setCallUrl(callUrl);
        def.setAgentConfig(agentConfig);
        def.setSystemPrompt(systemPrompt);
        def.setInputSchema(inputSchema);
        def.setOutputSchema(outputSchema);
        def.setTemplateEngine(templateEngine);
        def.setRequiredCapability(requiredCapability);
        def.setEnabled(true);
        def.setBuiltIn(true);
        def.setSortOrder(sortOrder);

        repository.save(def);
        log.info("[AiDataInitializer] Created built-in agent: {}", code);
    }
}
