import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fd_polling_paused';
const EVENT_NAME = 'polling-control-change';

/**
 * 全局轮询控制 hook — 开发/调试时暂停所有 SSE 连接和定时轮询。
 * 基于 localStorage + 自定义事件，多组件共享状态，无需额外 Context。
 */
export function usePollingControl() {
    const [pollingPaused, setPollingPausedState] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    const setPollingPaused = useCallback((paused: boolean) => {
        setPollingPausedState(paused);
        try {
            localStorage.setItem(STORAGE_KEY, String(paused));
        } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: paused }));
    }, []);

    // 监听其他组件的变更
    useEffect(() => {
        const handler = (e: Event) => {
            setPollingPausedState((e as CustomEvent).detail);
        };
        window.addEventListener(EVENT_NAME, handler);
        return () => window.removeEventListener(EVENT_NAME, handler);
    }, []);

    return { pollingPaused, setPollingPaused };
}
