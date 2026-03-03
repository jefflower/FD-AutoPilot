/**
 * 版本历史面板
 *
 * 显示 AI 工作流的版本列表，支持预览和回滚操作。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowAiApi } from '../../../shared/services/serverApi';
import type { AiWorkflowVersion } from '../../../shared/services/api/workflow';
import { useJsonPreview } from '../../../shared/components/JsonPreview';
import {
  History, RefreshCw, Eye, RotateCcw, Loader2, Clock, User, ArrowLeftRight,
} from 'lucide-react';

// ============ Props ============

interface VersionHistoryProps {
  workflowId: number;
  currentVersion: number;
  onRollback: (versionNumber: number) => void;
  onPreview?: (json: string) => void;
}

// ============ 回滚确认对话框 ============

const RollbackDialog: React.FC<{
  versionNumber: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ versionNumber, onConfirm, onCancel }) => {
  const { t } = useTranslation('common');
  if (versionNumber === null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg w-[400px] p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-slate-200 font-medium mb-3">{t('confirmDialog.defaultTitle')}</h3>
        <p className="text-slate-400 text-sm mb-6">
          {t('workflowAi.versionHistory.rollbackConfirm', { version: versionNumber })}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            {t('confirmDialog.defaultCancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
          >
            {t('workflowAi.versionHistory.rollback')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 版本项 ============

const VersionItem: React.FC<{
  version: AiWorkflowVersion;
  isCurrent: boolean;
  onPreview?: (json: string) => void;
  onRollback: (versionNumber: number) => void;
  compareSelection: number[];
  toggleCompareSelect: (versionNumber: number) => void;
  onOpenPreview: (options: { title: string; json: string }) => void;
}> = ({ version, isCurrent, onPreview, onRollback, compareSelection, toggleCompareSelect, onOpenPreview }) => {
  const { t } = useTranslation('common');

  const formattedTime = (() => {
    try {
      const date = new Date(version.createdAt);
      return date.toLocaleString();
    } catch {
      return version.createdAt;
    }
  })();

  return (
    <div
      className={`p-2.5 rounded-lg border transition-colors ${
        isCurrent
          ? 'border-blue-500/50 bg-blue-500/5'
          : 'border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50'
      }`}
    >
      {/* 版本号 + badge */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={compareSelection.includes(version.versionNumber)}
            onChange={() => toggleCompareSelect(version.versionNumber)}
            className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer flex-shrink-0"
          />
          <span className="text-xs font-medium text-slate-200">v{version.versionNumber}</span>
          {isCurrent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              {t('workflowAi.versionHistory.currentVersion')}
            </span>
          )}
        </div>
      </div>

      {/* 变更描述 */}
      {version.changeDescription && (
        <p className="text-xs text-slate-400 mb-1.5 truncate" title={version.changeDescription}>
          {version.changeDescription}
        </p>
      )}

      {/* 元信息 */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-2">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formattedTime}
        </span>
        {version.createdBy && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {version.createdBy}
          </span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        {version.workflowJson && (
          <button
            onClick={() => {
              if (onPreview) onPreview(version.workflowJson);
              onOpenPreview({ title: `v${version.versionNumber}`, json: version.workflowJson });
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            <Eye className="w-3 h-3" />
            {t('workflowAi.versionHistory.preview')}
          </button>
        )}
        {!isCurrent && (
          <button
            onClick={() => onRollback(version.versionNumber)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 hover:text-amber-300 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t('workflowAi.versionHistory.rollback')}
          </button>
        )}
      </div>
    </div>
  );
};

// ============ 主组件 ============

const VersionHistory: React.FC<VersionHistoryProps> = ({
  workflowId,
  currentVersion,
  onRollback,
  onPreview,
}) => {
  const { t } = useTranslation('common');
  const { openPreview } = useJsonPreview();

  const [versions, setVersions] = useState<AiWorkflowVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);
  const [compareSelection, setCompareSelection] = useState<number[]>([]);

  const toggleCompareSelect = (versionNumber: number) => {
    setCompareSelection(prev => {
      if (prev.includes(versionNumber)) {
        return prev.filter(v => v !== versionNumber);
      }
      if (prev.length >= 2) {
        return [prev[1], versionNumber]; // 替换最旧的选择
      }
      return [...prev, versionNumber];
    });
  };

  const handleCompare = () => {
    if (compareSelection.length !== 2) return;
    const [v1Num, v2Num] = compareSelection.sort((a, b) => a - b);
    const v1 = versions.find(v => v.versionNumber === v1Num);
    const v2 = versions.find(v => v.versionNumber === v2Num);
    if (!v1?.workflowJson || !v2?.workflowJson) return;
    openPreview({
      title: `v${v1Num}`,
      json: v1.workflowJson,
      compareJson: v2.workflowJson,
      compareTitle: `v${v2Num}`,
    });
    setCompareSelection([]);
  };

  // 加载版本列表
  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await workflowAiApi.getVersions(workflowId);
      // 按版本号倒序
      setVersions((list || []).sort((a, b) => b.versionNumber - a.versionNumber));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // 确认回滚
  const handleConfirmRollback = useCallback(() => {
    if (rollbackTarget !== null) {
      onRollback(rollbackTarget);
      setRollbackTarget(null);
    }
  }, [rollbackTarget, onRollback]);

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" />
          {t('workflowAi.versionHistory.title')}
        </h4>
        <button
          onClick={loadVersions}
          disabled={loading}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
          title={t('button.refresh')}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 版本列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
        </div>
      ) : versions.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-3">
          {t('workflowAi.versionHistory.noVersions')}
        </p>
      ) : (
        <div className="space-y-2">
          {compareSelection.length === 2 && (
            <button
              onClick={handleCompare}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-blue-400 bg-blue-600/10 border border-blue-500/30 rounded hover:bg-blue-600/20 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {t('jsonPreview.compare')}
            </button>
          )}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {versions.map(v => (
              <VersionItem
                key={v.id}
                version={v}
                isCurrent={v.versionNumber === currentVersion}
                onPreview={onPreview}
                onRollback={setRollbackTarget}
                compareSelection={compareSelection}
                toggleCompareSelect={toggleCompareSelect}
                onOpenPreview={openPreview}
              />
            ))}
          </div>
        </div>
      )}

      {/* 回滚确认对话框 */}
      <RollbackDialog
        versionNumber={rollbackTarget}
        onConfirm={handleConfirmRollback}
        onCancel={() => setRollbackTarget(null)}
      />
    </div>
  );
};

export default VersionHistory;
