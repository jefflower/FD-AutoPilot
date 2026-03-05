/**
 * Agent 执行日志 -- Bridge API 调用封装
 *
 * 通过 HTTP Bridge (localhost:9987) 查询 Rust 客户端存储的 Agent 执行日志。
 * 所有请求均做 try-catch，bridge 不可用时返回合理默认值。
 */

import { checkBridgeAvailable, getBridgeBaseUrl } from '../../tauri/bridge';

// ─── 常量 ──────────────────────────────────────────────────

/** 动态计算 bridge 基础路径（支持 Tauri 远程 URL 模式直连 127.0.0.1:9987） */
const bridgeBase = () => `${getBridgeBaseUrl()}/bridge`;

// ─── 数据结构 ─────────────────────────────────────────────

export interface ExecLogEntry {
    id: number;
    agentCode: string;
    status: 'running' | 'success' | 'failed' | 'timeout';
    command: string | null;
    inputParams: string | null;
    stdout: string | null;
    stderr: string | null;
    errorMsg: string | null;
    durationMs: number | null;
    refType: string | null;
    refId: string | null;
    createdAt: string;
}

export interface ExecLogConfig {
    agentCode: string;
    retentionDays: number;
    enabled: boolean;
}

export interface ExecLogPage {
    total: number;
    items: ExecLogEntry[];
}

// ─── API ──────────────────────────────────────────────────

async function bridgeFetch<T>(
    path: string,
    options?: RequestInit,
): Promise<T | null> {
    try {
        const resp = await fetch(`${bridgeBase()}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return null;
        const json = await resp.json();
        // Bridge API 返回 {success, data, error} 格式，解包 data 字段
        if (json && typeof json === 'object' && 'success' in json) {
            if (!json.success) return null;
            return json.data as T;
        }
        return json as T;
    } catch {
        return null;
    }
}

// ─── Rust 运行时日志 ─────────────────────────────────────

export interface RustLogEntry {
    timestamp: string;
    level: string;
    message: string;
}

export const rustLogApi = {
    /** 查询 Rust 运行时日志 */
    async query(opts?: { limit?: number; level?: string; keyword?: string }): Promise<RustLogEntry[]> {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.level) params.set('level', opts.level);
        if (opts?.keyword) params.set('keyword', opts.keyword);
        const qs = params.toString();
        const result = await bridgeFetch<RustLogEntry[]>(
            `/rust-logs${qs ? `?${qs}` : ''}`,
        );
        return result ?? [];
    },

    /** 清空 Rust 运行时日志 */
    async clear(): Promise<void> {
        await bridgeFetch('/rust-logs/clear', { method: 'POST' });
    },
};

export const execLogApi = {
    /**
     * 分页查询执行日志
     */
    async query(
        agentCode: string,
        opts?: { status?: string; limit?: number; offset?: number },
    ): Promise<ExecLogPage> {
        const params = new URLSearchParams({ agentCode: agentCode });
        if (opts?.status) params.set('status', opts.status);
        if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
        if (opts?.offset !== undefined) params.set('offset', String(opts.offset));

        const result = await bridgeFetch<ExecLogPage>(
            `/exec-logs?${params.toString()}`,
        );
        return result ?? { total: 0, items: [] };
    },

    /**
     * 获取单条日志详情
     */
    async getDetail(id: number): Promise<ExecLogEntry | null> {
        return bridgeFetch<ExecLogEntry>(`/exec-logs/${id}`);
    },

    /**
     * 获取日志配置
     */
    async getConfig(agentCode?: string): Promise<ExecLogConfig[]> {
        const path = agentCode
            ? `/exec-logs/config?agentCode=${encodeURIComponent(agentCode)}`
            : '/exec-logs/config';
        const result = await bridgeFetch<ExecLogConfig[]>(path);
        return result ?? [];
    },

    /**
     * 保存日志配置
     */
    async setConfig(config: ExecLogConfig): Promise<ExecLogConfig | null> {
        return bridgeFetch<ExecLogConfig>('/exec-logs/config', {
            method: 'PUT',
            body: JSON.stringify(config),
        });
    },

    /**
     * 手动清理过期日志
     */
    async cleanup(agentCode?: string): Promise<{ deleted: number }> {
        const body = agentCode ? { agentCode: agentCode } : {};
        const result = await bridgeFetch<{ deleted: number }>(
            '/exec-logs/cleanup',
            {
                method: 'POST',
                body: JSON.stringify(body),
            },
        );
        return result ?? { deleted: 0 };
    },

    /**
     * 检测 Bridge 服务是否可用（复用 bridge.ts 中的逻辑）
     */
    async checkAvailable(): Promise<boolean> {
        return checkBridgeAvailable();
    },
};
