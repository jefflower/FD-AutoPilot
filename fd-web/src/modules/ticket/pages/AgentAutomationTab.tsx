import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentContext } from '../../../shared/agents';
import { MQTranslateAgentProvider, useMQTranslateAgent } from '../../../shared/context/MQTranslateAgentContext';
import { MQReplyAgentProvider, useMQReplyAgent } from '../../../shared/context/MQReplyAgentContext';
import { parseAgentConfig } from '../../../shared/agents/schemaUtils';
import { serverApi } from '../../../shared/services/serverApi';
import type { ServerTicket } from '../../../shared/types/server';
import {
    AgentControlBar, AgentCard, AgentDetailPanel,
    initAgentShadow, closeAgentShadow, getShadowStatus,
} from '../components/agent-automation';
import type { AgentConsumerMapping, AgentConsumerHandle, ShadowStatus } from '../components/agent-automation';
import { isTauriEnv, checkBridgeAvailable } from '../../../tauri/bridge';

const UNGROUPED_KEY = '__ungrouped__';

const GROUP_LABELS: Record<string, string> = {
    ticket: '工单处理',
    logistics: '物流服务',
    [UNGROUPED_KEY]: '未分组',
};

/**
 * 用 Ref 持有 consumer handle，避免 context 值频繁变化导致 agentMappings 重算。
 * agentMappings 只依赖 definitions（低频变化），consumer 通过 ref 实时读取。
 */
function useStableConsumerRegistry(
    translate: AgentConsumerHandle,
    reply: AgentConsumerHandle,
) {
    const registryRef = useRef<Record<string, AgentConsumerHandle>>({});
    // 每次渲染时更新 ref，但不触发 useMemo 重算
    registryRef.current = {
        'agent.ticket-translate': translate,
        'agent.ticket-reply': reply,
        'ticket-translate': translate,
        'ticket-reply': reply,
        'translation': translate,
        'reply': reply,
        'llm': translate,
        'knowledge-query': reply,
    };
    return registryRef;
}

