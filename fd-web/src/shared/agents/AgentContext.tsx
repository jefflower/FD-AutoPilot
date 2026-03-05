import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AgentRegistry } from './AgentRegistry';
import { GeminiCliExecutor } from './executors/GeminiCliExecutor';
import { NotebookLmPyExecutor } from './executors/NotebookLmPyExecutor';
import { ClaudeCliExecutor } from './executors/ClaudeCliExecutor';
import { ShadowWindowExecutor } from './executors/ShadowWindowExecutor';
import { registerClient, startHeartbeat, dispatchAgentChanged } from '../services/clientRegistration';
import { hasExecutionCapability, detectCapabilities } from '../../tauri/bridge';
import type { CapabilityDetectResult, SkillInfo } from '../../tauri/bridge';
import { useToast } from '../hooks/useToast';
import { userAgentApi } from '../services/api/agent';
import type { AgentDefinition, AgentBindings, CapabilityDefinition, ClientSkillItem, UserAgentConfigDTO } from '../types/server';

// ============ 检测结果缓存 ============

const DETECTION_CACHE_KEY = 'fd-detection-cache';

interface DetectionCache {
  canExecute: boolean;
  capabilityStatus: CapabilityDetectResult[];
  skillMap: Record<string, CapSkillState>;
  modelMap: Record<string, string[]>;
  timestamp: number;
}

