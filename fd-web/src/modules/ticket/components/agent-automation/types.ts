import type { AgentDefinition } from '../../../../shared/types/server';

export interface AgentConsumerHandle {
    isRunning: boolean;
    startConsumer: (agentCode?: string) => void;
    stopConsumer: () => void;
    processingTasks: Map<number, MQTaskLike>;
    completedHistory: MQTaskLike[];
    logs: string[];
}

export interface MQTaskLike {
    ticketId: number;
    externalId: string;
    subject: string;
    status: string;
    error?: string;
    addedAt: number;
}

export interface AgentConsumerMapping {
    definition: AgentDefinition;
    consumer: AgentConsumerHandle | null;  // null = 无对应 MQ 消费者（被动触发型）
    taskType: string;
}

export type ShadowStatus = 'ready' | 'closed' | 'n/a';