const AgentAutomationTabInner: React.FC = () => {
    const { t: _t } = useTranslation(['tasks', 'common']);
    const { definitions } = useAgentContext();
    const translate = useMQTranslateAgent();
    const reply = useMQReplyAgent();

    // Consumer 注册表用 Ref 避免每次 context 状态变化都重算 agentMappings
    const consumerRegistryRef = useStableConsumerRegistry(translate, reply);

    // agentMappings 仅依赖 definitions（低频变化），不随 MQ context 状态变化而重算
    const agentMappings = useMemo((): AgentConsumerMapping[] => {
        return definitions
            .filter(d => d.enabled)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(def => {
                const config = parseAgentConfig(def.agentConfig);
                const taskType = (config as any).taskType;
                return {
                    definition: def,
                    // consumer 通过 getter 延迟读取，避免引用到旧 context 值
                    get consumer() {
                        const reg = consumerRegistryRef.current;
                        return (taskType && reg[taskType])
                            || reg[def.capability]
                            || null;
                    },
                    taskType: taskType || `agent.${def.capability}`,
                };
            });
    }, [definitions, consumerRegistryRef]);

    // 按 groupCode 分组
    const groupedAgents = useMemo(() => {
        const groups: Record<string, AgentConsumerMapping[]> = {};
        for (const m of agentMappings) {
            const key = m.definition.groupCode || UNGROUPED_KEY;
            if (!groups[key]) groups[key] = [];
            groups[key].push(m);
        }
        return groups;
    }, [agentMappings]);

    const groupKeys = useMemo(() => Object.keys(groupedAgents), [groupedAgents]);

    // Shadow Window 状态（用 Ref 读取 agentMappings，避免 effect 随 context 变化频繁重建）
    const [shadowStatuses, setShadowStatuses] = useState<Record<string, ShadowStatus>>({});
    const agentMappingsRef = useRef(agentMappings);
    agentMappingsRef.current = agentMappings;

    useEffect(() => {
        const refresh = async () => {
            const mappings = agentMappingsRef.current;
            const statuses: Record<string, ShadowStatus> = {};
            for (const m of mappings) {
                // 只有 requiredCapability === 'notebooklm'（原始 shadow window 模式）才需要 shadow window
                const rc = m.definition.requiredCapability;
                if (rc === 'notebooklm') {
                    statuses[m.definition.code] = await getShadowStatus(m.definition);
                }
            }
            // 避免相同值触发不必要的重渲染
            setShadowStatuses(prev => {
                const keys = Object.keys(statuses);
                if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] === statuses[k])) {
                    return prev; // 值未变，返回旧引用
                }
                return statuses;
            });
        };
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, []); // 空依赖：只在挂载时创建一次定时器

    // 选中状态
    const [selectedAgentCode, setSelectedAgentCode] = useState<string | null>(null);
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    useEffect(() => {
        if (selectedTicketId) {
            serverApi.ticket.getTicketById(selectedTicketId).then(setSelectedTicket).catch(console.error);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId]);

    const selectedMapping = useMemo(
        () => agentMappings.find(m => m.definition.code === selectedAgentCode) ?? null,
        [agentMappings, selectedAgentCode],
    );

    // 启动前环境预检查 + 启动消费者
    const [startupError, setStartupError] = useState<string | null>(null);

    const startAgent = useCallback(async (mapping: AgentConsumerMapping) => {
        setStartupError(null);
        const rc = mapping.definition.requiredCapability;

        // 浏览器模式预检查：所有需要本地执行的 capability（含 -cli / -py 后缀）都需要 bridge
        if (!isTauriEnv() && rc) {
            const needsBridge = rc.endsWith('-cli') || rc.endsWith('-py');
            if (needsBridge) {
                const bridgeOk = await checkBridgeAvailable();
                if (!bridgeOk) {
                    const errMsg = `Agent "${mapping.definition.name}" (capability: ${rc}) 需要 fd-bridge 服务。请执行: cargo run --bin fd-bridge --no-default-features --manifest-path fd-client/src-tauri/Cargo.toml`;
                    setStartupError(errMsg);
                    setShowLogs(true);
                    return;
                }
            }
        }

        await initAgentShadow(mapping.definition);
        mapping.consumer?.startConsumer(mapping.definition.code);
        setShowLogs(true); // 启动后自动展开日志
    }, []);

    const stopAgent = useCallback(async (mapping: AgentConsumerMapping) => {
        mapping.consumer?.stopConsumer();
        await closeAgentShadow(mapping.definition);
    }, []);

    // 运行统计直接从 context 读取，避免依赖 agentMappings（getter 每次渲染已是最新值）
    const runnableAgents = agentMappings.filter(m => m.consumer);
    // 直接读取 context 的 isRunning，确保启动/停止后触发重渲染
    const runningCount = [translate.isRunning, reply.isRunning].filter(Boolean).length;
    const runnableCount = runnableAgents.length;
    const allRunning = runnableCount > 0 && runningCount === runnableCount;

    const handleStartAll = useCallback(async () => {
        setStartupError(null);
        const skipped: string[] = [];
        const isWeb = !isTauriEnv();

        for (const m of agentMappings) {
            if (!m.consumer || m.consumer.isRunning) continue;

            // 浏览器模式：需要 bridge 的 capability 检查可用性
            const rc = m.definition.requiredCapability;
            if (isWeb && rc) {
                const needsBridge = rc.endsWith('-cli') || rc.endsWith('-py');
                if (needsBridge) {
                    const bridgeOk = await checkBridgeAvailable();
                    if (!bridgeOk) {
                        skipped.push(`${m.definition.name} (需要 fd-bridge)`);
                        continue;
                    }
                }
            }
            await startAgent(m);
        }

        if (skipped.length > 0) {
            setStartupError(`以下 Agent 在浏览器模式不可用，已跳过: ${skipped.join(', ')}`);
        }
        setShowLogs(true);
    }, [agentMappings, startAgent]);

    const handleStopAll = useCallback(async () => {
        for (const m of agentMappings) {
            if (m.consumer?.isRunning) await stopAgent(m);
        }
    }, [agentMappings, stopAgent]);

    // 合并日志：直接依赖 logs 数组（低成本拼接，无需通过 agentMappings 中转）
    const combinedLogs = useMemo(() => {
        const translateLogs = translate.logs.map(l => `[Translate] ${l}`);
        const replyLogs = reply.logs.map(l => `[Reply] ${l}`);
        return [...translateLogs, ...replyLogs].slice(-50);
    }, [translate.logs, reply.logs]);

    const [showLogs, setShowLogs] = useState(false);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <AgentControlBar
                runningCount={runningCount}
                totalCount={runnableCount}
                allRunning={allRunning}
                onStartAll={handleStartAll}
                onStopAll={handleStopAll}
            />

            <div className="flex-1 flex overflow-hidden">
                {/* 左侧 Agent 列表（按 groupCode 分组） */}
                <div className="w-80 flex-shrink-0 flex flex-col border-r border-slate-700/50 overflow-y-auto">
                    <div className="p-2 space-y-3">
                        {groupKeys.map(groupKey => (
                            <div key={groupKey}>
                                {/* 分组标题 */}
                                <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        {GROUP_LABELS[groupKey] || groupKey}
                                    </span>
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-slate-700/40 text-slate-500">
                                        {groupedAgents[groupKey].length}
                                    </span>
                                    <div className="flex-1 border-t border-slate-700/30" />
                                </div>
                                {/* 分组内 Agent 卡片 */}
                                <div className="space-y-2">
                                    {groupedAgents[groupKey].map(mapping => (
                                        <AgentCard
                                            key={mapping.definition.code}
                                            mapping={mapping}
                                            selected={selectedAgentCode === mapping.definition.code}
                                            onSelect={() => { setSelectedAgentCode(mapping.definition.code); setSelectedTicketId(null); }}
                                            onStart={() => startAgent(mapping)}
                                            onStop={() => stopAgent(mapping)}
                                            shadowStatus={shadowStatuses[mapping.definition.code]}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                        {agentMappings.length === 0 && (
                            <div className="text-xs text-slate-600 text-center py-8">
                                暂无可用 Agent
                            </div>
                        )}
                    </div>
                </div>

                {/* 右侧详情 */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <AgentDetailPanel
                        selectedMapping={selectedMapping}
                        selectedTicketId={selectedTicketId}
                        selectedTicket={selectedTicket}
                        onSelectTicket={setSelectedTicketId}
                        onRefreshTicket={() => {
                            if (selectedTicketId) serverApi.ticket.getTicketById(selectedTicketId).then(setSelectedTicket).catch(console.error);
                        }}
                    />
                </div>
            </div>

            {/* 启动错误提示 */}
            {startupError && (
                <div className="mx-4 mt-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/30">
                    <div className="flex items-start gap-2">
                        <span className="text-red-400 text-xs flex-shrink-0 mt-0.5">&#x26A0;</span>
                        <div>
                            <p className="text-xs text-red-300">{startupError}</p>
                            <button
                                onClick={() => setStartupError(null)}
                                className="text-[10px] text-red-500 hover:text-red-400 mt-1 underline"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 日志面板 */}
            <div className="border-t border-slate-700/50">
                <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-300 transition-colors bg-slate-800/30"
                >
                    <span className="font-bold uppercase tracking-wide flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                        Logs ({combinedLogs.length})
                    </span>
                    <svg
                        className={`w-3 h-3 transition-transform ${showLogs ? '' : 'rotate-180'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                </button>
                {showLogs && (
                    <div className="h-32 overflow-y-auto bg-black/20 px-4 py-2 space-y-0.5 font-mono text-[10px]">
                        {combinedLogs.length === 0 ? (
                            <div className="text-slate-700 italic">No logs yet</div>
                        ) : combinedLogs.map((log, idx) => (
                            <div key={idx} className="text-slate-500">{log}</div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * AgentAutomationTab — 自包含 MQ Provider，不再依赖全局 Provider 链。
 * MQTranslateAgentProvider 和 MQReplyAgentProvider 仅在此 Tab 挂载时激活。
 */
const AgentAutomationTab: React.FC = () => (
    <MQTranslateAgentProvider>
        <MQReplyAgentProvider>
            <AgentAutomationTabInner />
        </MQReplyAgentProvider>
    </MQTranslateAgentProvider>
);

export default AgentAutomationTab;
