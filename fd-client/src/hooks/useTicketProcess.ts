import { useState, useCallback } from 'react';
import { TicketTranslation } from '../types/server';

export type ProcessType = 'translating' | 'replying' | null;

interface ProcessState {
    status: ProcessType;
    tempTranslation: Partial<TicketTranslation> | null;
    tempAiReply: [string, string] | null; 
}

// 内存中持久化状态 (全局变量)
const globalProcessStates: Record<number, ProcessState> = {};
const listeners: Set<() => void> = new Set();

// 全局互斥状态：当前正在执行 AI Reply 的工单 ID
let globalActiveReplyingId: number | null = null;

const notify = () => {
    listeners.forEach(listener => listener());
};

export const useTicketProcess = () => {
    const [, setTick] = useState(0);
    const forceUpdate = useCallback(() => setTick(t => t + 1), []);

    // 注册监听器
    useState(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    });

    const getProcessState = (ticketId: number): ProcessState => {
        return globalProcessStates[ticketId] || { status: null, tempTranslation: null, tempAiReply: null };
    };

    const setProcessStatus = (ticketId: number, status: ProcessType) => {
        const current = getProcessState(ticketId);
        globalProcessStates[ticketId] = { ...current, status };
        notify();
    };

    const setTempTranslation = (ticketId: number, translation: Partial<TicketTranslation> | null) => {
        const current = getProcessState(ticketId);
        globalProcessStates[ticketId] = { ...current, tempTranslation: translation };
        notify();
    };

    const setTempAiReply = (ticketId: number, reply: [string, string] | null) => {
        const current = getProcessState(ticketId);
        globalProcessStates[ticketId] = { ...current, tempAiReply: reply };
        notify();
    };

    const clearProcessState = (ticketId: number) => {
        delete globalProcessStates[ticketId];
        notify();
    };

    // AI Reply 互斥状态管理
    const getActiveReplyingId = (): number | null => globalActiveReplyingId;

    const setActiveReplyingId = (id: number | null) => {
        globalActiveReplyingId = id;
        notify();
    };

    return {
        getProcessState,
        setProcessStatus,
        setTempTranslation,
        clearProcessState,
        getActiveReplyingId,
        getActiveReplyingId,
        setActiveReplyingId,
        setTempAiReply
    };
};
