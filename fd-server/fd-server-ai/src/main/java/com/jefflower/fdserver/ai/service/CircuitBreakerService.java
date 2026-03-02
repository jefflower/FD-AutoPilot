package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capability 级断路器服务。
 * <p>
 * 当某个 capability 连续执行失败超过阈值时，断路器切换到 OPEN 状态，
 * 后续请求直接拒绝，避免无效的等待和资源消耗。
 * 恢复期到后进入 HALF_OPEN 状态，允许一个探测请求通过，
 * 成功则恢复为 CLOSED，失败则切回 OPEN。
 */
@Slf4j
@Service
public class CircuitBreakerService {

    /** 断路器状态枚举 */
    public enum CircuitState { CLOSED, OPEN, HALF_OPEN }

    /** 断路器内部状态：含状态枚举 + 进入 OPEN 的时间戳 */
    private static class CircuitBreakerState {
        volatile CircuitState state;
        volatile Instant openedAt;

        CircuitBreakerState() {
            this.state = CircuitState.CLOSED;
            this.openedAt = null;
        }
    }

    /** 断路器：连续失败 N 次后断开，默认 3 次 */
    @Value("${sync.bridge.circuit-breaker.failure-threshold:3}")
    private int failureThreshold;

    /** 断路器：断开后恢复探测间隔，默认 60 秒 */
    @Value("${sync.bridge.circuit-breaker.recovery-ms:60000}")
    private long recoveryMs;

    /** 每个 capability 的连续失败计数 */
    private final ConcurrentHashMap<String, AtomicInteger> failureCounters = new ConcurrentHashMap<>();

    /** 每个 capability 的断路器状态 */
    private final ConcurrentHashMap<String, CircuitBreakerState> circuitStates = new ConcurrentHashMap<>();

    /**
     * 检查断路器状态，OPEN 状态下阻止请求通过。
     *
     * @param capability capability 编码
     * @throws BusinessException 如果断路器处于 OPEN 或 HALF_OPEN 探测中状态
     */
    public void checkCircuitBreaker(String capability) {
        CircuitBreakerState cbState = circuitStates.get(capability);
        if (cbState == null) {
            return; // 无状态记录，视为 CLOSED
        }

        synchronized (cbState) {
            switch (cbState.state) {
                case CLOSED:
                    // 正常放行
                    break;
                case OPEN:
                    if (cbState.openedAt != null
                            && Instant.now().toEpochMilli() - cbState.openedAt.toEpochMilli() >= recoveryMs) {
                        // 恢复时间已到，切换到 HALF_OPEN，允许一个探测请求
                        cbState.state = CircuitState.HALF_OPEN;
                        log.info("[CircuitBreaker] capability={} 从 OPEN 切换到 HALF_OPEN，允许探测请求", capability);
                    } else {
                        // 恢复时间未到，直接拒绝
                        log.warn("[CircuitBreaker] capability={} 断路器 OPEN，拒绝请求", capability);
                        throw new BusinessException(ErrorCode.CAPABILITY_CIRCUIT_OPEN,
                                "Capability " + capability + " is circuit-broken, try again later");
                    }
                    break;
                case HALF_OPEN:
                    // HALF_OPEN 状态下已有一个探测请求正在执行，后续请求仍拒绝
                    log.warn("[CircuitBreaker] capability={} 断路器 HALF_OPEN，探测中，拒绝后续请求", capability);
                    throw new BusinessException(ErrorCode.CAPABILITY_CIRCUIT_OPEN,
                            "Capability " + capability + " is circuit-broken (half-open probe in progress), try again later");
            }
        }
    }

    /**
     * 路由执行成功时重置断路器。
     *
     * @param capability capability 编码（可为 null，null 时静默忽略）
     */
    public void recordSuccess(String capability) {
        if (capability == null) return;

        CircuitBreakerState cbState = circuitStates.get(capability);
        if (cbState != null) {
            synchronized (cbState) {
                if (cbState.state == CircuitState.HALF_OPEN) {
                    log.info("[CircuitBreaker] capability={} HALF_OPEN 探测成功，切换到 CLOSED", capability);
                }
                cbState.state = CircuitState.CLOSED;
                cbState.openedAt = null;
                // 重置失败计数（必须在 synchronized 块内，确保状态+计数原子性）
                AtomicInteger counter = failureCounters.get(capability);
                if (counter != null) {
                    counter.set(0);
                }
            }
        }
    }

    /**
     * 路由执行失败或超时时增加失败计数，超过阈值切换到 OPEN。
     *
     * @param capability capability 编码（可为 null，null 时静默忽略）
     */
    public void recordFailure(String capability) {
        if (capability == null) return;

        CircuitBreakerState cbState = circuitStates.computeIfAbsent(capability, k -> new CircuitBreakerState());
        synchronized (cbState) {
            // 计数递增和阈值判断必须在 synchronized 块内，确保与状态转换的原子性
            AtomicInteger counter = failureCounters.computeIfAbsent(capability, k -> new AtomicInteger(0));
            int failures = counter.incrementAndGet();

            if (cbState.state == CircuitState.HALF_OPEN) {
                // HALF_OPEN 探测失败 → 切回 OPEN，重置恢复计时
                cbState.state = CircuitState.OPEN;
                cbState.openedAt = Instant.now();
                log.warn("[CircuitBreaker] capability={} HALF_OPEN 探测失败，切回 OPEN", capability);
            } else if (failures >= failureThreshold && cbState.state == CircuitState.CLOSED) {
                // 连续失败达到阈值 → 切换到 OPEN
                cbState.state = CircuitState.OPEN;
                cbState.openedAt = Instant.now();
                log.warn("[CircuitBreaker] capability={} 连续失败 {} 次，断路器切换到 OPEN", capability, failures);
            }
        }
    }

    /**
     * 获取指定 capability 的断路器状态。
     *
     * @param capability capability 编码
     * @return 断路器状态枚举
     */
    public CircuitState getCircuitState(String capability) {
        if (capability == null) return CircuitState.CLOSED;
        CircuitBreakerState cbState = circuitStates.get(capability);
        return cbState != null ? cbState.state : CircuitState.CLOSED;
    }

    /**
     * 获取所有 capability 的断路器状态（供监控端点使用）。
     *
     * @return capability → 详情 Map
     */
    public Map<String, Object> getCircuitBreakerStatus() {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, CircuitBreakerState> entry : circuitStates.entrySet()) {
            String capability = entry.getKey();
            CircuitBreakerState cbState = entry.getValue();
            AtomicInteger counter = failureCounters.get(capability);

            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("state", cbState.state.name());
            detail.put("failureCount", counter != null ? counter.get() : 0);
            detail.put("failureThreshold", failureThreshold);
            detail.put("openedAt", cbState.openedAt != null ? cbState.openedAt.toString() : null);
            detail.put("recoveryMs", recoveryMs);
            result.put(capability, detail);
        }
        return result;
    }

    /**
     * 手动重置指定 capability 的断路器（恢复到 CLOSED 状态）。
     *
     * @param capability capability 编码
     */
    public void resetCircuitBreaker(String capability) {
        CircuitBreakerState cbState = circuitStates.get(capability);
        if (cbState != null) {
            synchronized (cbState) {
                cbState.state = CircuitState.CLOSED;
                cbState.openedAt = null;
                // 重置失败计数（必须在 synchronized 块内，确保状态+计数原子性）
                AtomicInteger counter = failureCounters.get(capability);
                if (counter != null) {
                    counter.set(0);
                }
            }
        }
        log.info("[CircuitBreaker] capability={} 断路器已手动重置为 CLOSED", capability);
    }
}
