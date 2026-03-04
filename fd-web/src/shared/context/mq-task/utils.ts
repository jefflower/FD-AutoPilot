import type { RecentlyCompletedEntry } from './types';

// ── 常量 ──

/** 失败冷却常量 */
export const FAILURE_MAX_RETRIES = 3;
export const FAILURE_COOLDOWN_MS = 60_000;

/** 任务执行超时（防止 Agent 挂起导致任务永远卡在 processingTasks 中）—— 与 SyncBridge 10 分钟对齐 */
export const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

/** completeTask 重试常量 */
export const COMPLETE_MAX_RETRIES = 3;
export const COMPLETE_RETRY_DELAYS = [1000, 2000, 4000]; // 1s -> 2s -> 4s

/** claim 指数退避常量 */
export const CLAIM_BACKOFF_INITIAL_MS = 1000;
export const CLAIM_BACKOFF_MAX_MS = 30_000;

/** SSE 断线加速轮询间隔 */
export const SSE_DISCONNECTED_POLL_MS = 2000;

/** recentlyCompleted sessionStorage 最大条数 */
export const RECENTLY_COMPLETED_MAX = 100;

// ── 工具函数 ──

/**
 * 获取或创建客户端唯一标识
 */
export function getOrCreateClientId(): string {
    const KEY = 'fd_task_client_id';
    let clientId = localStorage.getItem(KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem(KEY, clientId);
    }
    return clientId;
}

/**
 * 判断错误是否为网络错误（断连/超时/DNS 失败等）
 */
export function isNetworkError(err: unknown): boolean {
    if (err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Network request failed'))) {
        return true;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
        return true;
    }
    return false;
}

/**
 * 判断错误是否为认证错误（401/403）
 */
export function isAuthError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as any).status;
        return status === 401 || status === 403;
    }
    if (err instanceof Error) {
        return /\b(401|403)\b/.test(err.message);
    }
    return false;
}

// ── recentlyCompleted sessionStorage 持久化工具函数 ──

function getRecentlyCompletedStorageKey(taskType: string): string {
    return `mq-recently-completed-${taskType}`;
}

export function loadRecentlyCompleted(taskType: string): Map<number, number> {
    const key = getRecentlyCompletedStorageKey(taskType);
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return new Map();
        const entries: RecentlyCompletedEntry[] = JSON.parse(raw);
        const map = new Map<number, number>();
        for (const entry of entries) {
            map.set(entry.ticketId, entry.completedAt);
        }
        return map;
    } catch {
        return new Map();
    }
}

export function saveRecentlyCompleted(taskType: string, map: Map<number, number>): void {
    const key = getRecentlyCompletedStorageKey(taskType);
    try {
        const entries: RecentlyCompletedEntry[] = [];
        for (const [ticketId, completedAt] of map) {
            entries.push({ ticketId, completedAt });
        }
        entries.sort((a, b) => a.completedAt - b.completedAt);
        const trimmed = entries.length > RECENTLY_COMPLETED_MAX
            ? entries.slice(entries.length - RECENTLY_COMPLETED_MAX)
            : entries;
        sessionStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
        // sessionStorage 不可用或空间不足，静默忽略
    }
}

