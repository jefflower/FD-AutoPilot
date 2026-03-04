import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Globe,
} from 'lucide-react';
import { configApi } from '../../../shared/services/serverApi';

export default function WorkflowN8nTab() {
  const { t } = useTranslation(['common']);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

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

  const handleOpenN8n = () => {
    window.open('/n8n/', '_blank');
  };

  // 加载中
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // 配置获取失败
  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 gap-3 bg-gray-50 dark:bg-gray-900">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium text-gray-700 dark:text-gray-300">配置加载失败</p>
        <p className="text-sm text-gray-400 dark:text-gray-500">{configError}</p>
      </div>
    );
  }

  // n8n 未启用
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

  // n8n 已启用 — 引导页面
  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
          {/* 图标 */}
          <div className="w-16 h-16 mx-auto mb-5 bg-purple-50 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center">
            <Boxes className="w-8 h-8 text-purple-500 dark:text-purple-400" />
          </div>

          {/* 标题 */}
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
            n8n 工作流引擎
          </h2>

          {/* 状态指示 */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">已启用</span>
          </div>

          {/* 打开按钮 */}
          <button
            onClick={handleOpenN8n}
            className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
          >
            <ExternalLink className="w-4 h-4" />
            打开 n8n
          </button>

          {/* 代理说明 */}
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700">
            <div className="flex items-start gap-2 text-left">
              <Globe className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                通过本服务器代理访问 n8n，无需直连 n8n 端口。点击上方按钮将在新标签页中打开工作流编辑器。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
