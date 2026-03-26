/**
 * 工作流中心 - Agent 市场页面
 *
 * 功能：Agent 分组展示、订阅、CRUD、inputSchema/outputSchema 编辑、Provider 配置
 * 从管理后台 AgentManageTab 迁移并增强
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { agentApi, clientApi } from '../../../shared/services/serverApi';
import { userAgentApi } from '../../../shared/services/api/agent';
import type { AgentDefinition, AgentInstance, ClientRegistration } from '../../../shared/types/server';
import { useAgentContext } from '../../../shared/agents';
import type { CapabilityDetectResult } from '../../../tauri/bridge';
import AgentExecLogPanel from '../../../shared/components/AgentExecLogPanel';
import { AgentEditModal } from '../components/AgentEditModal';

// ============ 模块定义 ============

import { Headphones, Settings, Check, Plus } from 'lucide-react';

const MODULE_DEFS = [
    { code: 'ticket', name: '工单中心', icon: Headphones },
    { code: 'admin', name: '管理后台', icon: Settings },
] as const;

type ModuleFilter = 'all' | 'ticket' | 'admin' | '__ungrouped__';

// ============ 常量 ============

const UNGROUPED_KEY = '__ungrouped__';

// ============ 主组件 ============

const WorkflowAgentsTab: React.FC = () => {
    const { t } = useTranslation(['common']);
    const { reload: reloadAgentContext, capabilities, capabilityStatus, canExecute } = useAgentContext();

    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [groupCodes, setGroupCodes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [operating, setOperating] = useState<number | null>(null);

    // 订阅状态
    const [subscribedCodes, setSubscribedCodes] = useState<Set<string>>(new Set());

    // 模块筛选
    const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');

    // 分组折叠状态
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // 编辑弹窗
    const [editingDef, setEditingDef] = useState<Partial<AgentDefinition> | null>(null);
    const [saving, setSaving] = useState(false);

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    const loadDefinitions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [defs, groups] = await Promise.all([
                agentApi.getAllDefinitions(),
                agentApi.getGroupCodes(),
            ]);
            setDefinitions(defs);
            setGroupCodes(groups);
        } catch (err: any) {
            setError(err.message || '加载 Agent 列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDefinitions();
    }, [loadDefinitions]);

    // 加载当前用户订阅的 Agent 列表
    useEffect(() => {
        userAgentApi.getUserAgentCodes().then(codes => setSubscribedCodes(new Set(codes))).catch(() => {});
    }, []);

    // 按模块筛选后的 definitions
    const filteredDefinitions = useMemo(() => {
        if (moduleFilter === 'all') return definitions;
        if (moduleFilter === UNGROUPED_KEY) return definitions.filter(d => !d.groupCode);
        return definitions.filter(d => d.groupCode === moduleFilter);
    }, [definitions, moduleFilter]);

    // 按 groupCode 分组
    const groupedDefinitions = useMemo(() => {
        const groups: Record<string, AgentDefinition[]> = {};
        for (const def of filteredDefinitions) {
            const key = def.groupCode || UNGROUPED_KEY;
            if (!groups[key]) groups[key] = [];
            groups[key].push(def);
        }
        // 每组按 sortOrder 排序
        for (const key of Object.keys(groups)) {
            groups[key].sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return groups;
    }, [filteredDefinitions]);

    // 分组键排序：有名称的组在前，未分组在最后
    const sortedGroupKeys = useMemo(() => {
        const keys = Object.keys(groupedDefinitions);
        return keys.sort((a, b) => {
            if (a === UNGROUPED_KEY) return 1;
            if (b === UNGROUPED_KEY) return -1;
            return a.localeCompare(b);
        });
    }, [groupedDefinitions]);

    const toggleGroupCollapse = (groupKey: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    };

    const handleToggle = async (id: number) => {
        setOperating(id);
        try {
            await agentApi.toggleDefinition(id);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.operationSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setOperating(null);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('确定要删除这个 Agent 定义吗？此操作不可撤销。')) return;
        setOperating(id);
        try {
            await agentApi.deleteDefinition(id);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.operationSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setOperating(null);
        }
    };

    const handleSaveDef = async () => {
        if (!editingDef) return;
        setSaving(true);
        try {
            const payload: any = { ...editingDef };

            // systemPrompt 已经是独立字段，直接发送

            // agentConfig: 对象需要序列化为字符串（排除 systemPrompt 避免冗余）
            if (typeof payload.agentConfig === 'object' && payload.agentConfig !== null) {
                const { systemPrompt: _removed, ...cleanConfig } = payload.agentConfig;
                payload.agentConfig = JSON.stringify(cleanConfig);
            }
            // inputSchema: 对象需要序列化为字符串
            if (typeof payload.inputSchema === 'object' && payload.inputSchema !== null) {
                payload.inputSchema = JSON.stringify(payload.inputSchema);
            }
            // outputSchema: 对象需要序列化为字符串
            if (typeof payload.outputSchema === 'object' && payload.outputSchema !== null) {
                payload.outputSchema = JSON.stringify(payload.outputSchema);
            }

            if (editingDef.id) {
                await agentApi.updateDefinition(editingDef.id, payload);
            } else {
                await agentApi.createDefinition(payload);
            }
            setEditingDef(null);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.saveSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSubscribe = async (agentCode: string) => {
        try {
            await userAgentApi.subscribe(agentCode);
            setSubscribedCodes(prev => new Set([...prev, agentCode]));
            showSuccess(`已订阅 ${agentCode}`);
        } catch (err: any) {
            setError(err.message || '订阅失败');
        }
    };

    const handleCreate = () => {
        setEditingDef({
            code: '',
            name: '',
            description: '',
            capability: '',
            groupCode: '',
            systemPrompt: '',
            agentConfig: {},
            inputSchema: undefined,
            outputSchema: undefined,
            enabled: true,
            sortOrder: 0,
        });
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 消息提示 */}
            {error && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
                </div>
            )}
            {successMsg && (
                <div className="mx-4 mt-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
                    {successMsg}
                </div>
            )}

            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-700/50">
                <div>
                    <h2 className="text-slate-200 font-medium text-lg">Agent 市场</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        浏览和订阅 AI Agent，管理定义与配置
                    </p>
                </div>
                <button
                    onClick={handleCreate}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                >
                    + 新建 Agent
                </button>
            </div>

            {/* 模块筛选器 */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-2">
                <button
                    onClick={() => setModuleFilter('all')}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                        moduleFilter === 'all'
                            ? 'bg-blue-500/20 text-blue-400 font-medium'
                            : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                    }`}
                >
                    {t('agent.module.all')}
                    <span className="text-xs opacity-60">({definitions.length})</span>
                </button>
                {MODULE_DEFS.map(mod => {
                    const count = definitions.filter(d => d.groupCode === mod.code).length;
                    const Icon = mod.icon;
                    return (
                        <button
                            key={mod.code}
                            onClick={() => setModuleFilter(mod.code as ModuleFilter)}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                                moduleFilter === mod.code
                                    ? 'bg-blue-500/20 text-blue-400 font-medium'
                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {t(`agent.module.${mod.code}`)}
                            <span className="text-xs opacity-60">({count})</span>
                        </button>
                    );
                })}
                <button
                    onClick={() => setModuleFilter(UNGROUPED_KEY as ModuleFilter)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                        moduleFilter === UNGROUPED_KEY
                            ? 'bg-blue-500/20 text-blue-400 font-medium'
                            : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                    }`}
                >
                    {t('agent.module.ungrouped')}
                    <span className="text-xs opacity-60">({definitions.filter(d => !d.groupCode).length})</span>
                </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <LoadingSpinner />
                ) : filteredDefinitions.length === 0 ? (
                    <div className="text-center text-slate-500 py-12">
                        {moduleFilter === 'all' ? '暂无 Agent 定义' : t('agent.noAgentsInModule')}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {sortedGroupKeys.map(groupKey => {
                            const agents = groupedDefinitions[groupKey];
                            const isCollapsed = collapsedGroups.has(groupKey);
                            const moduleDef = MODULE_DEFS.find(m => m.code === groupKey);
                            const groupLabel = groupKey === UNGROUPED_KEY
                                ? t('agent.module.ungrouped')
                                : (moduleDef ? t(`agent.module.${moduleDef.code}`) : groupKey);

                            return (
                                <div key={groupKey} className="border border-slate-700/50 rounded-lg overflow-hidden">
                                    {/* 分组标题 */}
                                    <button
                                        onClick={() => toggleGroupCollapse(groupKey)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/70 hover:bg-slate-800 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-2">
                                            <svg
                                                className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                            <span className="text-slate-300 font-medium text-sm">{groupLabel}</span>
                                            <span className="text-xs text-slate-500">({agents.length})</span>
                                        </div>
                                    </button>

                                    {/* 分组内 Agent 列表 */}
                                    {!isCollapsed && (
                                        <div className="divide-y divide-slate-700/30">
                                            {agents.map(def => (
                                                <AgentCard
                                                    key={def.id}
                                                    def={def}
                                                    operating={operating}
                                                    onToggle={handleToggle}
                                                    onDelete={handleDelete}
                                                    onEdit={() => setEditingDef({ ...def })}
                                                    subscribed={subscribedCodes.has(def.code)}
                                                    onSubscribe={handleSubscribe}
                                                    capabilityStatus={capabilityStatus}
                                                    canExecute={canExecute}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 编辑弹窗 */}
            {editingDef && (
                <AgentEditModal
                    def={editingDef}
                    groupCodes={groupCodes}
                    capabilities={capabilities}
                    onChange={setEditingDef}
                    onSave={handleSaveDef}
                    onCancel={() => setEditingDef(null)}
                    saving={saving}
                />
            )}
        </div>
    );
};

// ============ 数据类型：合并 Instance + Client 信息 ============

interface EnrichedInstance {
    id: number;
    clientId: string;
    userId: string;
    agentCode: string;
    localConfig?: string;
    running: boolean;
    lastHeartbeat?: string;
    version?: string;
    createdAt: string;
    // 来自 ClientRegistration 的附加信息
    clientType?: string;
    online: boolean;
}

// ============ Agent 卡片组件 ============

const AgentCard: React.FC<{
    def: AgentDefinition;
    operating: number | null;
    onToggle: (id: number) => void;
    onDelete: (id: number) => void;
    onEdit: () => void;
    subscribed: boolean;
    onSubscribe: (agentCode: string) => void;
    capabilityStatus: CapabilityDetectResult[];
    canExecute: boolean;
}> = ({ def, operating, onToggle, onDelete, onEdit, subscribed, onSubscribe, capabilityStatus, canExecute }) => {
    const { t } = useTranslation(['common']);
    const [expanded, setExpanded] = useState(false);
    const [expandedTab, setExpandedTab] = useState<'instances' | 'logs'>('instances');
    const [instances, setInstances] = useState<EnrichedInstance[]>([]);
    const [loadingInstances, setLoadingInstances] = useState(false);
    const [tooltipClientId, setTooltipClientId] = useState<string | null>(null);

    // 当展开时加载实例列表：同时请求 agentInstances 和 onlineClients，然后合并
    useEffect(() => {
        if (!expanded) return;
        setLoadingInstances(true);

        Promise.all([
            agentApi.getInstancesByAgent(def.code).catch(() => [] as AgentInstance[]),
            clientApi.getOnlineClients().catch(() => [] as ClientRegistration[]),
        ])
            .then(([agentInstances, onlineClients]) => {
                // 建立 clientId → ClientRegistration 的映射
                const clientMap = new Map<string, ClientRegistration>();
                for (const c of onlineClients) {
                    clientMap.set(c.clientId, c);
                }

                if (agentInstances.length > 0) {
                    // 使用后端返回的 AgentInstance，合并 ClientRegistration 中的附加信息
                    const enriched: EnrichedInstance[] = agentInstances.map(inst => {
                        const client = clientMap.get(inst.clientId);
                        return {
                            id: inst.id,
                            clientId: inst.clientId,
                            userId: inst.userId,
                            agentCode: inst.agentCode,
                            localConfig: inst.localConfig,
                            running: inst.running,
                            lastHeartbeat: inst.lastHeartbeat,
                            version: inst.version || client?.version,
                            createdAt: inst.createdAt,
                            clientType: client?.clientType,
                            online: client?.online ?? false,
                        };
                    });
                    setInstances(enriched);
                } else {
                    // 回退：从在线客户端中过滤
                    const fallback: EnrichedInstance[] = onlineClients
                        .filter(c => {
                            const caps = (c.enabledCapabilities || '').split(',').map(s => s.trim());
                            return caps.includes(def.capability) || caps.includes(def.code);
                        })
                        .map(c => ({
                            id: 0,
                            clientId: c.clientId,
                            userId: c.userId,
                            agentCode: def.code,
                            running: c.online,
                            lastHeartbeat: c.lastHeartbeat,
                            version: c.version,
                            createdAt: c.createdAt,
                            clientType: c.clientType,
                            online: c.online,
                        }));
                    setInstances(fallback);
                }
            })
            .finally(() => setLoadingInstances(false));
    }, [expanded, def.code, def.capability]);

    const onlineCount = instances.filter(i => i.online || i.running).length;
    const totalCount = instances.length;
    const hasLocalConfig = instances.some(i => !!i.localConfig);

    return (
        <div className={`transition-colors ${
            def.enabled
                ? 'bg-slate-800/30'
                : 'bg-slate-900/30 opacity-60'
        }`}>
            <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-200 font-medium text-sm">{def.name}</span>
                            <code className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{def.code}</code>
                            {def.builtIn && <span className="text-xs text-slate-600 italic">built-in</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                            {def.description && <span>{def.description}</span>}
                            {def.description && def.capability && <span>-</span>}
                            {def.capability && (
                                <span>
                                    capability: <code className="text-slate-400">{def.capability}</code>
                                </span>
                            )}
                            {def.requiredCapability && (
                                <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-1 rounded">
                                    requires: {def.requiredCapability}
                                </span>
                            )}
                            {def.inputSchema && (
                                <span className="text-cyan-500/70 text-[10px] bg-cyan-500/10 px-1 rounded">inputSchema</span>
                            )}
                            {def.outputSchema && (
                                <span className="text-cyan-500/70 text-[10px] bg-cyan-500/10 px-1 rounded">outputSchema</span>
                            )}
                            {def.autoStart && (
                                <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1 rounded">自动启动</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        {/* 订阅按钮 + Capability 可用性警告 */}
                        {subscribed ? (
                            <span className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 bg-emerald-500/10 rounded">
                                <Check className="w-3 h-3" />
                                已订阅
                            </span>
                        ) : (
                            <button
                                onClick={() => onSubscribe(def.code)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                                订阅
                            </button>
                        )}
                        {canExecute && def.requiredCapability && !capabilityStatus.find(c => c.code === def.requiredCapability && c.available) && (
                            <span className="text-[10px] text-amber-400" title={`当前客户端缺少 ${def.requiredCapability} 能力`}>
                                &#9888;
                            </span>
                        )}
                        {/* 实例总览按钮 */}
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="px-2 py-1 text-xs rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-300 transition-colors flex items-center gap-1.5"
                            title={t('common:agentInstance.title')}
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                            {expanded ? (
                                <>
                                    <span className={onlineCount > 0 ? 'text-green-400' : 'text-slate-500'}>
                                        {onlineCount}/{totalCount}
                                    </span>
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                    </svg>
                                </>
                            ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            )}
                        </button>
                        <button
                            onClick={() => onToggle(def.id)}
                            disabled={operating === def.id}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                                def.enabled
                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                            }`}
                        >
                            {def.enabled ? t('common:capability.enabled') : t('common:capability.disabled')}
                        </button>
                        <button
                            onClick={onEdit}
                            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors"
                        >
                            {t('common:button.edit')}
                        </button>
                        {!def.builtIn && (
                            <button
                                onClick={() => onDelete(def.id)}
                                disabled={operating === def.id}
                                className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
                            >
                                {t('common:button.delete')}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* 展开的面板（实例总览 / 执行日志） */}
            {expanded && (
                <div className="px-4 pb-3 border-t border-slate-700/30">
                    {/* Tab 切换 */}
                    <div className="flex items-center gap-1 mt-2 mb-2">
                        <button
                            onClick={() => setExpandedTab('instances')}
                            className={`text-xs px-2.5 py-1 rounded transition-colors ${
                                expandedTab === 'instances'
                                    ? 'bg-blue-500/20 text-blue-300 font-medium'
                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                            }`}
                        >
                            {t('common:agentInstance.instanceOverview')}
                        </button>
                        <button
                            onClick={() => setExpandedTab('logs')}
                            className={`text-xs px-2.5 py-1 rounded transition-colors ${
                                expandedTab === 'logs'
                                    ? 'bg-blue-500/20 text-blue-300 font-medium'
                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                            }`}
                        >
                            执行日志
                        </button>
                    </div>

                    {/* 实例总览 */}
                    {expandedTab === 'instances' && (
                        <div>
                            {/* 标题行：在线/总数统计 */}
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs text-slate-400 font-medium flex items-center gap-2">
                                    {hasLocalConfig && (
                                        <span title={t('common:agentInstance.hasLocalConfig')}>
                                            <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                        </span>
                                    )}
                                </h4>
                                {!loadingInstances && totalCount > 0 && (
                                    <span className="text-xs text-slate-500">
                                        <span className={onlineCount > 0 ? 'text-green-400' : 'text-slate-500'}>
                                            {onlineCount}
                                        </span>
                                        {' '}{t('common:agentInstance.onlineSlash')}{' '}
                                        {totalCount} {t('common:agentInstance.totalInstances')}
                                    </span>
                                )}
                            </div>

                            {loadingInstances ? (
                                <div className="flex items-center gap-2 py-2">
                                    <div className="animate-spin rounded-full h-3 w-3 border border-slate-600 border-t-blue-400" />
                                    <span className="text-xs text-slate-500">{t('common:button.loading')}</span>
                                </div>
                            ) : instances.length === 0 ? (
                                <div className="text-xs text-slate-600 py-2">
                                    {t('common:agentInstance.noInstances')}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {instances.map((inst, idx) => {
                                        const isOnline = inst.online || inst.running;
                                        return (
                                            <div key={`${inst.clientId}-${idx}`}
                                                className={`flex items-center justify-between px-3 py-2 rounded text-xs transition-colors ${
                                                    isOnline
                                                        ? 'bg-green-500/5 border border-green-500/20'
                                                        : 'bg-slate-800/50 border border-slate-700/30'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {/* 在线状态指示点 */}
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                                        isOnline ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]' : 'bg-slate-600'
                                                    }`} />

                                                    {/* clientId（截断 + tooltip） */}
                                                    <div
                                                        className="relative"
                                                        onMouseEnter={() => setTooltipClientId(inst.clientId)}
                                                        onMouseLeave={() => setTooltipClientId(null)}
                                                    >
                                                        <code className="text-slate-300 cursor-default">
                                                            {inst.clientId.length > 12
                                                                ? `${inst.clientId.slice(0, 12)}...`
                                                                : inst.clientId}
                                                        </code>
                                                        {/* Tooltip */}
                                                        {tooltipClientId === inst.clientId && inst.clientId.length > 12 && (
                                                            <div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded shadow-lg text-xs text-slate-200 whitespace-nowrap z-10">
                                                                {inst.clientId}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* clientType badge */}
                                                    {inst.clientType && (
                                                        <ClientTypeBadge type={inst.clientType} />
                                                    )}

                                                    {/* 版本号 */}
                                                    {inst.version && (
                                                        <span className="text-slate-500">v{inst.version}</span>
                                                    )}

                                                    {/* localConfig 配置图标 */}
                                                    {inst.localConfig && (
                                                        <span title={t('common:agentInstance.hasLocalConfig')}>
                                                            <svg className="w-3 h-3 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            </svg>
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-3 flex-shrink-0">
                                                    {/* 在线/离线状态文字 */}
                                                    <span className={isOnline ? 'text-green-400 font-medium' : 'text-slate-600'}>
                                                        {isOnline
                                                            ? t('common:agentInstance.online')
                                                            : t('common:agentInstance.offline')}
                                                    </span>

                                                    {/* 最后心跳时间（相对时间） */}
                                                    {inst.lastHeartbeat && (
                                                        <span className="text-slate-500" title={inst.lastHeartbeat}>
                                                            {formatRelativeTime(inst.lastHeartbeat, t)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 执行日志 */}
                    {expandedTab === 'logs' && (
                        <AgentExecLogPanel
                            agentCode={def.code}
                            agentName={def.name}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

// ============ clientType Badge 组件 ============

const CLIENT_TYPE_STYLES: Record<string, string> = {
    TAURI: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    WEB: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    BRIDGE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

const ClientTypeBadge: React.FC<{ type: string }> = ({ type }) => {
    const style = CLIENT_TYPE_STYLES[type.toUpperCase()] || 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    return (
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${style}`}>
            {type}
        </span>
    );
};

/** 将 ISO 时间字符串转为相对时间显示（使用 i18n） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatRelativeTime(isoStr: string, t: any): string {
    try {
        const date = new Date(isoStr);
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return t('time.justNow') as string;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return t('time.minutesAgo', { count: diffMin }) as string;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return t('time.hoursAgo', { count: diffHr }) as string;
        const diffDay = Math.floor(diffHr / 24);
        return t('time.daysAgo', { count: diffDay }) as string;
    } catch {
        return isoStr;
    }
}

const LoadingSpinner: React.FC = () => (
    <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-blue-400" />
    </div>
);

export default WorkflowAgentsTab;
