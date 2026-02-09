import { useState, useCallback } from 'react';
import { TicketTranslation } from '../types/server';

export type ProcessType = 'translating' | 'replying' | null;

interface ProcessState {
    status: ProcessType;
    tempTranslation: Partial<TicketTranslation> | null;
    tempAiReply: [string, string] | null;
    streamingText: string;
}

// 内存中持久化状态 (全局变量)
const globalProcessStates: Record<number, ProcessState> = {};
const listeners: Set<() => void> = new Set();

// 全局互斥状态：当前正在执行 AI Reply 的工单 ID
let globalActiveReplyingId: number | null = null;

const defaultState: ProcessState = { status: null, tempTranslation: null, tempAiReply: null, streamingText: '' };

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

    const getProcessState = useCallback((ticketId: number): ProcessState => {
        return globalProcessStates[ticketId] || defaultState;
    }, []);

    const setProcessStatus = useCallback((ticketId: number, status: ProcessType) => {
        const current = globalProcessStates[ticketId] || defaultState;
        globalProcessStates[ticketId] = {
            ...current,
            status,
            // 流程结束时自动清空流式文本
            ...(status === null ? { streamingText: '' } : {})
        };
        notify();
    }, []);

    const setTempTranslation = useCallback((ticketId: number, translation: Partial<TicketTranslation> | null) => {
        const current = globalProcessStates[ticketId] || defaultState;
        globalProcessStates[ticketId] = { ...current, tempTranslation: translation };
        notify();
    }, []);

    const setTempAiReply = useCallback((ticketId: number, reply: [string, string] | null) => {
        const current = globalProcessStates[ticketId] || defaultState;
        globalProcessStates[ticketId] = { ...current, tempAiReply: reply };
        notify();
    }, []);

    const setStreamingText = useCallback((ticketId: number, text: string) => {
        const current = globalProcessStates[ticketId] || defaultState;
        globalProcessStates[ticketId] = { ...current, streamingText: text };
        notify();
    }, []);

    // AI Reply 互斥状态管理
    const getActiveReplyingId = useCallback((): number | null => globalActiveReplyingId, []);

    const setActiveReplyingId = useCallback((id: number | null) => {
        globalActiveReplyingId = id;
        notify();
    }, []);

    return {
        getProcessState,
        setProcessStatus,
        setTempTranslation,
        setStreamingText,
        getActiveReplyingId,
        setActiveReplyingId,
        setTempAiReply
    };
};
