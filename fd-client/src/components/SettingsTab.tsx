import React, { useState, useEffect, useCallback } from 'react';
import { NotebookLMConfig } from '../types';
import { configApi } from '../services/serverApi';

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
    notebookLMConfig, setNotebookLMConfig,
}) => {
    const [toasts, setToasts] = useState<string[]>([]);

    // 服务端配置状态
    const [wecomUrl, setWecomUrl] = useState('');
    const [wecomEnabled, setWecomEnabled] = useState(false);
    const [wecomLoading, setWecomLoading] = useState(false);
    const [wecomTesting, setWecomTesting] = useState(false);
    const [configLoaded, setConfigLoaded] = useState(false);

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
            setToasts(prev => [...prev, '企业微信配置已保存']);
        } catch (err) {
            setToasts(prev => [...prev, `保存失败: ${(err as Error).message}`]);
        } finally {
            setWecomLoading(false);
        }
    };

    const handleTestWecom = async () => {
        setWecomTesting(true);
        try {
            const result = await configApi.testWeComWebhook();
            if (result.success) {
                setToasts(prev => [...prev, '企业微信测试消息发送成功']);
            } else {
                setToasts(prev => [...prev, '企业微信测试消息发送失败']);
            }
        } catch (err) {
            setToasts(prev => [...prev, `测试失败: ${(err as Error).message}`]);
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
            setToasts(prev => [...prev, 'NotebookLM自动提取脚本已复制到剪贴板!']);
        }).catch(err => {
            setToasts(prev => [...prev, `复制失败: ${err}`]);
        });
    };

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-3xl mx-auto w-full">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
                    <p className="text-slate-400 text-sm">Configure your connection and AI preferences</p>
                </header>

                <div className="space-y-6 pb-12">
                    {/* Connection Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                            Connection Settings
                        </h3>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Server URL</label>
                                <input
                                    type="text"
                                    value={serverUrl}
                                    onChange={(e) => setServerUrl(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                                    placeholder="http://localhost:9988"
                                />
                                <p className="text-[10px] text-slate-500 mt-2">FD-Server base URL (default: http://localhost:9988)</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Translation Target Language (MQ/Manual)</label>
                                <select
                                    value={translationLang}
                                    onChange={(e) => setTranslationLang(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm appearance-none"
                                >
                                    <option value="cn">简体中文 (Simplified Chinese)</option>
                                    <option value="en">English (English)</option>
                                    <option value="jp">日本語 (Japanese)</option>
                                </select>
                                <p className="text-[10px] text-slate-500 mt-2">Defines the default language for MQ and manual translations</p>
                            </div>
                        </div>
                    </section>

                    {/* MQ Broker Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-cyan-500 rounded-full"></span>
                            RabbitMQ Broker
                        </h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Host</label>
                                    <input
                                        type="text"
                                        value={mqHost}
                                        onChange={(e) => setMqHost(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        placeholder="localhost"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Port</label>
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
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Username</label>
                                    <input
                                        type="text"
                                        value={mqUsername}
                                        onChange={(e) => setMqUsername(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Password</label>
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

                    {/* AI Engine Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
                                AI Engine (NotebookLM)
                            </h3>
                            <button
                                onClick={copyExtractScript}
                                className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-purple-400 text-xs font-medium transition-all flex items-center gap-2"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                脚本助手
                            </button>
                        </div>

                        <div className="space-y-5">
                            <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-lg">
                                <p className="text-[11px] text-purple-200/80 mb-2 flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    快速导入：在 NotebookLM 页面运行脚本后直接在此粘贴 JSON
                                </p>
                                <textarea
                                    className="w-full px-3 py-2 bg-slate-900/50 border border-white/5 rounded text-[10px] text-slate-400 font-mono focus:outline-none focus:border-purple-500/50"
                                    placeholder="Paste JSON configuration here..."
                                    rows={1}
                                    onChange={(e) => {
                                        try {
                                            const config = JSON.parse(e.target.value);
                                            if (config.notebookId || config.atToken) {
                                                setNotebookLMConfig(prev => ({ ...prev, ...config }));
                                                e.target.value = '';
                                                setToasts(prev => [...prev, '已成功导入 AI 配置']);
                                            }
                                        } catch (err) { }
                                    }}
                                />
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Notebook URL</label>
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
                                        placeholder="https://notebooklm.google.com/notebook/..."
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Notebook ID</label>
                                        <input
                                            type="text"
                                            value={notebookLMConfig.notebookId}
                                            onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, notebookId: e.target.value }))}
                                            className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">F.SID</label>
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
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">AT Token</label>
                                <input
                                    type="password"
                                    value={notebookLMConfig.atToken}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, atToken: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Cookie</label>
                                <textarea
                                    value={notebookLMConfig.cookie}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, cookie: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                    rows={3}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Source IDs (关联文档)</label>
                                <textarea
                                    value={notebookLMConfig.sourceIds?.join('\n') || ''}
                                    onChange={(e) => {
                                        const ids = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                                        setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, sourceIds: ids }));
                                    }}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                    placeholder="Enter Source UUIDs (one per line)"
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">AI Prompt Template</label>
                                <textarea
                                    value={notebookLMConfig.prompt}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, prompt: e.target.value }))}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    placeholder="Template for AI response generation..."
                                    rows={3}
                                />
                            </div>

                            {/* Config Status Indicator */}
                            {notebookLMConfig.cookie && notebookLMConfig.atToken && notebookLMConfig.fSid ? (
                                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                    <span className="text-green-400 text-xs font-medium">NotebookLM Configuration Complete</span>
                                </div>
                            ) : (
                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                                    <span className="text-yellow-400 text-xs font-medium">Please complete NotebookLM configuration</span>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* WeChat Work Integration */}
                    {configLoaded && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                                <span className="w-1 h-4 bg-green-500 rounded-full"></span>
                                WeChat Work (企业微信)
                            </h3>
                            <div className="space-y-5">
                                <div className="flex items-center justify-between p-4 bg-green-500/5 border border-green-500/10 rounded-lg">
                                    <div>
                                        <p className="text-sm text-white font-medium">启用企业微信通知</p>
                                        <p className="text-[10px] text-slate-500 mt-1">审核通过/驳回、回复推送等事件将发送通知到企业微信群</p>
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
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Webhook URL</label>
                                    <input
                                        type="text"
                                        value={wecomUrl}
                                        onChange={(e) => setWecomUrl(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 font-mono"
                                        placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                                    />
                                    <p className="text-[10px] text-slate-500 mt-2">在企业微信群设置中创建机器人获取 Webhook 地址</p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleSaveWecom}
                                        disabled={wecomLoading}
                                        className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                    >
                                        {wecomLoading ? '保存中...' : '保存配置'}
                                    </button>
                                    <button
                                        onClick={handleTestWecom}
                                        disabled={wecomTesting || !wecomUrl}
                                        className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10"
                                    >
                                        {wecomTesting ? '发送中...' : '发送测试消息'}
                                    </button>
                                </div>
                            </div>
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
                            <span className="text-[11px] text-slate-300 font-medium">Settings saved to local vault</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;
