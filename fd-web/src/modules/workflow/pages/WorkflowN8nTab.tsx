import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  ExternalLink,
  Loader2,
  AlertCircle,
  XCircle,
  Globe,
  Link2,
  ChevronDown,
} from 'lucide-react';
import { configApi } from '../../../shared/services/serverApi';

type N8nMode = 'proxy' | 'direct';

const LS_KEY_MODE = 'fd_n8n_mode';
const LS_KEY_DIRECT_URL = 'fd_n8n_direct_url';
const PROXY_URL = '/n8n/';

function readMode(): N8nMode {
  const v = localStorage.getItem(LS_KEY_MODE);
  return v === 'direct' ? 'direct' : 'proxy';
}

function readDirectUrl(): string {
  return localStorage.getItem(LS_KEY_DIRECT_URL) || '';
}

export default function WorkflowN8nTab() {
  const { t } = useTranslation(['common']);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [mode, setMode] = useState<N8nMode>(readMode);
  const [directUrl, setDirectUrl] = useState<string>(readDirectUrl);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // iframe key: 变更时强制重新挂载 iframe
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    configApi
      .getN8nConfig()
      .then((data) => {
        setEnabled(data.enabled);
        setConfigError(null);
      })
      .catch((err) => {
        setConfigError(err?.message || '获取 n8n 配置失败');
      })
      .finally(() => setLoading(false));
  }, []);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const currentSrc = mode === 'proxy' ? PROXY_URL : directUrl;

  const handleModeChange = useCallback(
    (newMode: N8nMode) => {
      setMode(newMode);
      localStorage.setItem(LS_KEY_MODE, newMode);
      setDropdownOpen(false);
      // 模式切换后刷新 iframe
      setIframeKey((k) => k + 1);
    },
    [],
  );

  const handleDirectUrlChange = useCallback(
    (url: string) => {
      setDirectUrl(url);
      localStorage.setItem(LS_KEY_DIRECT_URL, url);
    },
    [],
  );

  const handleDirectUrlConfirm = useCallback(() => {
    // URL 变更后按回车或失焦时刷新 iframe
    setIframeKey((k) => k + 1);
  }, []);

  const handleOpenNewWindow = useCallback(() => {
    const url = mode === 'proxy' ? PROXY_URL : directUrl;
    if (url) {
      window.open(url, '_blank');
    }
  }, [mode, directUrl]);

  // ---------- 加载中 ----------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // ---------- 配置获取失败 ----------
  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 gap-3 bg-gray-50 dark:bg-gray-900">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium text-gray-700 dark:text-gray-300">配置加载失败</p>
        <p className="text-sm text-gray-400 dark:text-gray-500">{configError}</p>
      </div>
    );
  }

  // ---------- n8n 未启用 ----------
  if (!enabled) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
              <Boxes className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
              n8n 工作流引擎
            </h2>
            <div className="flex items-center justify-center gap-2 mb-4">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-500 dark:text-red-400 font-medium">未启用</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('n8n.notEnabledHint')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- n8n 已启用 — iframe 嵌入 ----------
  return (
    <div className="flex flex-col w-full h-full bg-gray-50 dark:bg-gray-900">
      {/* ====== 顶部工具栏 ====== */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        {/* 模式切换下拉 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            {mode === 'proxy' ? (
              <Globe className="w-4 h-4 text-purple-500" />
            ) : (
              <Link2 className="w-4 h-4 text-blue-500" />
            )}
            <span>{mode === 'proxy' ? '代理模式' : '直连模式'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
              <button
                onClick={() => handleModeChange('proxy')}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  mode === 'proxy'
                    ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                <Globe className="w-4 h-4" />
                代理模式
              </button>
              <button
                onClick={() => handleModeChange('direct')}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  mode === 'direct'
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                <Link2 className="w-4 h-4" />
                直连模式
              </button>
            </div>
          )}
        </div>

        {/* 地址栏 */}
        <div className="flex-1 min-w-0">
          {mode === 'proxy' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 cursor-default select-none">
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{PROXY_URL}</span>
            </div>
          ) : (
            <input
              type="url"
              value={directUrl}
              onChange={(e) => handleDirectUrlChange(e.target.value)}
              onBlur={handleDirectUrlConfirm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDirectUrlConfirm();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="输入 n8n 地址，如 http://47.110.152.25:5678"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 transition-colors"
            />
          )}
        </div>

        {/* 新窗口打开按钮 */}
        <button
          onClick={handleOpenNewWindow}
          disabled={mode === 'direct' && !directUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="在新窗口中打开 n8n"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="hidden sm:inline">新窗口打开</span>
        </button>
      </div>

      {/* ====== iframe 区域 ====== */}
      <div className="flex-1 w-full min-h-0">
        {mode === 'direct' && !directUrl ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3">
            <Link2 className="w-10 h-10" />
            <p className="text-sm">请在上方地址栏输入 n8n 直连地址</p>
          </div>
        ) : (
          <iframe
            key={iframeKey}
            src={currentSrc}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title="n8n Workflow Engine"
          />
        )}
      </div>
    </div>
  );
}
