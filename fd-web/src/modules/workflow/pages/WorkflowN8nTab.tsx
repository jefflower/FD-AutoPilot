import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, ExternalLink, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { configApi } from '../../../shared/services/serverApi';

/**
 * 判断 URL 是否为绝对路径（包含协议头）
 */
function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * 获取 iframe 实际加载地址
 * - 如果后端返回的是完整 URL（http://...），直接使用
 * - 如果是相对路径，保持不变
 */
function resolveIframeSrc(n8nUrl: string): string {
  if (isAbsoluteUrl(n8nUrl)) {
    // 确保 URL 末尾有斜杠，n8n 要求路径以 / 结尾
    return n8nUrl.endsWith('/') ? n8nUrl : `${n8nUrl}/`;
  }
  // 相对路径保持不变
  return n8nUrl.endsWith('/') ? n8nUrl : `${n8nUrl}/`;
}

export default function WorkflowN8nTab() {
  const { t } = useTranslation(['common']);
  const [n8nUrl, setN8nUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    configApi.getN8nConfig()
      .then(data => {
        setN8nUrl(data.url);
        setEnabled(data.enabled);
        setConfigError(null);
      })
      .catch((err) => {
        setConfigError(err?.message || '获取 n8n 配置失败');
      })
      .finally(() => setLoading(false));
  }, []);

  // 重试加载 iframe
  const handleRetry = useCallback(() => {
    setIframeError(false);
    // 通过改变 key 强制重新挂载 iframe
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = src;
        }
      }, 100);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // 配置获取失败
  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <AlertCircle className="w-12 h-12 text-red-300" />
        <p className="text-lg font-medium">配置加载失败</p>
        <p className="text-sm text-gray-400">{configError}</p>
      </div>
    );
  }

  // n8n 未启用或未配置 URL
  if (!enabled || !n8nUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <AlertCircle className="w-12 h-12 text-gray-300" />
        <p className="text-lg font-medium">{t('n8n.notEnabled')}</p>
        <p className="text-sm text-gray-400">
          {t('n8n.notEnabledHint')}
        </p>
      </div>
    );
  }

  // 计算 iframe 实际加载地址
  const iframeSrc = resolveIframeSrc(n8nUrl);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-medium text-gray-700">{t('n8n.title')}</span>
        </div>
        <a
          href={n8nUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple-500 transition-colors"
        >
          {t('n8n.openInNewWindow')}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {iframeError ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-3">
          <AlertCircle className="w-12 h-12 text-amber-300" />
          <p className="text-lg font-medium">{t('n8n.loadFailed')}</p>
          <p className="text-sm text-gray-400 text-center max-w-md">
            {t('n8n.loadFailedHint')}
          </p>
          <p className="text-xs text-gray-300 text-center">
            地址: {iframeSrc}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>
            <a
              href={n8nUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1"
            >
              {t('n8n.openN8n')}
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="flex-1 w-full border-0"
          title="n8n"
          allow="clipboard-read; clipboard-write"
          onError={() => setIframeError(true)}
          onLoad={(e) => {
            // 检查 iframe 是否加载了错误页面（仅同源时可检测）
            try {
              const iframeDoc = (e.target as HTMLIFrameElement).contentDocument;
              if (iframeDoc && iframeDoc.title === '') {
                // 空白页面可能表示加载失败
                const body = iframeDoc.body?.textContent?.trim();
                if (body === '' || body === undefined) {
                  // 可能是跨域页面，正常情况跨域无法读取 contentDocument
                  // 不做处理，让页面正常显示
                }
              }
            } catch {
              // 跨域时无法访问 contentDocument，这是正常情况
              // 说明 iframe 加载了跨域内容（即 n8n 页面），不需要报错
            }
          }}
        />
      )}
    </div>
  );
}
