/**
 * SourcePicker - 可复用的知识库源文件选择器
 *
 * 支持从指定知识库加载源列表、按类型过滤、inline 新建源文件。
 */
import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { knowledgeApi } from '../services/api/knowledge';
import type { KnowledgeSource, KnowledgeSourceType } from '../types/server';

export interface SourcePickerProps {
  knowledgeBaseId: number;
  value?: number;
  onChange: (sourceId: number) => void;
  filterType?: KnowledgeSourceType;
  placeholder?: string;
  createDefaults?: {
    title: string;
    sourceType: KnowledgeSourceType;
  };
  disabled?: boolean;
  className?: string;
}

export interface SourcePickerRef {
  refresh: () => Promise<void>;
}

const SourcePicker = forwardRef<SourcePickerRef, SourcePickerProps>(
  (
    {
      knowledgeBaseId,
      value,
      onChange,
      filterType,
      placeholder,
      createDefaults,
      disabled = false,
      className = '',
    },
    ref,
  ) => {
    const { t } = useTranslation('common');

    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // ---- 加载源列表 ----
    const loadSources = useCallback(async () => {
      if (!knowledgeBaseId) return;
      setLoading(true);
      try {
        const list = await knowledgeApi.listSources(knowledgeBaseId);
        setSources(list);
      } catch {
        setSources([]);
      } finally {
        setLoading(false);
      }
    }, [knowledgeBaseId]);

    useEffect(() => {
      loadSources();
    }, [loadSources]);

    // 暴露 refresh 给父组件
    useImperativeHandle(ref, () => ({ refresh: loadSources }), [loadSources]);

    // ---- 过滤 ----
    const filtered = sources.filter(s => !filterType || s.sourceType === filterType);

    // 检查当前 value 是否在过滤后列表中
    const valueExists = value != null && filtered.some(s => s.id === value);
    const showDeletedWarning = value != null && !valueExists;

    // ---- 新建源 ----
    const handleStartCreate = () => {
      setCreating(true);
      setNewTitle(createDefaults?.title || '');
    };

    const handleCancelCreate = () => {
      setCreating(false);
      setNewTitle('');
    };

    const handleConfirmCreate = async () => {
      if (!newTitle.trim() || !createDefaults) return;
      setSubmitting(true);
      try {
        const created = await knowledgeApi.addTextSource(knowledgeBaseId, {
          title: newTitle.trim(),
          sourceType: createDefaults.sourceType,
          content: '',
        });
        await loadSources();
        onChange(created.id);
        setCreating(false);
        setNewTitle('');
      } catch {
        // 静默失败，用户可重试
      } finally {
        setSubmitting(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmCreate();
      } else if (e.key === 'Escape') {
        handleCancelCreate();
      }
    };

    // ---- 渲染 ----
    const placeholderText =
      placeholder ||
      t('sourcePicker.placeholder', { ns: 'common', defaultValue: '-- 选择源文件 --' });

    return (
      <div className={`space-y-1 ${className}`}>
        {/* 选择行 */}
        <div className="flex items-center gap-2">
          <select
            value={value ?? ''}
            onChange={e => {
              const v = e.target.value;
              if (v) onChange(Number(v));
            }}
            disabled={disabled || loading}
            className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
          >
            <option value="">{loading ? '...' : placeholderText}</option>
            {filtered.map(source => (
              <option key={source.id} value={source.id}>
                {source.title} ({source.sourceType})
              </option>
            ))}
          </select>

          {createDefaults && !creating && (
            <button
              type="button"
              onClick={handleStartCreate}
              disabled={disabled}
              className="text-amber-400 hover:text-amber-300 text-xs whitespace-nowrap disabled:opacity-50"
            >
              {t('sourcePicker.create', { ns: 'common', defaultValue: '+ 新建' })}
            </button>
          )}
        </div>

        {/* 已删除警告 */}
        {showDeletedWarning && (
          <p className="text-red-400 text-xs">
            {t('sourcePicker.deleted', {
              ns: 'common',
              defaultValue: '\u26A0\uFE0F 映射的源已被删除，请重新选择',
            })}
          </p>
        )}

        {/* inline 创建表单 */}
        {creating && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('sourcePicker.titlePlaceholder', {
                ns: 'common',
                defaultValue: '输入源文件名称',
              })}
              disabled={submitting}
              autoFocus
              className="flex-1 px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleConfirmCreate}
              disabled={submitting || !newTitle.trim()}
              className="text-green-400 hover:text-green-300 text-sm disabled:opacity-50"
              title={t('sourcePicker.creating', { ns: 'common', defaultValue: '创建中...' })}
            >
              {submitting ? '...' : '\u2713'}
            </button>
            <button
              type="button"
              onClick={handleCancelCreate}
              disabled={submitting}
              className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50"
            >
              {'\u2717'}
            </button>
          </div>
        )}
      </div>
    );
  },
);

SourcePicker.displayName = 'SourcePicker';

export default SourcePicker;