/** 保存检测结果到 localStorage */
function saveDetectionCache(data: Omit<DetectionCache, 'timestamp'>) {
  try {
    const cache: DetectionCache = { ...data, timestamp: Date.now() };
    localStorage.setItem(DETECTION_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

/** 读取检测缓存 */
function loadDetectionCache(): DetectionCache | null {
  try {
    const raw = localStorage.getItem(DETECTION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/** 清除检测缓存（登出时调用） */
export function clearDetectionCache() {
  localStorage.removeItem(DETECTION_CACHE_KEY);
}

// ============ Capability Skill 状态 ============

/** 单个 Capability 的 Skill 检测状态 */
export interface CapSkillState {
    loading: boolean;
    skills: SkillInfo[];
    error: string | null;
}

interface AgentContextValue {
    ready: boolean;
    /** 当前环境是否具有 AI 执行能力（Tauri 原生 或 HTTP bridge 可用） */
    canExecute: boolean;
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    capabilities: CapabilityDefinition[];
    /** 本地 Capability 环境检测结果（bridge 可用时才有值） */
    capabilityStatus: CapabilityDetectResult[];
    /** AI Skill 探测结果，按 capability code 分组 */
    skillMap: Record<string, CapSkillState>;
    /** AI 模型探测结果，按 capability code 分组 */
    modelMap: Record<string, string[]>;
    /** 启动检测是否完成（canExecute 检测 + 能力检测 + skill 探测全部完成） */
    startupReady: boolean;
    onlineClients: number;
    reload: () => Promise<void>;
    /** 运行时手动覆盖的 Agent 轮询状态（不持久化，刷新页面恢复 autoStart 默认值） */
    manualAgentOverrides: Map<string, boolean>;
    /** 手动启停 Agent（运行时状态，不修改数据库） */
    toggleManualAgent: (code: string) => void;
    /** 当前用户已订阅的 Agent 配置列表 */
    userAgentConfigs: UserAgentConfigDTO[];
    /** 重新加载用户 Agent 配置 */
    reloadUserAgents: () => Promise<void>;
}

const AgentCtx = createContext<AgentContextValue>({
    ready: false,
    canExecute: false,
    definitions: [],
    bindings: {},
    capabilities: [],
    capabilityStatus: [],
    skillMap: {},
    modelMap: {},
    startupReady: false,
    onlineClients: 0,
    reload: async () => {},
    manualAgentOverrides: new Map(),
    toggleManualAgent: () => {},
    userAgentConfigs: [],
    reloadUserAgents: async () => {},
});

export const useAgentContext = () => useContext(AgentCtx);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [ready, setReady] = useState(false);
    /** 是否具有执行能力：Tauri 原生 OR bridge 可用 */
    const [canExecute, setCanExecute] = useState(false);
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});
    const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
    const [capabilityStatus, setCapabilityStatus] = useState<CapabilityDetectResult[]>([]);
    const [skillMap, setSkillMap] = useState<Record<string, CapSkillState>>({});
    const [modelMap, setModelMap] = useState<Record<string, string[]>>({});
    const [startupReady, setStartupReady] = useState(false);
    const [onlineClients, setOnlineClients] = useState(0);
    const { toast } = useToast();

    // 运行时手动启停覆盖状态（内存中，不持久化）
    // Map<agentCode, isPolling> — 明确覆盖 autoStart 的默认值
    const [manualAgentOverrides, setManualAgentOverrides] = useState<Map<string, boolean>>(new Map());
    const [userAgentConfigs, setUserAgentConfigs] = useState<UserAgentConfigDTO[]>([]);

    const toggleManualAgent = useCallback((code: string) => {
        setManualAgentOverrides(prev => {
            const next = new Map(prev);
            // 使用用户 Agent 配置的 autoStart（而非 AgentDefinition 的全局默认值）
            const userConfig = userAgentConfigs.find(c => c.agentCode === code);
            const autoStart = userConfig?.autoStart === true;
            // 当前生效状态：有覆盖用覆盖值，否则用用户配置的 autoStart
            const currentlyPolling = next.has(code) ? next.get(code)! : autoStart;
            next.set(code, !currentlyPolling);
            return next;
        });
    }, [userAgentConfigs]);

    // Refs to keep heartbeat callback stable
    const definitionsRef = useRef(definitions);
    definitionsRef.current = definitions;

    const userAgentConfigsRef = useRef(userAgentConfigs);
    userAgentConfigsRef.current = userAgentConfigs;

    const reloadUserAgents = useCallback(async () => {
        try {
            const configs = await userAgentApi.getUserAgents();
            setUserAgentConfigs(configs);
        } catch (err) {
            console.warn('[AgentProvider] Failed to load user agent configs:', err);
        }
    }, []);

    const reload = useCallback(async () => {
        const registry = AgentRegistry.getInstance();
        await registry.reload();
        setDefinitions(registry.getAllDefinitions());
        setBindings(registry.getBindings());
        setCapabilities(registry.getCapabilities());

        // Agent 定义变更后立即触发心跳，将最新 Agent 列表上报服务端
        dispatchAgentChanged();
    }, []);

    // 初始化：检测执行能力 + 加载 Agent 定义 + 能力探测
    useEffect(() => {
        const registry = AgentRegistry.getInstance();

        const init = async () => {
            // 0. 检查 localStorage 缓存
            const cached = loadDetectionCache();

            // 1. 异步检测执行能力（Tauri 原生 或 HTTP bridge）
            const capable = cached ? cached.canExecute : await hasExecutionCapability();
            setCanExecute(capable);

            // 2. 仅有执行能力时注册执行器（无论是否有缓存，executor 注册不能跳过）
            if (capable) {
                registry.registerExecutor(new GeminiCliExecutor());
                registry.registerExecutor(new ClaudeCliExecutor());
                registry.registerExecutor(new NotebookLmPyExecutor());
                registry.registerExecutor(new ShadowWindowExecutor());
            }

            // 3. 加载 Agent 定义（所有环境都需要，用于 UI 展示，始终从服务端获取最新）
            try {
                await registry.loadDefinitions();
                setDefinitions(registry.getAllDefinitions());
                setBindings(registry.getBindings());
                setCapabilities(registry.getCapabilities());
            } catch (err) {
                console.warn('[AgentProvider] Failed to load agent definitions:', err);
            }

            setReady(true);

            // 3.5. 加载用户 Agent 配置（始终从服务端获取最新）
            try {
                const configs = await userAgentApi.getUserAgents();
                setUserAgentConfigs(configs);
                console.log('[AgentProvider] User agent configs loaded:', configs.length);
            } catch (err) {
                console.warn('[AgentProvider] Failed to load user agent configs:', err);
            }

            // 如果有缓存，直接恢复检测结果，跳过耗时的 detectCapabilities / detectSkills / getAvailableModels
            if (cached) {
                console.log('[AgentProvider] Using cached detection results');
                setCapabilityStatus(cached.capabilityStatus);
                setSkillMap(cached.skillMap);
                setModelMap(cached.modelMap);
                setStartupReady(true);
                return;
            }

            // 4. 无缓存：有执行能力时，探测本地 Capability 环境（gemini-cli / claude-cli / notebooklm-py）
            let finalCapabilityStatus: CapabilityDetectResult[] = [];
            let finalSkillMap: Record<string, CapSkillState> = {};
            let finalModelMap: Record<string, string[]> = {};

            if (capable) {
                try {
                    finalCapabilityStatus = await detectCapabilities();
                    setCapabilityStatus(finalCapabilityStatus);
                    console.log('[AgentProvider] Capability detection:', finalCapabilityStatus);
                } catch (err) {
                    console.warn('[AgentProvider] Capability detection failed:', err);
                }

                // 5. 对所有注册的 executor 探测 skill 列表
                const executors = registry.getAllExecutors();
                const capsWithSkills = executors.filter(e => e.supportedCapability);
                if (capsWithSkills.length > 0) {
                    // 初始化 loading 状态
                    const initial: Record<string, CapSkillState> = {};
                    capsWithSkills.forEach(e => {
                        initial[e.supportedCapability!] = { loading: true, skills: [], error: null };
                    });
                    setSkillMap(initial);

                    // 并行调用每个 executor 的 detectSkills() 和 getAvailableModels()
                    const skillResults: Record<string, CapSkillState> = {};
                    await Promise.allSettled([
                        // Skill 探测
                        ...capsWithSkills.map(async executor => {
                            const capCode = executor.supportedCapability!;
                            try {
                                const skills = await executor.detectSkills();
                                const state: CapSkillState = { loading: false, skills, error: null };
                                skillResults[capCode] = state;
                                setSkillMap(prev => ({ ...prev, [capCode]: state }));
                            } catch (err: any) {
                                const state: CapSkillState = { loading: false, skills: [], error: err.message };
                                skillResults[capCode] = state;
                                setSkillMap(prev => ({ ...prev, [capCode]: state }));
                            }
                        }),
                        // Model 探测（与 skill 探测并行）
                        ...capsWithSkills.map(async executor => {
                            const capCode = executor.supportedCapability!;
                            try {
                                const models = await executor.getAvailableModels();
                                if (models.length > 0) {
                                    finalModelMap = { ...finalModelMap, [capCode]: models };
                                    setModelMap(prev => ({ ...prev, [capCode]: models }));
                                }
                            } catch (err) {
                                console.warn(`[AgentProvider] Model detection failed for ${capCode}:`, err);
                            }
                        }),
                    ]);
                    finalSkillMap = skillResults;
                    console.log('[AgentProvider] Skill detection:', skillResults);
                }
            }

            // 6. 保存检测结果到缓存
            saveDetectionCache({
                canExecute: capable,
                capabilityStatus: finalCapabilityStatus,
                skillMap: finalSkillMap,
                modelMap: finalModelMap,
            });

            setStartupReady(true);
        };

        init();
    }, []);

    // 无执行能力时提示
    useEffect(() => {
        if (!ready) return;
        if (!canExecute) {
            toast('warning', '当前为网页端访问，无法启动 Agent 执行能力。如需使用 AI Agent，请通过桌面客户端登录。', 6000);
        }
    }, [ready, canExecute]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ref to keep skillMap accessible in registration
    const skillMapRef = useRef(skillMap);
    skillMapRef.current = skillMap;

    // 注册客户端并启动心跳
    // 有执行能力时：等待 startupReady（skill 探测完成后）再注册，携带 detectedSkills
    // 纯网页端：ready 后立即注册（无 skill）
    useEffect(() => {
        if (!ready) return;

        // 有执行能力时，等 startupReady（skill 探测完成后再注册，确保首次注册就携带 skills）
        if (canExecute && !startupReady) return;

        // 获取当前可在客户端运行的 agent 列表（仅上报用户已订阅的 Agent）
        const getRunningAgents = () => {
            const subscribedCodes = new Set(
                userAgentConfigsRef.current
                    .filter(c => c.enabled)
                    .map(c => c.agentCode)
            );
            return definitionsRef.current
                .filter(d => d.enabled && d.executionEnv !== 'SERVER_ONLY' && subscribedCodes.has(d.code))
                .map(d => d.code);
        };

        // 构造 detectedSkills（从 skillMap 中提取已完成的 skill 列表）
        const buildDetectedSkills = (): Record<string, ClientSkillItem[]> | undefined => {
            const sm = skillMapRef.current;
            const entries = Object.entries(sm).filter(
                ([, state]) => !state.loading && state.skills.length > 0,
            );
            if (entries.length === 0) return undefined;
            const result: Record<string, ClientSkillItem[]> = {};
            for (const [cap, state] of entries) {
                result[cap] = state.skills.map(s => ({ name: s.name, description: s.description }));
            }
            return result;
        };

        // 注册（传入 canExecute 用于区分 BRIDGE / WEB 客户端类型）
        registerClient(capabilities, getRunningAgents(), canExecute, buildDetectedSkills()).then(result => {
            if (result) {
                setOnlineClients(result.onlineClients);
            }
        });

        // 启动心跳（30 秒间隔）
        const stopFn = startHeartbeat(getRunningAgents);

        return () => {
            stopFn();
        };
    }, [ready, canExecute, startupReady, capabilities]);

    return (
        <AgentCtx.Provider value={{
            ready, canExecute, definitions, bindings, capabilities,
            capabilityStatus, skillMap, modelMap, startupReady, onlineClients, reload,
            manualAgentOverrides, toggleManualAgent,
            userAgentConfigs, reloadUserAgents,
        }}>
            {children}
        </AgentCtx.Provider>
    );
};
