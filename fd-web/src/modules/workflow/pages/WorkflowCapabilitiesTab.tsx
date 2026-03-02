/**
 * 工作流中心 - 执行能力管理页面
 *
 * 功能：Capability 列表展示、开关控制、在线客户端计数
 * 展示每个 Capability 的名称、描述、code、关联 Agent 数量、在线客户端数、内置标签
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { capabilityApi, clientApi } from '../../../shared/services/serverApi';
import type { CapabilityDefinition, ClientRegistration } from '../../../shared/types/server';
import { useAgentContext } from '../../../shared/agents';
import { useToast } from '../../../shared/hooks/useToast';
import { detectCapabilities, type CapabilityDetectResult } from '../../../tauri/bridge';

// ============ 常量 ============

const PROVIDER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    GEMINI_CLI: { label: 'Gemini CLI', color: 'bg-green-500/20 text-green-400' },
    HTTP_API: { label: 'HTTP API', color: 'bg-blue-500/20 text-blue-400' },
    NOTEBOOKLM: { label: 'NotebookLM', color: 'bg-purple-500/20 text-purple-400' },
    NOTEBOOKLM_PY: { label: 'NotebookLM Py', color: 'bg-purple-500/20 text-purple-400' },
    TRACKING_SHADOW: { label: 'Tracking', color: 'bg-teal-500/20 text-teal-400' },
    LOCAL_FUNCTION: { label: 'Function', color: 'bg-amber-500/20 text-amber-400' },
    SHADOW_WINDOW: { label: 'Shadow Window', color: 'bg-purple-500/20 text-purple-400' },
    WEB_AUTOMATION: { label: 'Web Automation', color: 'bg-purple-500/20 text-purple-400' },
    LOCAL_CLI: { label: 'CLI', color: 'bg-green-500/20 text-green-400' },
};

const ENV_LABELS: Record<string, string> = {
    CLIENT_ONLY: 'Client',
    SERVER_ONLY: 'Server',
    BOTH: 'Both',
};

// ============ 工具函数 ============

/** 解析 enabledCapabilities 字段，兼容 JSON 数组字符串和逗号分隔格式 */
function parseEnabledCapabilities(raw: string | undefined | null): string[] {
    if (!raw) return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // 尝试 JSON 数组解析
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map((s: string) => s.trim()).filter(Boolean);
        } catch { /* fallback to comma split */ }
    }
    // 逗号分隔
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

/** 统计每个 capability code 的在线客户端数 */
function buildOnlineCountMap(clients: ClientRegistration[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const client of clients) {
        if (!client.online) continue;
        const caps = parseEnabledCapabilities(client.enabledCapabilities);
        for (const cap of caps) {
            counts[cap] = (counts[cap] || 0) + 1;
        }
    }
    return counts;
}

const ONLINE_CLIENTS_POLL_INTERVAL = 30_000; // 30 秒

// ============ 主组件 ============

