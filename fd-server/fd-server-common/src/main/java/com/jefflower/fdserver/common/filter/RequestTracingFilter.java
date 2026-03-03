package com.jefflower.fdserver.common.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * MDC 请求追踪过滤器。
 *
 * <p>为每个 HTTP 请求生成唯一的 traceId 并放入 SLF4J MDC，
 * 使得整个请求链路中的日志都能携带 traceId，方便问题追踪。</p>
 *
 * <ul>
 *   <li>优先从请求头 {@code X-Request-ID} 读取（支持上游传递）</li>
 *   <li>如无请求头，自动生成 UUID 前 8 位作为 traceId</li>
 *   <li>响应头中回写 {@code X-Request-ID} 供调用方关联</li>
 *   <li>请求结束后清理 MDC，防止线程池场景下 traceId 泄漏</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTracingFilter extends OncePerRequestFilter {

    public static final String TRACE_ID_KEY = "traceId";
    public static final String REQUEST_ID_HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String traceId = request.getHeader(REQUEST_ID_HEADER);

        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        }

        MDC.put(TRACE_ID_KEY, traceId);
        response.setHeader(REQUEST_ID_HEADER, traceId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(TRACE_ID_KEY);
        }
    }
}
