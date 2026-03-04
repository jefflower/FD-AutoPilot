import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  ExternalLink,
  Loader2,
  AlertCircle,
  XCircle,
  Globe,
  Link2,
  Settings,
  X,
  Monitor,
} from 'lucide-react';
import { configApi, getServerBaseUrl } from '../../../shared/services/serverApi';
// isTauriEnv 备用；跨域检测使用 isCrossOriginIframe() 更精确
// import { isTauriEnv } from '../../../tauri/bridge';

type N8nMode = 'proxy' | 'direct';

const LS_KEY_MODE = 'fd_n8n_mode';
const LS_KEY_DIRECT_URL = 'fd_n8n_direct_url';
const N8N_PROXY_PATH = '/n8n/';

function readMode(): N8nMode {
  const v = localStorage.getItem(LS_KEY_MODE);
  return v === 'direct' ? 'direct' : 'proxy';
}

function readDirectUrl(): string {
  return localStorage.getItem(LS_KEY_DIRECT_URL) || '';
}

/**
 * 判断当前环境是否为跨域 iframe 场景（Tauri 客户端 + 有 serverBaseUrl）
 * 跨域 iframe 中第三方 Cookie 会被 WebKit 阻止，n8n 登录会失败
 */
function isCrossOriginIframe(): boolean {
  const baseUrl = getServerBaseUrl();
  if (!baseUrl) return false; // 同源部署，无跨域问题
  try {
    const serverOrigin = new URL(baseUrl).origin;
    return serverOrigin !== window.location.origin;
  } catch {
    return false;
  }
}

