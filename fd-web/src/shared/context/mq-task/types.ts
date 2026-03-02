import type { ReactNode } from 'react';

/**
 * 通用 MQ 任务类型
 */
export interface MQTask {
    ticketId: number;
    externalId: string;
    subject: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    error?: string;
    addedAt: number;
    taskInstanceId?: number;  // 服务端 TaskInstance ID，用于 complete/release
    agentInput?: Record<string, any>;  // 工作流 AgentTaskDelegate 注入的标准化输入
    agentCode?: string;  // 工作流指定的 Agent code（优先于 capability 解析）
}

/**
 * MQ 任务处理回调
 */
export interface TaskCallbacks {
    onStatusChange?: (status: string | null) => void;
    onError?: (error: string) => void;
    onStreamChunk?: (text: string) => void;
    addLog?: (msg: string) => void;
}

/**
 * MQ Task Context 的值类型
 */
export interface MQTaskContextType {
    taskQueue: MQTask[];
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    clearHistory: () => void;
    isRunning: boolean;
    startConsumer: (agentCode?: string) => void;
    stopConsumer: () => void;
    batchSize: number;
    updateBatchSize: (size: number) => void;
    logs: string[];
}

/**
 * MQ Task Context 静态配置（REST 轮询模式）
 */
export interface MQTaskConfig {
    taskType: string;           // 任务类型标识，如 "ticket.translate"
    defaultBatchSize: number;   // 每次 claim 的数量
    concurrencyMode: 'parallel' | 'serial';
    interTaskDelayMs?: number;  // 串行模式下任务间隔
    pollIntervalMs?: number;    // 轮询间隔，默认 3000ms
}

/**
 * Provider Props — taskProcessor 通过 prop 注入（因为它需要 React hooks）
 */
export interface MQTaskProviderProps {
    children: ReactNode;
    taskProcessor: (ticket: any, callbacks: TaskCallbacks) => Promise<boolean | 'skipped'>;
}

/** 失败冷却记录 */
export interface FailureCooldownEntry {
    count: number;       // 连续失败次数
    cooldownUntil: number; // 冷却到期时间戳（Date.now() 基准）
}

/** recentlyCompleted sessionStorage 持久化条目 */
export interface RecentlyCompletedEntry {
    ticketId: number;
    completedAt: number;
}
