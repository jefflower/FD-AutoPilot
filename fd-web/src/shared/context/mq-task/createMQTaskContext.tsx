import React, { createContext, useContext, useState, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { taskApi } from '../../services/serverApi';
import type { MQTask, MQTaskConfig, MQTaskContextType, MQTaskProviderProps, FailureCooldownEntry } from './types';
import { getOrCreateClientId, loadRecentlyCompleted } from './utils';
import { useTaskPoller } from './useTaskPoller';
import { useTaskScheduler } from './useTaskScheduler';

/**
 * MQ Task Context 工厂函数（REST 轮询模式）
 *
 * 将翻译/回复/审核 Context 的共同逻辑提取为一处。
 * 通过 REST API 轮询服务端 task claim 接口获取任务，
 * 替代原有的 Tauri MQ 事件驱动模式。
 * taskProcessor 通过 Provider prop 注入，支持在组件内使用 React hooks。
 */
export function createMQTaskContext(config: MQTaskConfig) {
    const Context = createContext<MQTaskContextType | null>(null);

    const Provider: React.FC<MQTaskProviderProps> = ({ children, taskProcessor }) => {
        const [taskQueue, setTaskQueue] = useState<MQTask[]>([]);
        const [processingTasks, setProcessingTasks] = useState<Map<number, MQTask>>(new Map());
        const [completedHistory, setCompletedHistory] = useState<MQTask[]>([]);
        const [isRunning, setIsRunning] = useState(false);
        const [batchSize, setBatchSize] = useState(config.defaultBatchSize);
        const [logs, setLogs] = useState<string[]>([]);

        // Refs
        const processingTasksRef = useRef(processingTasks);
        const activeCountRef = useRef(0);
        const isProcessingRef = useRef(false);
        const taskProcessorRef = useRef(taskProcessor);
        const batchSizeRef = useRef(batchSize);
        const queuedTicketIdsRef = useRef(new Set<number>());
        const isRunningRef = useRef(false);
        const failureCooldownRef = useRef<Map<number, FailureCooldownEntry>>(new Map());
        const agentCodeOverrideRef = useRef<string | undefined>(undefined);
        const recentlyCompletedRef = useRef<Map<number, number>>(loadRecentlyCompleted(config.taskType));

        // 合并 ref 同步
        useLayoutEffect(() => {
            processingTasksRef.current = processingTasks;
            taskProcessorRef.current = taskProcessor;
            batchSizeRef.current = batchSize;
            isRunningRef.current = isRunning;
        }, [processingTasks, taskProcessor, batchSize, isRunning]);

        // 轮询 hook
        const { pollAndClaimRef, claimBackoffRef, emptyPollLoggedRef } = useTaskPoller({
            config,
            isRunning,
            setIsRunning,
            isRunningRef,
            batchSizeRef,
            activeCountRef,
            isProcessingRef,
            processingTasksRef,
            queuedTicketIdsRef,
            failureCooldownRef,
            recentlyCompletedRef,
            setTaskQueue,
            setLogs,
        });

        // 调度 hook
        useTaskScheduler({
            config,
            isRunning,
            isRunningRef,
            batchSizeRef,
            activeCountRef,
            isProcessingRef,
            taskProcessorRef,
            queuedTicketIdsRef,
            failureCooldownRef,
            recentlyCompletedRef,
            agentCodeOverrideRef,
            pollAndClaimRef,
            taskQueue,
            batchSize,
            setTaskQueue,
            setProcessingTasks,
            setCompletedHistory,
            setLogs,
        });

        // 启动消费者
        const startConsumer = useCallback((agentCode?: string) => {
            agentCodeOverrideRef.current = agentCode;
            setIsRunning(true);
            isRunningRef.current = true;
            emptyPollLoggedRef.current = false;
            claimBackoffRef.current = 0;
            const agentLabel = agentCode ? ` (agent: ${agentCode})` : '';
            setLogs(prev => [...prev, `\u25b6 ${config.taskType} \u4efb\u52a1\u6d88\u8d39\u542f\u52a8${agentLabel}`]);
        }, []);

        // 停止消费者
        const stopConsumer = useCallback(() => {
            setIsRunning(false);
            isRunningRef.current = false;
            agentCodeOverrideRef.current = undefined;
            claimBackoffRef.current = 0;
            const clientId = getOrCreateClientId();
            setTaskQueue(prev => {
                for (const task of prev) {
                    if (task.taskInstanceId) {
                        taskApi.releaseTask(task.taskInstanceId, clientId).catch(err =>
                            console.warn(`[Task-${config.taskType}] Release failed:`, err));
                    }
                    queuedTicketIdsRef.current.delete(task.ticketId);
                }
                return [];
            });
            setLogs(prev => [...prev, `\u23f9 ${config.taskType} \u4efb\u52a1\u6d88\u8d39\u5df2\u505c\u6b62`]);
        }, []);

        // 更新 batchSize
        const updateBatchSize = useCallback((size: number) => {
            setBatchSize(size);
        }, []);

        const clearHistory = useCallback(() => {
            setCompletedHistory([]);
        }, []);

        const contextValue = useMemo<MQTaskContextType>(() => ({
            taskQueue,
            processingTasks,
            completedHistory,
            clearHistory,
            isRunning,
            startConsumer,
            stopConsumer,
            batchSize,
            updateBatchSize,
            logs
        }), [
            taskQueue,
            processingTasks,
            completedHistory,
            clearHistory,
            isRunning,
            startConsumer,
            stopConsumer,
            batchSize,
            updateBatchSize,
            logs
        ]);

        return (
            <Context.Provider value={contextValue}>
                {children}
            </Context.Provider>
        );
    };

    const useTaskContext = () => {
        const context = useContext(Context);
        if (!context) throw new Error(`useMQTask(${config.taskType}) must be used within its Provider`);
        return context;
    };

    return { Provider, useTaskContext };
}
