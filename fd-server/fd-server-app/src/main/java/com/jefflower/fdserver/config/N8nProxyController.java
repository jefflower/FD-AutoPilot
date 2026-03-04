package com.jefflower.fdserver.config;

import com.jefflower.fdserver.ticket.service.SystemConfigService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;

/**
 * n8n 反向代理控制器。
 * <p>
 * 将 /n8n/** 路径下的所有 HTTP 请求转发到 n8n 后端服务。
 * 支持所有 HTTP 方法（GET、POST、PUT、DELETE、PATCH、OPTIONS）、
 * 请求头/响应头转发、流式响应、大文件上传。
 * <p>
 * n8n 目标地址优先从数据库 SystemConfig（key: n8n_api_url）读取，
 * 未配置时 fallback 到 application.yml 的 n8n.api-url 属性。
 */
@Slf4j
@Controller
public class N8nProxyController {

    private static final String PROXY_PREFIX = "/n8n";

    /**
     * 不转发的 hop-by-hop 请求头（由代理自身管理）
     */
    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailers", "transfer-encoding", "upgrade",
            "host" // host 头需要替换为目标地址
    );

    /**
     * 不回传的 hop-by-hop 响应头
     */
    private static final Set<String> HOP_BY_HOP_RESPONSE_HEADERS = Set.of(
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailers", "transfer-encoding"
    );

    private final SystemConfigService systemConfigService;

    @Value("${n8n.api-url:http://localhost:5678}")
    private String defaultN8nUrl;

    private final HttpClient httpClient;

    public N8nProxyController(SystemConfigService systemConfigService) {
        this.systemConfigService = systemConfigService;
        // 构建 HttpClient：不自动跟随重定向、60秒连接超时
        this.httpClient = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(60))
                .build();
    }

    /**
     * 捕获 /n8n/** 所有请求并转发到 n8n 后端。
     */
    @RequestMapping("/n8n/**")
    public void proxy(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String targetBaseUrl = resolveN8nUrl();
        String targetUrl = buildTargetUrl(request, targetBaseUrl);

        log.debug("[N8nProxy] {} {} → {}", request.getMethod(), request.getRequestURI(), targetUrl);

        try {
            // 1. 构建转发请求
            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(targetUrl))
                    .timeout(Duration.ofMinutes(5));

            // 2. 转发请求头
            copyRequestHeaders(request, reqBuilder);

            // 3. 设置请求方法和请求体
            String method = request.getMethod().toUpperCase();
            setMethodAndBody(reqBuilder, method, request);

            HttpRequest proxyRequest = reqBuilder.build();

            // 4. 发送请求，使用 InputStream 接收响应（支持流式和大文件）
            HttpResponse<InputStream> proxyResponse = httpClient.send(
                    proxyRequest, HttpResponse.BodyHandlers.ofInputStream());

            // 5. 回写响应
            writeResponse(proxyResponse, response);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("[N8nProxy] 请求被中断: {}", targetUrl);
            response.sendError(HttpServletResponse.SC_GATEWAY_TIMEOUT, "Proxy request interrupted");
        } catch (java.net.ConnectException e) {
            log.error("[N8nProxy] 无法连接到 n8n: {} ({})", targetBaseUrl, e.getMessage());
            response.sendError(HttpServletResponse.SC_BAD_GATEWAY, "Cannot connect to n8n at " + targetBaseUrl);
        } catch (Exception e) {
            log.error("[N8nProxy] 代理请求失败: {} {}", request.getMethod(), targetUrl, e);
            response.sendError(HttpServletResponse.SC_BAD_GATEWAY, "Proxy error: " + e.getMessage());
        }
    }

    /**
     * 解析 n8n 目标地址：优先数据库配置，fallback 到 application.yml。
     */
    private String resolveN8nUrl() {
        try {
            String dbUrl = systemConfigService.getN8nApiUrl();
            if (dbUrl != null && !dbUrl.isBlank()) {
                return stripTrailingSlash(dbUrl);
            }
        } catch (Exception e) {
            log.warn("[N8nProxy] 读取数据库 n8n_api_url 配置失败，使用默认值: {}", e.getMessage());
        }
        return stripTrailingSlash(defaultN8nUrl);
    }

    /**
     * 构建目标 URL：去掉 /n8n 前缀，拼接查询参数。
     */
    private String buildTargetUrl(HttpServletRequest request, String targetBaseUrl) {
        String path = request.getRequestURI();

        // 去掉 /n8n 前缀
        if (path.startsWith(PROXY_PREFIX)) {
            path = path.substring(PROXY_PREFIX.length());
        }
        // 确保路径以 / 开头
        if (!path.startsWith("/")) {
            path = "/" + path;
        }

        StringBuilder url = new StringBuilder(targetBaseUrl).append(path);

        // 拼接查询参数
        String queryString = request.getQueryString();
        if (queryString != null && !queryString.isEmpty()) {
            url.append("?").append(queryString);
        }

        return url.toString();
    }

    /**
     * 转发请求头到目标请求（排除 hop-by-hop 头）。
     */
    private void copyRequestHeaders(HttpServletRequest request, HttpRequest.Builder reqBuilder) {
        var headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            String lowerName = headerName.toLowerCase();

            // 跳过 hop-by-hop 头
            if (HOP_BY_HOP_HEADERS.contains(lowerName)) {
                continue;
            }

            var values = request.getHeaders(headerName);
            while (values.hasMoreElements()) {
                String value = values.nextElement();
                reqBuilder.header(headerName, value);
            }
        }
    }

    /**
     * 设置 HTTP 方法和请求体。
     */
    private void setMethodAndBody(HttpRequest.Builder reqBuilder, String method, HttpServletRequest request)
            throws IOException {
        switch (method) {
            case "GET":
                reqBuilder.GET();
                break;
            case "DELETE":
                // DELETE 可能有 body（某些 API 设计）
                if (request.getContentLength() > 0 || "chunked".equalsIgnoreCase(request.getHeader("Transfer-Encoding"))) {
                    reqBuilder.method("DELETE", HttpRequest.BodyPublishers.ofInputStream(toInputStreamSupplier(request)));
                } else {
                    reqBuilder.DELETE();
                }
                break;
            case "HEAD":
                reqBuilder.method("HEAD", HttpRequest.BodyPublishers.noBody());
                break;
            case "OPTIONS":
                reqBuilder.method("OPTIONS", HttpRequest.BodyPublishers.noBody());
                break;
            case "POST":
            case "PUT":
            case "PATCH":
                reqBuilder.method(method, HttpRequest.BodyPublishers.ofInputStream(toInputStreamSupplier(request)));
                break;
            default:
                // 其他方法（如 TRACE）也尝试转发
                reqBuilder.method(method, HttpRequest.BodyPublishers.ofInputStream(toInputStreamSupplier(request)));
                break;
        }
    }

    /**
     * 将 HttpServletRequest 的 InputStream 包装为 Supplier（处理 checked exception）。
     */
    private java.util.function.Supplier<InputStream> toInputStreamSupplier(HttpServletRequest request) {
        return () -> {
            try {
                return request.getInputStream();
            } catch (IOException e) {
                throw new java.io.UncheckedIOException("无法读取请求体", e);
            }
        };
    }

    /**
     * 将 n8n 的响应回写到客户端：状态码、响应头、响应体。
     * <p>
     * 对于重定向响应（3xx），会重写 Location 头，将 n8n 内部路径添加 /n8n 前缀，
     * 确保浏览器重定向到正确的代理路径而不是直接访问 n8n 内部路径。
     */
    private void writeResponse(HttpResponse<InputStream> proxyResponse, HttpServletResponse response)
            throws IOException {
        // 1. 状态码
        int statusCode = proxyResponse.statusCode();
        response.setStatus(statusCode);

        // 2. 响应头
        boolean isRedirect = (statusCode >= 300 && statusCode < 400);
        proxyResponse.headers().map().forEach((name, values) -> {
            String lowerName = name.toLowerCase();
            // 跳过 hop-by-hop 头
            if (HOP_BY_HOP_RESPONSE_HEADERS.contains(lowerName)) {
                return;
            }
            for (String value : values) {
                // 重写重定向 Location 头：添加 /n8n 前缀
                if (isRedirect && "location".equals(lowerName)) {
                    value = rewriteLocationHeader(value);
                }
                response.addHeader(name, value);
            }
        });

        // 3. 响应体（流式传输）
        try (InputStream in = proxyResponse.body();
             OutputStream out = response.getOutputStream()) {
            if (in != null) {
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                    out.flush(); // 流式刷出（SSE / EventStream 场景）
                }
            }
        }
    }

    /**
     * 重写 Location 头：将 n8n 返回的相对路径或绝对路径添加 /n8n 前缀。
     * <p>
     * 示例：
     * <ul>
     *   <li>/signin → /n8n/signin</li>
     *   <li>/setup → /n8n/setup</li>
     *   <li>http://localhost:5678/editor → /n8n/editor（转为相对路径）</li>
     *   <li>已包含 /n8n 前缀的路径 → 不重复添加</li>
     * </ul>
     */
    private String rewriteLocationHeader(String location) {
        if (location == null || location.isBlank()) {
            return location;
        }

        String targetBaseUrl = resolveN8nUrl();

        // 绝对 URL（指向 n8n 后端）→ 转为代理路径
        if (location.startsWith(targetBaseUrl)) {
            String path = location.substring(targetBaseUrl.length());
            if (!path.startsWith("/")) {
                path = "/" + path;
            }
            if (!path.startsWith(PROXY_PREFIX + "/") && !path.equals(PROXY_PREFIX)) {
                path = PROXY_PREFIX + path;
            }
            log.debug("[N8nProxy] 重写 Location: {} → {}", location, path);
            return path;
        }

        // 相对路径（以 / 开头但不以 /n8n 开头）→ 添加 /n8n 前缀
        if (location.startsWith("/") && !location.startsWith(PROXY_PREFIX + "/") && !location.equals(PROXY_PREFIX)) {
            String rewritten = PROXY_PREFIX + location;
            log.debug("[N8nProxy] 重写 Location: {} → {}", location, rewritten);
            return rewritten;
        }

        // 其他情况（外部 URL、已有前缀）→ 不修改
        return location;
    }

    private String stripTrailingSlash(String url) {
        if (url != null && url.endsWith("/")) {
            return url.substring(0, url.length() - 1);
        }
        return url;
    }
}
