/**
 * 部署操作面板
 *
 * 显示工作流的当前状态和部署/激活/停用操作按钮。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AiWorkflow } from '../../../shared/services/api/workflow';
import {
  Rocket, Play, Pause, RefreshCw, Loader2, ExternalLink,
} from 'lucide-react';

// ============ Props ============

interface DeployPanelProps {
  workflow: AiWorkflow;
  onDeploy: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  deploying?: boolean;
}

// ============ 状态 Badge 配置 ============

const DEPLOY_STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT:    { bg: 'bg-slate-500/20', text: 'text-slate-400', dot: 'bg-slate-400' },
  DEPLOYED: { bg: 'bg-blue-500/20',  text: 'text-blue-400',  dot: 'bg-blue-400' },
  ACTIVE:   { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-400' },
  INACTIVE: { bg: 'bg-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' },
};

// ============ 主组件 ============

const DeployPanel: React.FC<DeployPanelProps> = ({
  workflow,
  onDeploy,
  onActivate,
  onDeactivate,
  deploying = false,
}) => {
  const { t } = useTranslation('common');
  const status = workflow.status || 'DRAFT';
  const style = DEPLOY_STATUS_STYLES[status] || DEPLOY_STATUS_STYLES.DRAFT;

  const statusLabel = t(`workflowAi.status.${status.toLowerCase()}` as any);

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      {/* 标题 */}
      <h4 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
        <Rocket className="w-3.5 h-3.5" />
        {t('workflowAi.deploy.title')}
      </h4>

      {/* 当前状态 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500">{t('workflowAi.deploy.currentStatus')}</span>
        <span className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {statusLabel}
        </span>
      </div>

      {/* n8n Workflow ID */}
      {workflow.n8nWorkflowId && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-500">{t('workflowAi.deploy.n8nId')}</span>
          <span className="flex items-center gap-1 text-xs text-slate-300 font-mono">
            {workflow.n8nWorkflowId}
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-col gap-2">
        {deploying ? (
          <button
            disabled
            className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-slate-700/50 text-slate-400 cursor-not-allowed"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('workflowAi.deploy.deploying')}
          </button>
        ) : (
          <>
            {/* DRAFT -> 部署 */}
            {status === 'DRAFT' && (
              <button
                onClick={onDeploy}
                className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 hover:text-blue-300 transition-colors"
              >
                <Rocket className="w-3.5 h-3.5" />
                {t('workflowAi.deploy.deployToN8n')}
              </button>
            )}

            {/* DEPLOYED -> 激活 + 重新部署 */}
            {status === 'DEPLOYED' && (
              <>
                <button
                  onClick={onActivate}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 hover:text-green-300 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.activate')}
                </button>
                <button
                  onClick={onDeploy}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.redeploy')}
                </button>
              </>
            )}

            {/* ACTIVE -> 停用 + 重新部署 */}
            {status === 'ACTIVE' && (
              <>
                <button
                  onClick={onDeactivate}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 hover:text-amber-300 transition-colors"
                >
                  <Pause className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.deactivate')}
                </button>
                <button
                  onClick={onDeploy}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.redeploy')}
                </button>
              </>
            )}

            {/* INACTIVE -> 激活 + 重新部署 */}
            {status === 'INACTIVE' && (
              <>
                <button
                  onClick={onActivate}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 hover:text-green-300 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.activate')}
                </button>
                <button
                  onClick={onDeploy}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('workflowAi.deploy.redeploy')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DeployPanel;
