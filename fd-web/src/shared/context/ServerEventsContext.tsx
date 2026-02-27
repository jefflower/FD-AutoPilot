import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { getAuthToken, getServerBaseUrl } from '../services/serverApi';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
type EventHandler = (data: any) => void;

interface ServerEventsContextType {
    status: ConnectionStatus;
    subscribe: (eventType: string, handler: EventHandler) => () => void;
}

const ServerEventsContext = createContext<ServerEventsContextType | null>(null);

/**
 * 获取或创建客户端 ID（复用 task 的 clientId）
 */
function getClientId(): string {
    const KEY = 'fd_task_client_id';
    let clientId = localStorage.getItem(KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem(KEY, clientId);
    }
    return clientId;
}

/**
 * 解析 SSE 文本流为事件对象
 */
function parseSSEChunk(buffer: string): { events: Array<{ type: string; data: string }>; remaining: string } {
    const events: Array<{ type: string; data: string }> = [];
    const lines = buffer.split('\n');
    let currentType = 'message';
    let currentData = '';
    let lastProcessedIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('event:')) {
            currentType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            currentData = line.slice(5).trim();
        } else if (line.startsWith(':')) {
            // SSE 注释行（心跳），忽略
        } else if (line === '') {
            // 空行 = 事件结束
            if (currentData) {
                events.push({ type: currentType, data: currentData });
            }
            currentType = 'message';
            currentData = '';
            lastProcessedIndex = lines.slice(0, i + 1).join('\n').length + 1;
        }
    }

    // 返回未处理的 buffer（不完整的事件）
    const remaining = buffer.slice(lastProcessedIndex);
    return { events, remaining };
}

interface ServerEventsProviderProps {
    children: ReactNode;
    enabled?: boolean;
}

export const ServerEventsProvider: React.FC<ServerEventsProviderProps> = ({ children, enabled = true }) => {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const subscribersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
    const abortControllerRef = useRef<AbortController | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCountRef = useRef(0);
    const mountedRef = useRef(true);
    // 连接代际 ID：每次 connect() 递增，确保过期连接的 finally 不触发重连
    const connectionGenRef = useRef(0);

    const dispatch = useCallback((eventType: string, data: any) => {
        const handlers = subscribersRef.current.get(eventType);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (err) {
                    console.error(`[SSE] Handler error for event '${eventType}':`, err);
                }
            });
        }
    }, []);

    const connectTimeRef = useRef<number>(0);
    const authFailedRef = useRef(false);

    const connect = useCallback(async () => {
        if (!mountedRef.current) return;

        const token = getAuthToken();
        if (!token) {
            setStatus('disconnected');
            return;
        }

        if (authFailedRef.current) {
            setStatus('disconnected');
            return;
        }

        // 清理旧连接和定时器
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        // 递增连接代际，旧连接的 finally 将因代际不匹配而跳过重连
        const myGen = ++connectionGenRef.current;

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setStatus('connecting');

        const clientId = getClientId();
        const baseUrl = getServerBaseUrl();
        const url = `${baseUrl}/api/v1/events/stream?clientId=${encodeURIComponent(clientId)}`;

        let shouldReconnect = true;

        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'text/event-stream',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    console.warn(`[SSE] Auth failed (${response.status}), stopping reconnect until token refresh`);
                    authFailedRef.current = true;
                    shouldReconnect = false;
                }
                throw new Error(`SSE connection failed: ${response.status}`);
            }

            if (!response.body) {
                throw new Error('SSE response has no body');
            }

            setStatus('connected');
            connectTimeRef.current = Date.now();
            authFailedRef.current = false;
            console.log('[SSE] Connected');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (mountedRef.current && myGen === connectionGenRef.current) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const { events, remaining } = parseSSEChunk(buffer);
                buffer = remaining;

                for (const event of events) {
                    try {
                        const parsed = JSON.parse(event.data);
                        dispatch(event.type, parsed);
                    } catch {
                        dispatch(event.type, event.data);
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            console.warn('[SSE] Connection error:', err.message);
        } finally {
            // 只有当前代际的连接才能触发重连，防止 StrictMode 双重挂载导致的竞态
            if (mountedRef.current && myGen === connectionGenRef.current) {
                setStatus('disconnected');
                if (shouldReconnect) {
                    const connectionDuration = Date.now() - connectTimeRef.current;
                    if (connectionDuration > 5000) {
                        retryCountRef.current = 0;
                    }
                    scheduleReconnect();
                }
            }
        }
    }, [dispatch]);

    const scheduleReconnect = useCallback(() => {
        if (!mountedRef.current || !enabled) return;

        // 清理已有的重连定时器
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
        }

        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;

        console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${retryCountRef.current})`);

        reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
                connect();
            }
        }, delay);
    }, [connect, enabled]);

    // 启动/停止连接
    useEffect(() => {
        mountedRef.current = true;

        if (enabled) {
            connect();
        }

        return () => {
            mountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };
    }, [enabled, connect]);

    // Token 变化时重连（同时清除认证失败标记）
    useEffect(() => {
        const handleTokenChange = () => {
            if (enabled && mountedRef.current) {
                authFailedRef.current = false;
                retryCountRef.current = 0;
                connect();
            }
        };
        window.addEventListener('auth-token-changed', handleTokenChange);
        return () => window.removeEventListener('auth-token-changed', handleTokenChange);
    }, [enabled, connect]);

    const subscribe = useCallback((eventType: string, handler: EventHandler): (() => void) => {
        if (!subscribersRef.current.has(eventType)) {
            subscribersRef.current.set(eventType, new Set());
        }
        subscribersRef.current.get(eventType)!.add(handler);

        // 返回取消订阅函数
        return () => {
            const handlers = subscribersRef.current.get(eventType);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    subscribersRef.current.delete(eventType);
                }
            }
        };
    }, []);

    const contextValue = React.useMemo<ServerEventsContextType>(() => ({
        status,
        subscribe,
    }), [status, subscribe]);

    return (
        <ServerEventsContext.Provider value={contextValue}>
            {children}
        </ServerEventsContext.Provider>
    );
};

/**
 * 使用 SSE 事件（可选 — 外部无 Provider 时返回 null）
 */
export function useServerEvents(): ServerEventsContextType | null {
    return useContext(ServerEventsContext);
}

/**
 * 订阅特定 SSE 事件类型
 */
export function useServerEvent(eventType: string, handler: EventHandler): void {
    const ctx = useServerEvents();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!ctx) return;
        return ctx.subscribe(eventType, (data) => handlerRef.current(data));
    }, [ctx, eventType]);
}
