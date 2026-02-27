import React, { createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { createMQTaskContext, MQTask } from './createMQTaskContext';

export type AuditTask = MQTask;

/**
 * 审核 MQ Context — 串行模式（batchSize=1）
 *
 * 与翻译/回复的区别：审核是人工操作。
 * taskProcessor 返回一个 Promise，在用户完成审核后才 resolve。
 * 如果工单不是 PENDING_AUDIT 状态，自动消费跳过。
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'ticket.audit',
    defaultBatchSize: 1,
    concurrencyMode: 'serial',
    interTaskDelayMs: 500,
    pollIntervalMs: 5000,
});

/**
 * 审核完成回调的 Context（供 UI 组件调用 completeAudit）
 */
interface AuditResolverContextType {
    completeAudit: (ticketId: number, success: boolean) => void;
    /** 获取当前等待审核的工单（含完整数据） */
    getAuditingTicket: (ticketId: number) => any | undefined;
}

const AuditResolverContext = createContext<AuditResolverContextType | null>(null);

export const MQAuditProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // ticketId → { resolve, ticket } 映射，桥接 taskProcessor Promise 和 UI 操作
    const pendingResolversRef = useRef(new Map<number, { resolve: (success: boolean) => void; ticket: any }>());

    const taskProcessor = useCallback(async (ticket: any) => {
        // 审核状态（PENDING_AUDIT/AUDITING）需要等人工操作，其余状态自动跳过
        const auditStatuses = ['PENDING_AUDIT', 'AUDITING'];
        if (!auditStatuses.includes(ticket.status)) {
            console.log(`[MQ-audit] Ticket #${ticket.id} status is ${ticket.status}, auto-skipping`);
            return true;
        }

        // PENDING_AUDIT：创建 Promise，等待用户手动审核
        return new Promise<boolean>((resolve) => {
            pendingResolversRef.current.set(ticket.id, { resolve, ticket });
            console.log(`[MQ-audit] Ticket #${ticket.id} waiting for manual audit`);
        });
    }, []);

    const completeAudit = useCallback((ticketId: number, success: boolean) => {
        const entry = pendingResolversRef.current.get(ticketId);
        if (entry) {
            entry.resolve(success);
            pendingResolversRef.current.delete(ticketId);
        } else {
            console.warn(`[MQ-audit] No pending resolver for ticket #${ticketId}`);
        }
    }, []);

    const getAuditingTicket = useCallback((ticketId: number) => {
        return pendingResolversRef.current.get(ticketId)?.ticket;
    }, []);

    return (
        <AuditResolverContext.Provider value={{ completeAudit, getAuditingTicket }}>
            <BaseProvider taskProcessor={taskProcessor}>
                {children}
            </BaseProvider>
        </AuditResolverContext.Provider>
    );
};

export const useMQAudit = () => {
    const ctx = useTaskContext();
    const resolverCtx = useContext(AuditResolverContext);
    if (!resolverCtx) throw new Error('useMQAudit must be used within MQAuditProvider');

    return {
        auditQueue: ctx.taskQueue,
        processingTasks: ctx.processingTasks,
        completedHistory: ctx.completedHistory,
        clearHistory: ctx.clearHistory,
        isRunning: ctx.isRunning,
        startConsumer: ctx.startConsumer,
        stopConsumer: ctx.stopConsumer,
        batchSize: ctx.batchSize,
        updateBatchSize: ctx.updateBatchSize,
        logs: ctx.logs,
        /** 完成审核（resolve taskProcessor Promise → ACK MQ 消息） */
        completeAudit: resolverCtx.completeAudit,
        /** 获取当前等待审核的完整工单数据 */
        getAuditingTicket: resolverCtx.getAuditingTicket,
    };
};
