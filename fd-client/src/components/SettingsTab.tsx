import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { NotebookLMConfig } from '../types';
import { configApi, adminApi } from '../services/serverApi';

interface SettingsTabProps {
    serverUrl: string;
    setServerUrl: (s: string) => void;
    mqHost: string;
    setMqHost: (s: string) => void;
    mqPort: number;
    setMqPort: (n: number) => void;
    mqUsername: string;
    setMqUsername: (s: string) => void;
    mqPassword: string;
    setMqPassword: (s: string) => void;
    translationLang: string;
    setTranslationLang: (s: string) => void;
    mqQueueTranslation: string;
    setMqQueueTranslation: (s: string) => void;
    mqQueueReply: string;
    setMqQueueReply: (s: string) => void;
    mqQueueAudit: string;
    setMqQueueAudit: (s: string) => void;
    mqQueueDlq: string;
    setMqQueueDlq: (s: string) => void;
    isAdmin: boolean;
    notebookLMConfig: NotebookLMConfig;
    setNotebookLMConfig: React.Dispatch<React.SetStateAction<NotebookLMConfig>>;
}

const SettingsTab: React.FC<SettingsTabProps> = ({
    serverUrl, setServerUrl,
    mqHost, setMqHost,
    mqPort, setMqPort,
    mqUsername, setMqUsername,
    mqPassword, setMqPassword,
    translationLang, setTranslationLang,
    mqQueueTranslation, setMqQueueTranslation,
    mqQueueReply, setMqQueueReply,
    mqQueueAudit, setMqQueueAudit,
    mqQueueDlq, setMqQueueDlq,
    isAdmin,
    notebookLMConfig, setNotebookLMConfig,
}) => {
    const { t, i18n } = useTranslation(['settings', 'common']);
    const [toasts, setToasts] = useState<string[]>([]);

    // 服务端配置状态
    const [wecomUrl, setWecomUrl] = useState('');
    const [wecomEnabled, setWecomEnabled] = useState(false);
    const [wecomLoading, setWecomLoading] = useState(false);
    const [wecomTesting, setWecomTesting] = useState(false);
    const [configLoaded, setConfigLoaded] = useState(false);

    // 队列管理状态
    const [showPurgeDialog, setShowPurgeDialog] = useState(false);
    const [purgePassword, setPurgePassword] = useState('');
    const [purgeLoading, setPurgeLoading] = useState(false);
    const [purgeResult, setPurgeResult] = useState<{ purgedMessages: number; resetTickets: number } | null>(null);

    // NotebookLM Selectors 状态
    const [selectors, setSelectors] = useState<Record<string, string> | null>(null);
    const [selectorsLoading, setSelectorsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadSelectors = useCallback(async () => {
        try {
            const data = await invoke('get_notebook_selectors_cmd') as Record<string, string>;
            setSelectors(data);
        } catch {
            setToasts(prev => [...prev, t('settings:selectors.loadFailed')]);
        }
    }, [t]);

    useEffect(() => {
        loadSelectors();
    }, [loadSelectors]);

    const handleResetSelectors = async () => {
        setSelectorsLoading(true);
        try {
            const defaults = await invoke('reset_notebook_selectors_cmd') as Record<string, string>;
            setSelectors(defaults);
            setToasts(prev => [...prev, t('settings:selectors.resetSuccess')]);
        } catch (err) {
            setToasts(prev => [...prev, t('settings:selectors.resetFailed', { error: (err as Error).message })]);
        } finally {
            setSelectorsLoading(false);
        }
    };

    const handleUploadSelectors = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string);
                if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
                await invoke('save_notebook_selectors_cmd', { selectors: parsed });
                setSelectors(parsed);
                setToasts(prev => [...prev, t('settings:selectors.uploadSuccess')]);
            } catch {
                setToasts(prev => [...prev, t('settings:selectors.uploadInvalid')]);
            }
        };
        reader.readAsText(file);
        // 重置 input 以便重复上传同一文件
        e.target.value = '';
    };

    const loadServerConfig = useCallback(async () => {
        try {
            const wecom = await configApi.getWeComWebhook();
            setWecomUrl(wecom.url || '');
            setWecomEnabled(wecom.enabled);
            setConfigLoaded(true);
        } catch {
            // 服务端不可用时静默忽略
        }
    }, []);

    useEffect(() => {
        loadServerConfig();
    }, [loadServerConfig]);

    const handleSaveWecom = async () => {
        setWecomLoading(true);
        try {
            await configApi.setWeComWebhook(wecomUrl, wecomEnabled);
            setToasts(prev => [...prev, t('settings:wecom.saveSuccess')]);
        } catch (err) {
            setToasts(prev => [...prev, t('common:message.saveFailed', { error: (err as Error).message })]);
        } finally {
            setWecomLoading(false);
        }
    };

    const handleTestWecom = async () => {
        setWecomTesting(true);
        try {
            const result = await configApi.testWeComWebhook();
            if (result.success) {
                setToasts(prev => [...prev, t('settings:wecom.testSuccess')]);
            } else {
                setToasts(prev => [...prev, t('settings:wecom.testFailed')]);
            }
        } catch (err) {
            setToasts(prev => [...prev, t('settings:wecom.testError', { error: (err as Error).message })]);
        } finally {
            setWecomTesting(false);
        }
    };

    const copyExtractScript = () => {
        const script = `/**
 * NotebookLM 配置自动提取工具
 */
(function() {
  console.log('%c🚀 NotebookLM 配置自动提取工具已启动', 'color: #667eea; font-size: 16px; font-weight: bold;');

  const extractedConfig = {
    cookie: document.cookie,
    atToken: null,
    fSid: null,
    notebookId: null,
    apiUrl: null,
    sourceIds: []
  };

  const urlMatch = window.location.pathname.match(/\\/notebook\\/([a-f0-9-]+)/);
  if (urlMatch) extractedConfig.notebookId = urlMatch[1];

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  function parseFReq(data) {
    if (!data) return;
    try {
      const params = new URLSearchParams(data);
      extractedConfig.atToken = params.get('at');
      const fReqStr = params.get('f.req');
      if (fReqStr) {
        const outerArr = JSON.parse(fReqStr);
        if (outerArr[1]) {
          const innerArr = JSON.parse(outerArr[1]);
          const sources = innerArr[0][0];
          if (Array.isArray(sources)) {
            extractedConfig.sourceIds = sources.map(s => s[0]?.[0]).filter(id => typeof id === 'string');
            console.log('%c🎯 捕获到 ' + extractedConfig.sourceIds.length + ' 个文档源!', 'color: #ecc94b; font-weight: bold;');
          }
          const notebookUuid = innerArr[0][innerArr[0].length - 5];
          if (typeof notebookUuid === 'string' && notebookUuid.includes('-')) {
             console.log('%c📓 捕获到 Notebook 上下文!', 'color: #4299e1; font-weight: bold;');
          }
        }
      }
    } catch (e) {
      console.warn('解析 f.req 失败', e);
    }
  }

  XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(data) {
    const url = this._url;
    if (this._method === 'POST' && url && (url.includes('stream') || url.includes('generate') || url.includes('orchestration'))) {
      console.log('%c✅ 捕获到API请求!', 'color: #48bb78; font-weight: bold;');
      extractedConfig.apiUrl = url;
      try {
        const urlObj = new URL(url, window.location.origin);
        extractedConfig.fSid = urlObj.searchParams.get('f.sid');
        parseFReq(data);
      } catch (e) {}
      setTimeout(() => displayConfig(), 500);
    }
    return originalXHRSend.apply(this, arguments);
  };

  window.fetch = async function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    if (config?.method === 'POST' && url && (url.includes('stream') || url.includes('generate') || url.includes('orchestration'))) {
      console.log('%c✅ 捕获到API请求!', 'color: #48bb78; font-weight: bold;');
      extractedConfig.apiUrl = url;
      try {
        const urlObj = new URL(url, window.location.origin);
        extractedConfig.fSid = urlObj.searchParams.get('f.sid');
        parseFReq(config.body);
      } catch (e) {}
      setTimeout(() => displayConfig(), 500);
    }
    return originalFetch.apply(this, args);
  };

  function displayConfig() {
    console.clear();
    console.log('%c═══════════════════════════════════════', 'color: #667eea; font-weight: bold;');
    console.log('%c🎉 配置信息提取完成!', 'color: #48bb78; font-size: 18px; font-weight: bold;');
    console.log('%c═══════════════════════════════════════', 'color: #667eea; font-weight: bold;');

    const configJson = {
      notebookId: extractedConfig.notebookId,
      fSid: extractedConfig.fSid,
      atToken: extractedConfig.atToken,
      cookie: extractedConfig.cookie,
      sourceIds: extractedConfig.sourceIds
    };

    console.log('');
    console.log('%c📋 配置信息 (已自动复制):', 'color: #4299e1; font-size: 14px; font-weight: bold;');
    console.log(JSON.stringify(configJson, null, 2));
    console.log('');

    navigator.clipboard.writeText(JSON.stringify(configJson, null, 2)).then(() => {
      console.log('%c✅ 已复制到剪贴板!', 'color: #48bb78; font-weight: bold;');
    });

    window.NOTEBOOKLM_CONFIG = configJson;
  }

  console.log('%c⏳ 等待捕获API请求... 请在NotebookLM中发送一条消息', 'color: #4299e1;');
})();`;

        navigator.clipboard.writeText(script).then(() => {
            setToasts(prev => [...prev, t('settings:ai.scriptCopied')]);
        }).catch(err => {
            setToasts(prev => [...prev, t('common:message.copyFailed', { error: err })]);
        });
    };

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-3xl mx-auto w-full">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white mb-1">{t('settings:title')}</h1>
                    <p className="text-slate-400 text-sm">{t('settings:subtitle')}</p>
                </header>

                <div className="space-y-6 pb-12">
                    {/* Language Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-amber-500 rounded-full"></span>
                            {t('settings:language.title')}
                        </h3>
                        <div className="flex gap-3">
                            {[
                                { code: 'zh-CN', label: '简体中文' },
                                { code: 'en-US', label: 'English' },
                            ].map(lang => (
                                <button
                                    key={lang.code}
                                    onClick={() => i18n.changeLanguage(lang.code)}
                                    className={`flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                                        i18n.language === lang.code
                                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                            : 'bg-slate-800/50 border-white/10 text-slate-400 hover:bg-white/10'
                                    }`}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Connection Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                            {t('settings:connection.title')}
                        </h3>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:connection.serverUrl')}</label>
                                <input
                                    type="text"
                                    value={serverUrl}
                                    onChange={(e) => setServerUrl(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                                    placeholder={t('settings:connection.serverUrlPlaceholder')}
                                />
                                <p className="text-[10px] text-slate-500 mt-2">{t('settings:connection.serverUrlHint')}</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:connection.translationLang')}</label>
                                <select
                                    value={translationLang}
                                    onChange={(e) => setTranslationLang(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm appearance-none"
                                >
                                    <option value="cn">{t('settings:connection.langOptionCn')}</option>
                                    <option value="en">{t('settings:connection.langOptionEn')}</option>
                                    <option value="jp">{t('settings:connection.langOptionJp')}</option>
                                </select>
                                <p className="text-[10px] text-slate-500 mt-2">{t('settings:connection.translationLangHint')}</p>
                            </div>
                        </div>
                    </section>

                    {/* MQ Broker Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-cyan-500 rounded-full"></span>
                            {t('settings:mq.title')}
                        </h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:mq.host')}</label>
                                    <input
                                        type="text"
                                        value={mqHost}
                                        onChange={(e) => setMqHost(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        placeholder="localhost"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:mq.port')}</label>
                                    <input
                                        type="number"
                                        value={mqPort}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setMqPort(parseInt(val) || 0);
                                        }}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:mq.username')}</label>
                                    <input
                                        type="text"
                                        value={mqUsername}
                                        onChange={(e) => setMqUsername(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:mq.password')}</label>
                                    <input
                                        type="password"
                                        value={mqPassword}
                                        onChange={(e) => setMqPassword(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* MQ Queue Names */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-cyan-500 rounded-full"></span>
                            MQ 队列配置
                        </h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">翻译队列</label>
                                    <input
                                        type="text"
                                        value={mqQueueTranslation}
                                        onChange={(e) => setMqQueueTranslation(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
                                        placeholder="q.ticket.translation"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">回复队列</label>
                                    <input
                                        type="text"
                                        value={mqQueueReply}
                                        onChange={(e) => setMqQueueReply(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
                                        placeholder="q.ticket.reply"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">审核队列</label>
                                    <input
                                        type="text"
                                        value={mqQueueAudit}
                                        onChange={(e) => setMqQueueAudit(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
                                        placeholder="q.ticket.audit"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">死信队列</label>
                                    <input
                                        type="text"
                                        value={mqQueueDlq}
                                        onChange={(e) => setMqQueueDlq(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
                                        placeholder="q.ticket.dlq"
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-500">修改队列名后需重启 MQ 消费者才能生效</p>
                        </div>
                    </section>

                    {/* AI Engine Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
                                {t('settings:ai.title')}
                            </h3>
                            <button
                                onClick={copyExtractScript}
                                className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-purple-400 text-xs font-medium transition-all flex items-center gap-2"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                {t('settings:ai.scriptHelper')}
                            </button>
                        </div>

                        <div className="space-y-5">
                            <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-lg">
                                <p className="text-[11px] text-purple-200/80 mb-2 flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {t('settings:ai.quickImportHint')}
                                </p>
                                <textarea
                                    className="w-full px-3 py-2 bg-slate-900/50 border border-white/5 rounded text-[10px] text-slate-400 font-mono focus:outline-none focus:border-purple-500/50"
                                    placeholder={t('settings:ai.importPlaceholder')}
                                    rows={1}
                                    onChange={(e) => {
                                        try {
                                            const config = JSON.parse(e.target.value);
                                            if (config.notebookId || config.atToken) {
                                                setNotebookLMConfig(prev => ({ ...prev, ...config }));
                                                e.target.value = '';
                                                setToasts(prev => [...prev, t('settings:ai.importSuccess')]);
                                            }
                                        } catch (err) { }
                                    }}
                                />
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.notebookUrl')}</label>
                                    <input
                                        type="text"
                                        value={notebookLMConfig.notebookUrl || ''}
                                        onChange={(e) => {
                                            const url = e.target.value;
                                            const updates: Partial<NotebookLMConfig> = { notebookUrl: url };
                                            const match = url.match(/\/notebook\/([a-f0-9-]+)/);
                                            if (match) {
                                                updates.notebookId = match[1];
                                            }
                                            setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, ...updates }));
                                        }}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                        placeholder={t('settings:ai.notebookUrlPlaceholder')}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.notebookId')}</label>
                                        <input
                                            type="text"
                                            value={notebookLMConfig.notebookId}
                                            onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, notebookId: e.target.value }))}
                                            className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.fSid')}</label>
                                        <input
                                            type="text"
                                            value={notebookLMConfig.fSid}
                                            onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, fSid: e.target.value }))}
                                            className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.atToken')}</label>
                                <input
                                    type="password"
                                    value={notebookLMConfig.atToken}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, atToken: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.cookie')}</label>
                                <textarea
                                    value={notebookLMConfig.cookie}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, cookie: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                    rows={3}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.sourceIds')}</label>
                                <textarea
                                    value={notebookLMConfig.sourceIds?.join('\n') || ''}
                                    onChange={(e) => {
                                        const ids = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                                        setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, sourceIds: ids }));
                                    }}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                    placeholder={t('settings:ai.sourceIdsPlaceholder')}
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.promptTemplate')}</label>
                                <textarea
                                    value={notebookLMConfig.prompt}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, prompt: e.target.value }))}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    placeholder={t('settings:ai.promptPlaceholder')}
                                    rows={3}
                                />
                            </div>

                            {/* Config Status Indicator */}
                            {notebookLMConfig.cookie && notebookLMConfig.atToken && notebookLMConfig.fSid ? (
                                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                    <span className="text-green-400 text-xs font-medium">{t('settings:ai.configComplete')}</span>
                                </div>
                            ) : (
                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                                    <span className="text-yellow-400 text-xs font-medium">{t('settings:ai.configIncomplete')}</span>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* NotebookLM Selectors */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="w-1 h-4 bg-teal-500 rounded-full"></span>
                            {t('settings:selectors.title')}
                        </h3>
                        <p className="text-[10px] text-slate-500 mb-5">{t('settings:selectors.description')}</p>

                        {selectors && (
                            <pre className="w-full p-4 bg-slate-900/60 border border-white/5 rounded-lg text-[11px] text-slate-400 font-mono overflow-auto max-h-64 mb-5 select-all">
                                {JSON.stringify(selectors, null, 2)}
                            </pre>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={handleResetSelectors}
                                disabled={selectorsLoading}
                                className="px-4 py-2 bg-teal-600/80 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                            >
                                {t('settings:selectors.resetToDefault')}
                            </button>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10"
                            >
                                {t('settings:selectors.uploadConfig')}
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={handleUploadSelectors}
                            />
                        </div>
                    </section>

                    {/* WeChat Work Integration */}
                    {configLoaded && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                                <span className="w-1 h-4 bg-green-500 rounded-full"></span>
                                {t('settings:wecom.title')}
                            </h3>
                            <div className="space-y-5">
                                <div className="flex items-center justify-between p-4 bg-green-500/5 border border-green-500/10 rounded-lg">
                                    <div>
                                        <p className="text-sm text-white font-medium">{t('settings:wecom.enableNotify')}</p>
                                        <p className="text-[10px] text-slate-500 mt-1">{t('settings:wecom.enableNotifyDesc')}</p>
                                    </div>
                                    <button
                                        onClick={() => setWecomEnabled(!wecomEnabled)}
                                        className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                                            wecomEnabled ? 'bg-green-500' : 'bg-slate-600'
                                        }`}
                                    >
                                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                                            wecomEnabled ? 'translate-x-6' : 'translate-x-0.5'
                                        }`} />
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:wecom.webhookUrl')}</label>
                                    <input
                                        type="text"
                                        value={wecomUrl}
                                        onChange={(e) => setWecomUrl(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 font-mono"
                                        placeholder={t('settings:wecom.webhookPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-2">{t('settings:wecom.webhookHint')}</p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleSaveWecom}
                                        disabled={wecomLoading}
                                        className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                    >
                                        {wecomLoading ? t('common:button.saving') : t('settings:wecom.saveConfig')}
                                    </button>
                                    <button
                                        onClick={handleTestWecom}
                                        disabled={wecomTesting || !wecomUrl}
                                        className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10"
                                    >
                                        {wecomTesting ? t('settings:wecom.sending') : t('settings:wecom.sendTestMessage')}
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Queue Management (Admin Only) */}
                    {isAdmin && (
                        <section className="bg-white/5 rounded-xl border border-red-500/20 p-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                                <span className="w-1 h-4 bg-red-500 rounded-full"></span>
                                队列管理
                            </h3>
                            <div className="space-y-4">
                                <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-lg">
                                    <p className="text-xs text-red-200/80 mb-1">清空所有 MQ 队列中的待处理消息，并将处理中的工单状态回退。</p>
                                    <p className="text-[10px] text-slate-500">此操作不可撤销，请谨慎使用。</p>
                                </div>
                                <button
                                    onClick={() => { setShowPurgeDialog(true); setPurgePassword(''); setPurgeResult(null); }}
                                    className="px-5 py-2 bg-red-600/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all"
                                >
                                    重置所有队列
                                </button>
                            </div>

                            {/* Purge Confirmation Dialog */}
                            {showPurgeDialog && (
                                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                                    <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                                        <h4 className="text-lg font-bold text-white mb-4">确认重置队列</h4>
                                        <div className="space-y-4">
                                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                                <p className="text-xs text-red-300 leading-relaxed">
                                                    此操作将：
                                                </p>
                                                <ul className="text-xs text-red-300/80 mt-2 space-y-1 list-disc list-inside">
                                                    <li>清空翻译 / 回复 / 审核 / 死信队列中的所有消息</li>
                                                    <li>回退处理中的工单状态至待处理</li>
                                                </ul>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-400 mb-2">超级密码</label>
                                                <input
                                                    type="password"
                                                    value={purgePassword}
                                                    onChange={(e) => setPurgePassword(e.target.value)}
                                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                                    placeholder="请输入超级密码"
                                                    autoFocus
                                                />
                                            </div>
                                            {purgeResult && (
                                                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                                    <p className="text-xs text-green-300">
                                                        清空了 <span className="font-bold">{purgeResult.purgedMessages}</span> 条消息，回退了 <span className="font-bold">{purgeResult.resetTickets}</span> 个工单
                                                    </p>
                                                </div>
                                            )}
                                            <div className="flex gap-3 justify-end pt-2">
                                                <button
                                                    onClick={() => setShowPurgeDialog(false)}
                                                    className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-all border border-white/10"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        if (!purgePassword) return;
                                                        setPurgeLoading(true);
                                                        try {
                                                            const result = await adminApi.purgeQueues(purgePassword);
                                                            setPurgeResult(result);
                                                            setToasts(prev => [...prev, `队列重置成功：清空 ${result.purgedMessages} 条消息，回退 ${result.resetTickets} 个工单`]);
                                                        } catch (err) {
                                                            setToasts(prev => [...prev, `队列重置失败：${(err as Error).message}`]);
                                                        } finally {
                                                            setPurgeLoading(false);
                                                        }
                                                    }}
                                                    disabled={purgeLoading || !purgePassword}
                                                    className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                                >
                                                    {purgeLoading ? '处理中...' : '确认重置'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>

                {/* Toast Notifications */}
                {toasts.length > 0 && (
                    <div className="fixed bottom-4 right-4 space-y-2 z-50">
                        {toasts.slice(-3).map((msg, i) => (
                            <div key={i} className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-lg px-4 py-2 shadow-2xl animate-fade-in">
                                <span className="text-[11px] text-slate-300 font-medium">{msg}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer Status */}
                <div className="fixed bottom-0 left-0 right-0 p-4 pointer-events-none">
                    <div className="max-w-3xl mx-auto flex justify-end">
                        <div className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-full px-4 py-2 flex items-center gap-2 shadow-2xl">
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            <span className="text-[11px] text-slate-300 font-medium">{t('settings:footer.savedToLocal')}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;
