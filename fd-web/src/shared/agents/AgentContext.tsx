import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AgentRegistry } from './AgentRegistry';
import { CliExecutor } from './executors/CliExecutor';
import { HttpApiExecutor } from './executors/HttpApiExecutor';
import { NotebookLmExecutor } from './executors/NotebookLmExecutor';
import { TrackingExecutor } from './executors/TrackingExecutor';
import { FunctionExecutor } from './executors/FunctionExecutor';
import { NotebookLmPyExecutor } from './executors/NotebookLmPyExecutor';
import { ClaudeCliExecutor } from './executors/ClaudeCliExecutor';
import { registerClient, startHeartbeat, dispatchAgentChanged } from '../services/clientRegistration';
import type { AgentDefinition, AgentBindings, CapabilityDefinition } from '../types/server';

interface AgentContextValue {
    ready: boolean;
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    capabilities: CapabilityDefinition[];
    onlineClients: number;
    reload: () => Promise<void>;
}

const AgentCtx = createContext<AgentContextValue>({
    ready: false,
    definitions: [],
    bindings: {},
    capabilities: [],
    onlineClients: 0,
    reload: async () => {},
});

export const useAgentContext = () => useContext(AgentCtx);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [ready, setReady] = useState(false);
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});
    const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
    const [onlineClients, setOnlineClients] = useState(0);

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

        registry.registerExecutor(new CliExecutor());
        registry.registerExecutor(new ClaudeCliExecutor());
        registry.registerExecutor(new HttpApiExecutor());
        registry.registerExecutor(new NotebookLmExecutor());
        registry.registerExecutor(new TrackingExecutor());
        registry.registerExecutor(new FunctionExecutor());
        registry.registerExecutor(new NotebookLmPyExecutor());

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

    // 注册客户端并启动心跳
    useEffect(() => {
        if (!ready) return;

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
        <AgentCtx.Provider value={{ ready, definitions, bindings, capabilities, onlineClients, reload }}>
            {children}
        </AgentCtx.Provider>
    );
};
