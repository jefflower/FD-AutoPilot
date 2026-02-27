import { useState, useCallback, useEffect, useRef } from 'react';
import { TicketTranslation } from '../types/server';

interface ProcessState {
    tempTranslation: Partial<TicketTranslation> | null;
    tempAiReply: [string, string] | null;
    streamingText: string;
}

// 内存中持久化状态 (全局变量)
const globalProcessStates: Record<number, ProcessState> = {};
const listeners: Set<() => void> = new Set();

const defaultState: ProcessState = { tempTranslation: null, tempAiReply: null, streamingText: '' };

const notify = () => {
    listeners.forEach(listener => listener());
};

export const useTicketProcess = () => {
    const [, setTick] = useState(0);
    const forceUpdate = useCallback(() => setTick(t => t + 1), []);

    // 使用 ref 保持 listener 引用稳定，确保 cleanup 时能正确删除
    const listenerRef = useRef<(() => void) | null>(null);

    // 注册/注销监听器（组件卸载时自动清理，避免内存泄漏）
    useEffect(() => {
        const listener = () => forceUpdate();
        listenerRef.current = listener;
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            listenerRef.current = null;
        };
    }, [forceUpdate]);

    const getProcessState = useCallback((ticketId: number): ProcessState => {
        return globalProcessStates[ticketId] || defaultState;
    }, []);

    const setTempTranslation = useCallback((ticketId: number, translation: Partial<TicketTranslation> | null) => {
        const current = globalProcessStates[ticketId] || { ...defaultState };
        globalProcessStates[ticketId] = { ...current, tempTranslation: translation };
        notify();
    }, []);

    const setTempAiReply = useCallback((ticketId: number, reply: [string, string] | null) => {
        const current = globalProcessStates[ticketId] || { ...defaultState };
        globalProcessStates[ticketId] = { ...current, tempAiReply: reply };
        notify();
    }, []);

    const setStreamingText = useCallback((ticketId: number, text: string) => {
        const current = globalProcessStates[ticketId] || { ...defaultState };
        globalProcessStates[ticketId] = { ...current, streamingText: text };
        notify();
    }, []);

    return {
        getProcessState,
        setTempTranslation,
        setStreamingText,
        setTempAiReply
    };
};
