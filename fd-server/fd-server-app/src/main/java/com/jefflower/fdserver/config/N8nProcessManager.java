package com.jefflower.fdserver.config;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * fd-server 启动时自动拉起 n8n 进程，关闭时自动停止。
 * 通过 n8n.enabled=true 开启，默认关闭。
 */
@Component
@ConditionalOnProperty(name = "n8n.enabled", havingValue = "true")
public class N8nProcessManager implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(N8nProcessManager.class);

    @Value("${n8n.port:5678}")
    private int port;

    @Value("${n8n.env-file:}")
    private String envFile;

    @Value("${n8n.executable:n8n}")
    private String executable;

    private Process n8nProcess;

    @Override
    public void run(String... args) throws Exception {
        // 检查端口是否已被占用（n8n 可能已在外部运行）
        if (isPortInUse(port)) {
            log.info("[n8n] 端口 {} 已被占用，跳过启动（n8n 可能已在运行）", port);
            return;
        }

        // 构建环境变量
        Map<String, String> env = loadEnvFile();
        env.putIfAbsent("N8N_PORT", String.valueOf(port));

        // 查找 n8n 可执行文件路径
        String n8nPath = resolveExecutable();
        if (n8nPath == null) {
            log.warn("[n8n] 未找到 n8n 可执行文件，跳过启动。请先运行: npm install n8n -g");
            return;
        }

        log.info("[n8n] 启动 n8n 进程 (端口: {}, 可执行文件: {})", port, n8nPath);

        ProcessBuilder pb = new ProcessBuilder(n8nPath, "start");
        pb.environment().putAll(env);
        pb.redirectErrorStream(true);

        // 日志输出到 logs/n8n.log
        File logDir = new File("logs");
        if (!logDir.exists()) {
            logDir.mkdirs();
        }
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(new File("logs/n8n.log")));

        n8nProcess = pb.start();

        // 等待几秒确认进程存活
        Thread.sleep(3000);
        if (n8nProcess.isAlive()) {
            log.info("[n8n] n8n 启动成功 (PID: {}, 端口: {}, 访问: http://localhost:{})",
                    n8nProcess.pid(), port, port);
        } else {
            int exitCode = n8nProcess.exitValue();
            log.error("[n8n] n8n 启动失败 (退出码: {})，请检查 logs/n8n.log", exitCode);
            n8nProcess = null;
        }
    }

    @PreDestroy
    public void shutdown() {
        if (n8nProcess != null && n8nProcess.isAlive()) {
            log.info("[n8n] 正在停止 n8n 进程 (PID: {})...", n8nProcess.pid());
            n8nProcess.destroy();
            try {
                if (!n8nProcess.waitFor(10, TimeUnit.SECONDS)) {
                    log.warn("[n8n] n8n 未在 10 秒内退出，强制终止");
                    n8nProcess.destroyForcibly();
                }
            } catch (InterruptedException e) {
                n8nProcess.destroyForcibly();
                Thread.currentThread().interrupt();
            }
            log.info("[n8n] n8n 进程已停止");
        }
    }

    /**
     * 从 n8n/.env 文件加载环境变量
     */
    private Map<String, String> loadEnvFile() {
        Map<String, String> env = new HashMap<>();
        String filePath = envFile;
        if (filePath == null || filePath.isBlank()) {
            // 默认查找项目根目录下的 n8n/.env
            filePath = findProjectRoot() + "/n8n/.env";
        }

        Path path = Path.of(filePath);
        if (!Files.exists(path)) {
            log.warn("[n8n] 环境配置文件不存在: {}，使用默认配置", filePath);
            return env;
        }

        try {
            for (String line : Files.readAllLines(path)) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq > 0) {
                    env.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
                }
            }
            log.info("[n8n] 已加载环境配置: {} ({} 项)", filePath, env.size());
        } catch (Exception e) {
            log.warn("[n8n] 读取环境配置失败: {}", e.getMessage());
        }
        return env;
    }

    /**
     * 解析 n8n 可执行文件路径
     */
    private String resolveExecutable() {
        // 1. 直接尝试配置的路径
        if (isExecutable(executable)) {
            return executable;
        }

        // 2. 通过 which/command -v 查找
        try {
            Process p = new ProcessBuilder("bash", "-lc", "command -v n8n").start();
            String path = new String(p.getInputStream().readAllBytes()).trim();
            p.waitFor(5, TimeUnit.SECONDS);
            if (!path.isEmpty() && isExecutable(path)) {
                return path;
            }
        } catch (Exception ignored) {}

        // 3. 常见 npm 全局路径
        List<String> candidates = List.of(
                System.getProperty("user.home") + "/.npm-global/bin/n8n",
                "/usr/local/bin/n8n",
                "/opt/homebrew/bin/n8n"
        );
        for (String c : candidates) {
            if (isExecutable(c)) return c;
        }

        return null;
    }

    private boolean isExecutable(String path) {
        try {
            return Files.isExecutable(Path.of(path));
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isPortInUse(int port) {
        try (var socket = new java.net.Socket()) {
            socket.connect(new java.net.InetSocketAddress("localhost", port), 1000);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 查找项目根目录（向上找 pom.xml 所在的父目录）
     */
    private String findProjectRoot() {
        Path current = Path.of(System.getProperty("user.dir"));
        // 如果当前在 fd-server 下，往上一级就是项目根
        while (current != null) {
            if (Files.exists(current.resolve("n8n/.env")) ||
                Files.exists(current.resolve("n8n/.env.example"))) {
                return current.toString();
            }
            if (Files.exists(current.resolve("fd-server")) &&
                Files.exists(current.resolve("fd-web"))) {
                return current.toString();
            }
            current = current.getParent();
        }
        return System.getProperty("user.dir");
    }
}