export default function WorkflowN8nTab() {
  const { t } = useTranslation(['common']);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [mode, setMode] = useState<N8nMode>(readMode);
  const [directUrl, setDirectUrl] = useState<string>(readDirectUrl);
  // 浮动配置面板开关
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // iframe key: 变更时强制重新挂载 iframe
  const [iframeKey, setIframeKey] = useState(0);

  // 是否已在新窗口打开 n8n（Tauri 跨域模式下使用）
  const [openedInWindow, setOpenedInWindow] = useState(false);

  // 检测跨域 iframe 场景
  const crossOrigin = useMemo(() => isCrossOriginIframe(), []);

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

  // 点击外部关闭面板
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    if (panelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [panelOpen]);

  // 拼接 serverBaseUrl，确保 Tauri 客户端也能正确访问远程 n8n
  const proxyUrl = `${getServerBaseUrl()}${N8N_PROXY_PATH}`;
  const currentSrc = mode === 'proxy' ? proxyUrl : directUrl;

  const handleModeChange = useCallback((newMode: N8nMode) => {
    setMode(newMode);
    localStorage.setItem(LS_KEY_MODE, newMode);
    setIframeKey((k) => k + 1);
    setOpenedInWindow(false);
  }, []);

  const handleDirectUrlChange = useCallback((url: string) => {
    setDirectUrl(url);
    localStorage.setItem(LS_KEY_DIRECT_URL, url);
  }, []);

  const handleDirectUrlConfirm = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const handleOpenNewWindow = useCallback(() => {
    const url = mode === 'proxy' ? proxyUrl : directUrl;
    if (url) {
      window.open(url, '_blank');
      setOpenedInWindow(true);
    }
  }, [mode, directUrl, proxyUrl]);

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

  // ---------- n8n 已启用 ----------
  // 跨域环境（Tauri 客户端访问远程服务）：iframe 中第三方 Cookie 被阻止，需要新窗口打开
  const useWindowMode = crossOrigin;

  return (
    <div className="relative w-full h-full">
      {/* ====== 主内容区 ====== */}
      {useWindowMode ? (
        /* -- 跨域模式：提示用户新窗口打开 -- */
        <div className="flex flex-col items-center justify-center w-full h-full gap-5 bg-gray-50 dark:bg-gray-900">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 max-w-md w-full mx-4 text-center">
            <div className="w-14 h-14 mx-auto mb-4 bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center">
              <Monitor className="w-7 h-7 text-purple-500 dark:text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              n8n 工作流引擎
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              {mode === 'proxy' ? '代理模式' : '直连模式'}：
              <span className="font-mono text-xs ml-1 text-gray-600 dark:text-gray-300">
                {currentSrc}
              </span>
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
              桌面客户端需在新窗口中打开 n8n 以确保登录正常工作
            </p>
            <button
              onClick={handleOpenNewWindow}
              disabled={mode === 'direct' && !directUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl
                bg-purple-600 hover:bg-purple-700 text-white shadow-md
                transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ExternalLink className="w-4 h-4" />
              {openedInWindow ? '再次打开 n8n' : '打开 n8n'}
            </button>
            {openedInWindow && (
              <p className="mt-3 text-xs text-green-500 dark:text-green-400">
                ✓ 已在新窗口中打开
              </p>
            )}
          </div>
        </div>
      ) : mode === 'direct' && !directUrl ? (
        /* -- 直连模式未配置地址 -- */
        <div className="flex flex-col items-center justify-center w-full h-full text-gray-400 dark:text-gray-500 gap-3 bg-gray-50 dark:bg-gray-900">
          <Link2 className="w-10 h-10" />
          <p className="text-sm">请点击右上角设置，输入 n8n 直连地址</p>
        </div>
      ) : (
        /* -- 同源模式：iframe 嵌入 -- */
        <iframe
          key={iframeKey}
          src={currentSrc}
          className="w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
          title="n8n Workflow Engine"
        />
      )}

      {/* ====== 右上角浮动按钮 ====== */}
      {!panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          className="absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg
            bg-gray-900/60 hover:bg-gray-900/80 text-white backdrop-blur-sm
            shadow-lg transition-all"
          title="n8n 连接设置"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>{mode === 'proxy' ? '代理' : '直连'}</span>
        </button>
      )}

      {/* ====== 浮动配置面板 ====== */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="absolute top-2 right-2 z-30 w-80
            bg-gray-900/90 backdrop-blur-md rounded-xl shadow-2xl
            border border-white/10 text-white overflow-hidden"
        >
          {/* 面板头部 */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
            <span className="text-sm font-medium">n8n 连接设置</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="p-0.5 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 面板内容 */}
          <div className="px-4 py-3 space-y-3">
            {/* 模式选择 */}
            <div className="flex gap-2">
              <button
                onClick={() => handleModeChange('proxy')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  mode === 'proxy'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-gray-300 hover:bg-white/15'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                代理模式
              </button>
              <button
                onClick={() => handleModeChange('direct')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  mode === 'direct'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 text-gray-300 hover:bg-white/15'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                直连模式
              </button>
            </div>

            {/* 地址显示/输入 */}
            {mode === 'proxy' ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 bg-white/5 rounded-lg border border-white/10">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{proxyUrl}</span>
                <span className="ml-auto text-[10px] text-gray-500">代理</span>
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
                placeholder="如 http://47.110.152.25:5678"
                className="w-full px-3 py-2 text-xs rounded-lg border border-white/10
                  bg-white/5 text-gray-200 placeholder-gray-500
                  focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 transition-colors"
              />
            )}

            {/* 新窗口打开 */}
            <button
              onClick={() => { handleOpenNewWindow(); setPanelOpen(false); }}
              disabled={mode === 'direct' && !directUrl}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium
                rounded-lg bg-white/10 text-gray-200 hover:bg-white/15
                transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              新窗口打开
            </button>

            {/* 跨域提示 */}
            {crossOrigin && (
              <p className="text-[10px] text-amber-400/70 leading-tight">
                💡 检测到跨域环境，iframe 嵌入 n8n 时 Cookie 会被浏览器阻止，
                已自动切换为新窗口模式。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
