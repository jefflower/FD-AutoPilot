import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Power, Zap, AlertTriangle, Bot, ArrowRight } from 'lucide-react';
import { userAgentApi } from '../../../shared/services/api/agent';
import { useAgentContext } from '../../../shared/agents/AgentContext';
import { useToast } from '../../../shared/hooks/useToast';
import type { UserAgentConfigDTO } from '../../../shared/types/server';

const MyAgentsTab: React.FC = () => {
    const { reload } = useAgentContext();
    const { toast } = useToast();

    const [agents, setAgents] = useState<UserAgentConfigDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [operating, setOperating] = useState<string | null>(null); // agentCode being operated

    const fetchAgents = useCallback(async () => {
        try {
            setLoading(true);
            const data = await userAgentApi.getUserAgents();
            setAgents(data);
        } catch (err: any) {
            toast('error', '加载失败: ' + (err.message || '未知错误'));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAgents();
    }, [fetchAgents]);

    const handleToggleAutoStart = async (agentCode: string, current: boolean) => {
        if (operating) return;
        setOperating(agentCode);
        try {
            const updated = await userAgentApi.updateConfig(agentCode, { autoStart: !current });
            setAgents(prev => prev.map(a => a.agentCode === agentCode ? { ...a, autoStart: updated.autoStart } : a));
            await reload();
            toast('success', `${agentCode} 自动启动已${!current ? '开启' : '关闭'}`);
        } catch (err: any) {
            toast('error', err.message || '操作失败');
        } finally {
            setOperating(null);
        }
    };

    const handleToggleEnabled = async (agentCode: string, current: boolean) => {
        if (operating) return;
        setOperating(agentCode);
        try {
            const updated = await userAgentApi.updateConfig(agentCode, { enabled: !current });
            setAgents(prev => prev.map(a => a.agentCode === agentCode ? { ...a, enabled: updated.enabled } : a));
            await reload();
            toast('success', `${agentCode} 已${!current ? '启用' : '禁用'}`);
        } catch (err: any) {
            toast('error', err.message || '操作失败');
        } finally {
            setOperating(null);
        }
    };

    const handleUnsubscribe = async (agentCode: string, agentName: string) => {
        if (operating) return;
        if (!window.confirm(`确定退订 "${agentName || agentCode}"？退订后将不再自动执行该 Agent 的任务。`)) return;
        setOperating(agentCode);
        try {
            await userAgentApi.unsubscribe(agentCode);
            setAgents(prev => prev.filter(a => a.agentCode !== agentCode));
            await reload();
            toast('success', `已退订 ${agentName || agentCode}`);
        } catch (err: any) {
            toast('error', err.message || '退订失败');
        } finally {
            setOperating(null);
        }
    };

    // Toggle Switch 组件
    const Toggle: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; label: string }> = ({ checked, onChange, disabled, label }) => (
        <button
            onClick={onChange}
            disabled={disabled}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            } ${checked ? 'bg-blue-600' : 'bg-slate-600'}`}
            title={label}
        >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                checked ? 'translate-x-4.5' : 'translate-x-0.5'
            }`} />
        </button>
    );

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                <div>
                    <h1 className="text-lg font-semibold text-white">我的 Agent</h1>
                    <p className="text-xs text-slate-400 mt-0.5">管理已订阅的 Agent，配置自动启动和启停状态</p>
                </div>
                <button
                    onClick={fetchAgents}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                    title="刷新"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {agents.length === 0 ? (
                    /* 空状态 */
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Bot className="w-16 h-16 mb-4 opacity-30" />
                        <p className="text-lg font-medium mb-2">还没有订阅任何 Agent</p>
                        <p className="text-sm text-slate-500 mb-4">去 Agent 市场浏览并订阅你需要的 Agent</p>
                        <div className="flex items-center gap-1.5 text-blue-400 text-sm">
                            <span>前往 Agent 市场</span>
                            <ArrowRight className="w-4 h-4" />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 max-w-3xl">
                        {agents.map(agent => (
                            <div
                                key={agent.agentCode}
                                className={`rounded-xl border p-4 transition-all ${
                                    !agent.agentEnabled
                                        ? 'border-amber-500/20 bg-amber-500/5'
                                        : agent.enabled
                                            ? 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600/50'
                                            : 'border-slate-700/30 bg-slate-800/30 opacity-60'
                                }`}
                            >
                                {/* 第一行：名称 + 状态标签 */}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Bot className="w-4 h-4 text-blue-400" />
                                        <span className="text-sm font-medium text-white">{agent.agentName || agent.agentCode}</span>
                                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700/50 text-slate-400 font-mono">
                                            {agent.agentCode}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!agent.agentEnabled && (
                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                                <AlertTriangle className="w-3 h-3" />
                                                全局已禁用
                                            </span>
                                        )}
                                        {agent.requiredCapability && (
                                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300">
                                                {agent.requiredCapability}
                                            </span>
                                        )}
                                        {agent.groupCode && (
                                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                                                {agent.groupCode}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 描述 */}
                                {agent.description && (
                                    <p className="text-xs text-slate-400 mb-3 line-clamp-2">{agent.description}</p>
                                )}

                                {/* 操作行 */}
                                <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
                                    <div className="flex items-center gap-6">
                                        {/* 自动启动 */}
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-3.5 h-3.5 text-slate-500" />
                                            <span className="text-xs text-slate-400">自动启动</span>
                                            <Toggle
                                                checked={agent.autoStart}
                                                onChange={() => handleToggleAutoStart(agent.agentCode, agent.autoStart)}
                                                disabled={operating === agent.agentCode}
                                                label="自动启动"
                                            />
                                        </div>
                                        {/* 启用 */}
                                        <div className="flex items-center gap-2">
                                            <Power className="w-3.5 h-3.5 text-slate-500" />
                                            <span className="text-xs text-slate-400">启用</span>
                                            <Toggle
                                                checked={agent.enabled}
                                                onChange={() => handleToggleEnabled(agent.agentCode, agent.enabled)}
                                                disabled={operating === agent.agentCode}
                                                label="启用"
                                            />
                                        </div>
                                    </div>
                                    {/* 退订 */}
                                    <button
                                        onClick={() => handleUnsubscribe(agent.agentCode, agent.agentName)}
                                        disabled={operating === agent.agentCode}
                                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        退订
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MyAgentsTab;
