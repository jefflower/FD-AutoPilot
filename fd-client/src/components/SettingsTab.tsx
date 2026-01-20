import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { NotebookLMConfig } from '../types';

interface SettingsTabProps {
    apiKey: string;
    setApiKey: (s: string) => void;
    outputDir: string;
    setOutputDir: (s: string) => void;
    syncStartDate: string;
    setSyncStartDate: (s: string) => void;
    notebookLMConfig: NotebookLMConfig;
    setNotebookLMConfig: (c: NotebookLMConfig) => void;
    setLogs: (updater: (prev: string[]) => string[]) => void;
}

const SettingsTab: React.FC<SettingsTabProps> = ({
    apiKey, setApiKey,
    outputDir, setOutputDir,
    syncStartDate, setSyncStartDate,
    notebookLMConfig, setNotebookLMConfig,
    setLogs
}) => {
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
            <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
            <p className="text-slate-400 text-sm mb-6">Configure your Freshdesk connection</p>

            <div className="max-w-3xl space-y-4">
                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Output Directory</label>
                    <div className="flex gap-2">
                        <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} className="flex-1 px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="data" />
                        <button onClick={selectFolder} className="px-4 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-all flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>Browse
                        </button>
                    </div>
                </div>

                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <label className="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="Enter your Freshdesk API Key" />
                    <p className="text-xs text-slate-500 mt-2">Find your API key in Freshdesk → Profile Settings → API Key</p>
                </div>

                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Full Sync Start Date</label>
                    <input
                        type="month"
                        value={syncStartDate}
                        onChange={(e) => setSyncStartDate(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    <p className="text-xs text-slate-500 mt-2">When using Full Sync, tickets will be fetched starting from this month</p>
                </div>

                {/* NotebookLM配置区域 */}
                <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl p-5 mt-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                NotebookLM AI 配置
                            </h3>
                            <p className="text-xs text-slate-400 mt-1">配置NotebookLM AI对话功能</p>
                        </div>
                        <button
                            onClick={copyExtractScript}
                            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-purple-500/25 flex-shrink-0"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            提取脚本
                        </button>
                    </div>

                    <div className="bg-black/20 rounded-lg p-3 mb-4">
                        <p className="text-xs text-purple-200 mb-2">📖 <strong>快速获取配置:</strong></p>
                        <ol className="text-xs text-slate-300 space-y-1 ml-4 list-decimal">
                            <li>点击按钮复制脚本，在 NotebookLM 页面 Console 运行</li>
                            <li>在 NotebookLM 中发送一条消息，配置会自动提取并复制</li>
                            <li>直接在下方粘贴即可</li>
                        </ol>
                    </div>

                    <div className="space-y-3">
                        <div className="bg-slate-900/40 rounded-lg p-3 border border-purple-500/20">
                            <label className="block text-xs font-bold text-purple-300 mb-2 flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                快速导入 JSON 配置
                            </label>
                            <textarea
                                className="w-full px-3 py-2 bg-slate-950/50 border border-white/5 rounded text-xs text-slate-300 font-mono focus:outline-none focus:border-purple-500/50"
                                placeholder="在此处粘贴我发给您的 JSON 代码块..."
                                rows={2}
                                onChange={(e) => {
                                    try {
                                        const config = JSON.parse(e.target.value);
                                        if (config.notebookId || config.atToken) {
                                            setNotebookLMConfig({
                                                ...notebookLMConfig,
                                                ...config
                                            });
                                            e.target.value = '';
                                            setLogs(prev => [...prev, '✅ 已从 JSON 成功导入配置 (包含 Source IDs)']);
                                        }
                                    } catch (err) { }
                                }}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1.5">Notebook ID</label>
                                <input
                                    type="text"
                                    value={notebookLMConfig.notebookId}
                                    onChange={(e) => setNotebookLMConfig({ ...notebookLMConfig, notebookId: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    placeholder="7662c1de-8bba-4d54-b834-e38161f942f4"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1.5">F.SID</label>
                                <input
                                    type="text"
                                    value={notebookLMConfig.fSid}
                                    onChange={(e) => setNotebookLMConfig({ ...notebookLMConfig, fSid: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    placeholder="从脚本获取"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-1.5">AT Token</label>
                            <input
                                type="password"
                                value={notebookLMConfig.atToken}
                                onChange={(e) => setNotebookLMConfig({ ...notebookLMConfig, atToken: e.target.value })}
                                className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                placeholder="以 AE_H9g... 开头的长字符串"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-1.5">Cookie</label>
                            <textarea
                                value={notebookLMConfig.cookie}
                                onChange={(e) => setNotebookLMConfig({ ...notebookLMConfig, cookie: e.target.value })}
                                className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                placeholder="Google 登录后的全量 Cookie"
                                rows={3}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-1.5">关联的文档源 (Source IDs)</label>
                            <textarea
                                value={notebookLMConfig.sourceIds?.join('\n') || ''}
                                onChange={(e) => {
                                    const ids = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                                    setNotebookLMConfig({ ...notebookLMConfig, sourceIds: ids });
                                }}
                                className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                placeholder="每行一个文档 UUID (必需，否则会报 400)"
                                rows={2}
                            />
                            <p className="text-[10px] text-slate-500 mt-1">💡 缺少此项会导致 Google 返回 400 Bad Request</p>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-1.5">AI提示词模板</label>
                            <textarea
                                value={notebookLMConfig.prompt}
                                onChange={(e) => setNotebookLMConfig({ ...notebookLMConfig, prompt: e.target.value })}
                                className="w-full px-3 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                placeholder="使用 ${工单内容} 作为占位符"
                                rows={2}
                            />
                        </div>

                        {/* 配置状态指示 */}
                        {notebookLMConfig.cookie && notebookLMConfig.atToken && notebookLMConfig.fSid ? (
                            <div className="space-y-2">
                                <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-2.5 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="text-green-400 text-xs">✅ NotebookLM配置完整</span>
                                </div>
                                {notebookLMConfig.sourceIds && notebookLMConfig.sourceIds.length > 0 && (
                                    <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-2.5 flex items-center gap-2">
                                        <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="text-blue-400 text-xs text-wrap">已关联 {notebookLMConfig.sourceIds.length} 个知识库文档源</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-2.5 flex items-center gap-2">
                                <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className="text-yellow-400 text-xs">⚠️ 请配置 NotebookLM 以使用 AI 功能</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span className="text-green-400 text-sm">Settings are saved automatically</span>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;
