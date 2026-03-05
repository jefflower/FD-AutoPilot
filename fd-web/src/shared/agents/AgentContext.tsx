import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AgentRegistry } from './AgentRegistry';
import { GeminiCliExecutor } from './executors/GeminiCliExecutor';
import { NotebookLmPyExecutor } from './executors/NotebookLmPyExecutor';
import { ClaudeCliExecutor } from './executors/ClaudeCliExecutor';
import { ShadowWindowExecutor } from './executors/ShadowWindowExecutor';
import { registerClient, startHeartbeat, dispatchAgentChanged } from '../services/clientRegistration';
import { isTauriEnv } from '../../tauri/bridge';
import { useToast } from '../hooks/useToast';
import type { AgentDefinition, AgentBindings, CapabilityDefinition } from '../types/server';

interface AgentContextValue {
    ready: boolean;
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    capabilities: CapabilityDefinition[];
    onlineClients: number;
    reload: () => Promise<void>;
    /** 运行时手动覆盖的 Agent 轮询状态（不持久化，刷新页面恢复 autoStart 默认值） */
    manualAgentOverrides: Map<string, boolean>;
    /** 手动启停 Agent（运行时状态，不修改数据库） */
    toggleManualAgent: (code: string) => void;
}

const AgentCtx = createContext<AgentContextValue>({
    ready: false,
    definitions: [],
    bindings: {},
    capabilities: [],
    onlineClients: 0,
    reload: async () => {},
    manualAgentOverrides: new Map(),
    toggleManualAgent: () => {},
});

export const useAgentContext = () => useContext(AgentCtx);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [ready, setReady] = useState(false);
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});
    const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
    const [onlineClients, setOnlineClients] = useState(0);
    const { toast } = useToast();

    // 运行时手动启停覆盖状态（内存中，不持久化）
    // Map<agentCode, isPolling> — 明确覆盖 autoStart 的默认值
    const [manualAgentOverrides, setManualAgentOverrides] = useState<Map<string, boolean>>(new Map());

    const toggleManualAgent = useCallback((code: string) => {
        setManualAgentOverrides(prev => {
            const next = new Map(prev);
            const def = definitions.find(d => d.code === code);
            const autoStart = def?.autoStart === true;
            // 当前生效状态：有覆盖用覆盖值，否则用 autoStart
            const currentlyPolling = next.has(code) ? next.get(code)! : autoStart;
            next.set(code, !currentlyPolling);
            return next;
        });
    }, [definitions]);

    // Refs to keep heartbeat callback stable
    const definitionsRef = useRef(definitions);
    definitionsRef.current = definitions;

    const reload = useCallback(async () => {
        const registry = AgentRegistry.getInstance();
        await registry.reload();
        setDefinitions(registry.getAllDefinitions());
        setBindings(registry.getBindings());
        setCapabilities(registry.getCapabilities());

        // Agent 定义变更后立即触发心跳，将最新 Agent 列表上报服务端
        dispatchAgentChanged();
    }, []);

    useEffect(() => {
        const registry = AgentRegistry.getInstance();

        // 仅 Tauri 客户端注册执行器，网页端无执行能力
        if (isTauriEnv()) {
            registry.registerExecutor(new GeminiCliExecutor());
            registry.registerExecutor(new ClaudeCliExecutor());
            registry.registerExecutor(new NotebookLmPyExecutor());
            registry.registerExecutor(new ShadowWindowExecutor());
        }

        registry.loadDefinitions()
            .then(() => {
                setDefinitions(registry.getAllDefinitions());
                setBindings(registry.getBindings());
                setCapabilities(registry.getCapabilities());
                setReady(true);
            })
            .catch((err) => {
                console.warn('[AgentProvider] Failed to load agent definitions:', err);
                setReady(true);
            });
    }, []);

    // 网页端登录提示：无法启动 Agent
    useEffect(() => {
        if (!ready) return;
        if (!isTauriEnv()) {
            toast('warning', '当前为网页端访问，无法启动 Agent 执行能力。如需使用 AI Agent，请通过桌面客户端登录。', 6000);
        }
    }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

    // 注册客户端并启动心跳（仅 Tauri 客户端）
    // 网页端不注册能力、不上报心跳，避免占用资源和抢占任务
    useEffect(() => {
        if (!ready || !isTauriEnv()) return;

        // 获取当前可在客户端运行的 agent 列表
        const getRunningAgents = () =>
            definitionsRef.current
                .filter(d => d.enabled && d.executionEnv !== 'SERVER_ONLY')
                .map(d => d.code);

        // 注册
        registerClient(capabilities, getRunningAgents()).then(result => {
            if (result) {
                setOnlineClients(result.onlineClients);
            }
        });

        // 启动心跳（30 秒间隔）
        const stopFn = startHeartbeat(getRunningAgents);

        return () => {
            stopFn();
        };
    }, [ready, capabilities]);

    return (
        <AgentCtx.Provider value={{
            ready, definitions, bindings, capabilities, onlineClients, reload,
            manualAgentOverrides, toggleManualAgent,
        }}>
            {children}
        </AgentCtx.Provider>
    );
};