const WorkflowCapabilitiesTab: React.FC = () => {
    const { t } = useTranslation(['common']);
    const { toast } = useToast();
    const { definitions: agentDefinitions, reload: reloadAgentContext } = useAgentContext();

    const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<number | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{ capId: number; capName: string; linkedCount: number } | null>(null);

    // 在线客户端数据
    const [onlineCountMap, setOnlineCountMap] = useState<Record<string, number>>({});
    const [onlineClientsLoading, setOnlineClientsLoading] = useState(true);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // 环境检测数据
    const [detectResults, setDetectResults] = useState<Record<string, CapabilityDetectResult>>({});
    const [detecting, setDetecting] = useState(false);

    const loadCapabilities = useCallback(async () => {
        setLoading(true);
        try {
            const caps = await capabilityApi.getAllCapabilities();
            setCapabilities(caps.sort((a, b) => a.sortOrder - b.sortOrder));
        } catch (err: any) {
            toast('error', err.message || t('message.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    const loadOnlineClients = useCallback(async (silent = false) => {
        if (!silent) setOnlineClientsLoading(true);
        try {
            const clients = await clientApi.getOnlineClients();
            setOnlineCountMap(buildOnlineCountMap(clients));
        } catch {
            // 静默失败，不打断主流程
        } finally {
            if (!silent) setOnlineClientsLoading(false);
        }
    }, []);

    const runDetection = useCallback(async () => {
        setDetecting(true);
        try {
            const results = await detectCapabilities();
            const map: Record<string, CapabilityDetectResult> = {};
            for (const r of results) {
                map[r.code] = r;
            }
            setDetectResults(map);
        } catch {
            setDetectResults({});
        } finally {
            setDetecting(false);
        }
    }, []);

    useEffect(() => {
        loadCapabilities();
    }, [loadCapabilities]);

    // 挂载时执行一次环境检测
    useEffect(() => {
        runDetection();
    }, [runDetection]);

    // 在线客户端：挂载时获取一次 + 每 30 秒轮询
    useEffect(() => {
        loadOnlineClients();
        pollTimerRef.current = setInterval(() => loadOnlineClients(true), ONLINE_CLIENTS_POLL_INTERVAL);
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [loadOnlineClients]);

    // 计算每个 Capability 关联的 Agent 数量
    const linkedAgentCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const cap of capabilities) {
            counts[cap.code] = agentDefinitions.filter(
                d => d.requiredCapability === cap.code
            ).length;
        }
        return counts;
    }, [capabilities, agentDefinitions]);

    const handleToggle = useCallback(async (cap: CapabilityDefinition) => {
        // 关闭时需要确认
        if (cap.enabled) {
            const linkedCount = linkedAgentCounts[cap.code] || 0;
            setConfirmDialog({
                capId: cap.id,
                capName: cap.name,
                linkedCount,
            });
            return;
        }

        // 开启时直接操作
        setToggling(cap.id);
        try {
            await capabilityApi.toggleCapability(cap.id);
            await loadCapabilities();
            await reloadAgentContext();
            toast('success', t('capability.toggleSuccess'));
        } catch (err: any) {
            toast('error', err.message || t('capability.toggleFailed'));
        } finally {
            setToggling(null);
        }
    }, [linkedAgentCounts, loadCapabilities, reloadAgentContext, t, toast]);

    const confirmToggle = useCallback(async () => {
        if (!confirmDialog) return;

        setToggling(confirmDialog.capId);
        setConfirmDialog(null);
        try {
            await capabilityApi.toggleCapability(confirmDialog.capId);
            await loadCapabilities();
            await reloadAgentContext();
            toast('success', t('capability.toggleSuccess'));
        } catch (err: any) {
            toast('error', err.message || t('capability.toggleFailed'));
        } finally {
            setToggling(null);
        }
    }, [confirmDialog, loadCapabilities, reloadAgentContext, t, toast]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 页面标题 */}
            <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-medium text-slate-200">{t('capability.title')}</h2>
                    <p className="text-sm text-slate-500 mt-1">{t('capability.description')}</p>
                </div>
                <button
                    onClick={runDetection}
                    disabled={detecting}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        detecting
                            ? 'border-slate-600 text-slate-500 cursor-wait'
                            : 'border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                    }`}
                >
                    {detecting ? t('capability.detecting') : t('capability.reDetect')}
                </button>
            </div>

            {/* 能力卡片列表 */}
            <div className="flex-1 overflow-auto p-6">
                {capabilities.length === 0 ? (
                    <div className="text-center text-slate-500 py-16">
                        {t('capability.noCapabilities')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {capabilities.map(cap => (
                            <CapabilityCard
                                key={cap.id}
                                capability={cap}
                                linkedAgentCount={linkedAgentCounts[cap.code] || 0}
                                onlineClientCount={onlineCountMap[cap.code] || 0}
                                onlineClientsLoading={onlineClientsLoading}
                                toggling={toggling === cap.id}
                                onToggle={() => handleToggle(cap)}
                                detectResult={detectResults[cap.code]}
                                detecting={detecting}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 确认对话框 */}
            {confirmDialog && (
                <ConfirmDialog
                    capName={confirmDialog.capName}
                    linkedCount={confirmDialog.linkedCount}
                    onConfirm={confirmToggle}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </div>
    );
};

// ============ 子组件 ============

const CapabilityCard: React.FC<{
    capability: CapabilityDefinition;
    linkedAgentCount: number;
    onlineClientCount: number;
    onlineClientsLoading: boolean;
    toggling: boolean;
    onToggle: () => void;
    detectResult?: CapabilityDetectResult;
    detecting: boolean;
}> = ({ capability, linkedAgentCount, onlineClientCount, onlineClientsLoading, toggling, onToggle, detectResult, detecting }) => {
    const { t } = useTranslation(['common']);
    const providerInfo = PROVIDER_TYPE_LABELS[capability.providerType] || {
        label: capability.providerType,
        color: 'bg-slate-500/20 text-slate-400',
    };
    const envLabel = ENV_LABELS[capability.executionEnv] || capability.executionEnv;

    // 渲染环境检测徽章
    const renderDetectBadge = () => {
        if (detecting) {
            return (
                <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-500 inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                    {t('capability.detecting')}
                </span>
            );
        }
        if (!detectResult) {
            // bridge 不可用或没有该 capability 的检测结果
            return null;
        }
        if (detectResult.available) {
            return (
                <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    {detectResult.version ? `v${detectResult.version}` : t('capability.envAvailable')}
                </span>
            );
        }
        return (
            <span
                className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 inline-flex items-center gap-1 cursor-default"
                title={detectResult.error || capability.installGuide || undefined}
            >
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {t('capability.notInstalled')}
            </span>
        );
    };

    return (
        <div className={`p-4 bg-slate-800/50 border rounded-lg transition-colors ${
            capability.enabled
                ? 'border-slate-700/50'
                : 'border-slate-700/30 opacity-60'
        }`}>
            {/* 顶部：名称 + 开关 */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-slate-200 font-medium">{capability.name}</h3>
                    {capability.builtIn && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            {t('capability.builtIn')}
                        </span>
                    )}
                </div>
                <button
                    onClick={onToggle}
                    disabled={toggling}
                    className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none ${
                        capability.enabled
                            ? 'bg-green-600'
                            : 'bg-slate-600'
                    } ${toggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                    aria-label={capability.enabled ? t('capability.enabled') : t('capability.disabled')}
                >
                    <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                            capability.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                </button>
            </div>

            {/* Code */}
            <code className="text-xs text-slate-500 block mb-2">{capability.code}</code>

            {/* 描述 */}
            {capability.description && (
                <p className="text-sm text-slate-400 mb-3 line-clamp-2">{capability.description}</p>
            )}

            {/* 环境检测不可用时的安装提示 */}
            {detectResult && !detectResult.available && capability.installGuide && (
                <p className="text-xs text-amber-400/80 mb-3 line-clamp-2">
                    {capability.installGuide}
                </p>
            )}

            {/* 底部标签 */}
            <div className="flex items-center flex-wrap gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded ${providerInfo.color}`}>
                    {providerInfo.label}
                </span>
                {/* 环境检测结果徽章 */}
                {renderDetectBadge()}
                {/* 在线客户端计数徽章 */}
                {onlineClientsLoading ? (
                    <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-500 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                        ...
                    </span>
                ) : onlineClientCount > 0 ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {t('capability.onlineClients', { count: onlineClientCount })}
                    </span>
                ) : (
                    <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-500 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                        {t('capability.offline')}
                    </span>
                )}
                <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-400">
                    {envLabel}
                </span>
                <span className={`px-2 py-0.5 rounded ${
                    linkedAgentCount > 0
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'bg-slate-700/50 text-slate-500'
                }`}>
                    {linkedAgentCount > 0
                        ? t('capability.linkedAgents', { count: linkedAgentCount })
                        : t('capability.noLinkedAgents')
                    }
                </span>
                <span className={`px-2 py-0.5 rounded ${
                    capability.enabled
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                }`}>
                    {capability.enabled ? t('capability.enabled') : t('capability.disabled')}
                </span>
            </div>
        </div>
    );
};

const ConfirmDialog: React.FC<{
    capName: string;
    linkedCount: number;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ capName, linkedCount, onConfirm, onCancel }) => {
    const { t } = useTranslation(['common']);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
            <div
                className="bg-slate-800 border border-slate-700 rounded-lg w-[400px] p-6"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="text-slate-200 font-medium mb-3">{t('confirmDialog.defaultTitle')}</h3>
                <p className="text-slate-400 text-sm mb-1">
                    {capName}
                </p>
                <p className="text-slate-400 text-sm mb-6">
                    {linkedCount > 0
                        ? t('capability.confirmDisable', { count: linkedCount })
                        : t('capability.confirmDisableNoAgents')
                    }
                </p>
                <div className="flex items-center justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
                    >
                        {t('confirmDialog.defaultCancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                    >
                        {t('confirmDialog.defaultConfirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkflowCapabilitiesTab;
