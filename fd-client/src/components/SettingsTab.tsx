import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { NotebookLMConfig } from '../types';

interface SettingsTabProps {
    apiKey: string;
    setApiKey: (s: string) => void;
    outputDir: string;
    setOutputDir: (s: string) => void;
    syncStartDate: string;
    setSyncStartDate: (s: string) => void;
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
    setLogs: (updater: (prev: string[]) => string[]) => void;
}

const SettingsTab: React.FC<SettingsTabProps> = ({
    apiKey, setApiKey,
    outputDir, setOutputDir,
    syncStartDate, setSyncStartDate,
    mqHost, setMqHost,
    mqPort, setMqPort,
    mqUsername, setMqUsername,
    mqPassword, setMqPassword,
    translationLang, setTranslationLang,
    notebookLMConfig, setNotebookLMConfig,
    setLogs
}) => {
    const [showApiKey, setShowApiKey] = useState(false);
    async function selectFolder() {
        try {
            const folder = await open({ directory: true, multiple: false, title: "Select Output Directory" });
            if (folder) setOutputDir(folder as string);
        } catch (error) {
            console.error(error);
        }
    }

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

  const urlMatch = window.location.pathname.match(/\/notebook\/([a-f0-9-]+)/);
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
          // innerArr[0][0] 通常是 source ids 列表 [[["id1"]], [["id2"]]...]
          const sources = innerArr[0][0];
          if (Array.isArray(sources)) {
            extractedConfig.sourceIds = sources.map(s => s[0]?.[0]).filter(id => typeof id === 'string');
            console.log('%c🎯 捕获到 ' + extractedConfig.sourceIds.length + ' 个文档源!', 'color: #ecc94b; font-weight: bold;');
          }
          // 尝试提取对话 ID 或笔记本相关 UUID
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
            setLogs(prev => [...prev, '✅ NotebookLM自动提取脚本已复制到剪贴板!']);
            setLogs(prev => [...prev, '📝 请在NotebookLM页面的Console中粘贴并运行']);
        }).catch(err => {
            setLogs(prev => [...prev, `❌ 复制失败: ${err}`]);
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
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Output Directory</label>
                                <div className="flex gap-2">
                                    <input
                                        value={outputDir}
                                        onChange={(e) => setOutputDir(e.target.value)}
                                        className="flex-1 px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                                        placeholder="data"
                                    />
                                    <button
                                        onClick={selectFolder}
                                        className="px-4 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-all flex items-center gap-2"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                        Browse
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Freshdesk API Key</label>
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <input
                                            type={showApiKey ? "text" : "password"}
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            className="w-full px-4 py-3 pr-12 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                                            placeholder="Enter your Freshdesk API Key"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                                        >
                                            {showApiKey ? (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                            ) : (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268-2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            )}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(apiKey).then(() => {
                                                setLogs(prev => [...prev, '✅ API Key 已复制到剪贴板']);
                                            });
                                        }}
                                        className="px-4 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
                                        title="复制 API Hex"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-2">Find your API key in Freshdesk → Profile Settings → API Key</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">Full Sync Start Date</label>
                                <input
                                    type="month"
                                    value={syncStartDate}
                                    onChange={(e) => setSyncStartDate(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                                />
                                <p className="text-[10px] text-slate-500 mt-2">Tickets will be fetched starting from this month during full sync</p>
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
                                                setLogs(prev => [...prev, '✅ 已成功导入 AI 配置']);
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
                </div>

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
