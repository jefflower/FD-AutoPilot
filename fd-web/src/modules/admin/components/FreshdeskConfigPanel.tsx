import React, { useState, useEffect, useCallback } from 'react';
import { configApi } from '../../../shared/services/serverApi';

const FreshdeskConfigPanel: React.FC = () => {
    const [domain, setDomain] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [configured, setConfigured] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

    useEffect(() => {
        loadConfig();
    }, []);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const loadConfig = async () => {
        try {
            const cfg = await configApi.getFreshdeskConfig();
            setDomain(cfg.domain || '');
            setApiKey(cfg.apiKey || '');
            setConfigured(cfg.configured);
        } catch {
            setToast({ type: 'error', msg: '加载配置失败' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const updates: { domain?: string; apiKey?: string } = {};
            updates.domain = domain;
            // 只在用户修改了 API Key 时才提交（脱敏值包含 ****）
            if (!apiKey.includes('****')) {
                updates.apiKey = apiKey;
            }
            await configApi.setFreshdeskConfig(updates);
            setToast({ type: 'success', msg: 'Freshdesk 配置已保存' });
            // 重新加载以获取最新状态
            await loadConfig();
        } catch (err) {
            setToast({ type: 'error', msg: (err as Error).message });
        } finally {
            setSaving(false);
        }
    }, [domain, apiKey]);

    const handleTest = useCallback(async () => {
        setTesting(true);
        try {
            const result = await configApi.testFreshdeskConnection();
            setToast({
                type: result.success ? 'success' : 'error',
                msg: result.success
                    ? result.message || '连接成功'
                    : result.error || '连接失败',
            });
        } catch (err) {
            setToast({ type: 'error', msg: (err as Error).message });
        } finally {
            setTesting(false);
        }
    }, []);

    if (loading) {
        return (
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6 relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-white">Freshdesk 连接配置</h2>
                        <p className="text-xs text-slate-400">配置 Freshdesk API 连接信息，用于工单同步和回复推送</p>
                    </div>
                </div>
                {/* 配置状态 */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                    configured
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/15 text-red-400 border border-red-500/30'
                }`}>
                    {configured ? (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            已配置
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            未配置
                        </>
                    )}
                </div>
            </div>

            {/* Form */}
            <div className="space-y-4 max-w-lg">
                {/* Domain */}
                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Freshdesk 域名
                    </label>
                    <input
                        type="text"
                        value={domain}
                        onChange={e => setDomain(e.target.value)}
                        placeholder="xxx.freshdesk.com"
                        className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 ring-teal-500/30 focus:border-transparent transition-all"
                    />
                    <p className="text-[10px] text-slate-600 mt-1">例如: mycompany.freshdesk.com</p>
                </div>

                {/* API Key */}
                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                        API Key
                    </label>
                    <div className="relative">
                        <input
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="输入 Freshdesk API Key"
                            className="w-full px-3 py-2 pr-10 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 ring-teal-500/30 focus:border-transparent transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            {showApiKey ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            )}
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">在 Freshdesk 管理后台 → 个人设置 → API Key 获取</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                    <button
                        onClick={handleSave}
                        disabled={saving || !domain}
                        className="px-4 py-2 bg-teal-600/80 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? '保存中...' : '保存配置'}
                    </button>
                    <button
                        onClick={handleTest}
                        disabled={testing || !configured}
                        className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-colors disabled:opacity-30"
                    >
                        {testing ? '测试中...' : '测试连接'}
                    </button>
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg text-xs font-medium shadow-lg transition-all ${
                    toast.type === 'success'
                        ? 'bg-emerald-600/90 text-white'
                        : 'bg-red-600/90 text-white'
                }`}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
};

export default FreshdeskConfigPanel;
