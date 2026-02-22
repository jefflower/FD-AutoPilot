import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AgentRegistry } from './AgentRegistry';
import { CliExecutor } from './executors/CliExecutor';
import { HttpApiExecutor } from './executors/HttpApiExecutor';
import { ShadowExecutor } from './executors/ShadowExecutor';
import { FunctionExecutor } from './executors/FunctionExecutor';
import type { AgentDefinition, AgentBindings } from '../types/server';

interface AgentContextValue {
    ready: boolean;
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    reload: () => Promise<void>;
}

const AgentCtx = createContext<AgentContextValue>({
    ready: false,
    definitions: [],
    bindings: {},
    reload: async () => {},
});

export const useAgentContext = () => useContext(AgentCtx);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [ready, setReady] = useState(false);
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});

    const reload = useCallback(async () => {
        const registry = AgentRegistry.getInstance();
        await registry.reload();
        setDefinitions(registry.getAllDefinitions());
        setBindings(registry.getBindings());
    }, []);

    useEffect(() => {
        const registry = AgentRegistry.getInstance();

        registry.registerExecutor(new CliExecutor());
        registry.registerExecutor(new HttpApiExecutor());
        registry.registerExecutor(new ShadowExecutor());
        registry.registerExecutor(new FunctionExecutor());

        registry.loadDefinitions()
            .then(() => {
                setDefinitions(registry.getAllDefinitions());
                setBindings(registry.getBindings());
                setReady(true);
            })
            .catch((err) => {
                console.warn('[AgentProvider] Failed to load agent definitions:', err);
                setReady(true);
            });
    }, []);

    return (
        <AgentCtx.Provider value={{ ready, definitions, bindings, reload }}>
            {children}
        </AgentCtx.Provider>
    );
};
