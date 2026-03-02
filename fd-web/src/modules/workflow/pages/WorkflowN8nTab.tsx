import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { configApi } from '../../../shared/services/serverApi';

export default function WorkflowN8nTab() {
  const { t } = useTranslation(['common']);
  const [n8nUrl, setN8nUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    configApi.getN8nConfig()
      .then(data => {
        setN8nUrl(data.url);
        setEnabled(data.enabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

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
          <a
            href={n8nUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 px-4 py-2 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1"
          >
            {t('n8n.openN8n')}
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      ) : (
        <iframe
          src="/n8n/"
          className="flex-1 w-full border-0"
          title="n8n"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          onError={() => setIframeError(true)}
        />
      )}
    </div>
  );
}
