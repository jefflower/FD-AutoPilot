/**
 * ReplyEditor — 共享的双语回复编辑组件
 *
 * 布局：LEFT=原文(target) | CENTER=双向翻译按钮 | RIGHT=中文
 * 用于：ManualRequiredTab 手动回复 / ReplyHistoryPanel 编辑模式
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

export type TranslateDirection = 'zh_to_target' | 'target_to_zh';

export interface ReplyEditorProps {
  /** 原文内容 */
  targetValue: string;
  /** 中文内容 */
  zhValue: string;
  /** 目标语言标签 (e.g. "en") */
  targetLang: string;
  onTargetChange: (value: string) => void;
  onZhChange: (value: string) => void;

  /** 翻译回调 */
  onTranslate: (direction: TranslateDirection) => void;
  translating: boolean;
  /** 启用的翻译方向，默认两个方向都启用 */
  enabledDirections?: TranslateDirection[];
  /** 禁用方向按钮的提示文案 */
  disabledDirectionTooltip?: string;

  /** 可选：显示"需同步"警告横幅 */
  needsSync?: boolean;

  /** 主操作按钮 */
  primaryAction: {
    label: string;
    loadingLabel: string;
    loading: boolean;
    disabled: boolean;
    onClick: () => void;
  };
  /** 取消按钮 */
  cancelAction: {
    label: string;
    onClick: () => void;
  };
  /** 可选底部提示（如"请先同步翻译再保存"） */
  footerHint?: string;

  /** 主题色 */
  themeColor?: 'purple' | 'amber';
  /** textarea 最小高度，默认 120px */
  minTextareaHeight?: string;
}

const THEME = {
  purple: {
    focus: 'focus:border-purple-500',
    primaryBtn: 'bg-purple-600 hover:bg-purple-500 shadow-purple-500/20',
  },
  amber: {
    focus: 'focus:border-amber-500',
    primaryBtn: 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20',
  },
} as const;

const ReplyEditor: React.FC<ReplyEditorProps> = ({
  targetValue,
  zhValue,
  targetLang,
  onTargetChange,
  onZhChange,
  onTranslate,
  translating,
  enabledDirections = ['zh_to_target', 'target_to_zh'],
  disabledDirectionTooltip,
  needsSync,
  primaryAction,
  cancelAction,
  footerHint,
  themeColor = 'purple',
  minTextareaHeight = '120px',
}) => {
  const colors = THEME[themeColor];

  const isDirectionEnabled = (dir: TranslateDirection) => enabledDirections.includes(dir);

  return (
    <div className="space-y-3">
      {/* needsSync 警告横幅 */}
      {needsSync && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 border border-amber-500/30 rounded-lg">
          <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-[10px] text-amber-400 font-bold">内容已修改，请同步翻译后再保存</span>
        </div>
      )}

      {/* 三列布局：LEFT=原文 | CENTER=翻译按钮 | RIGHT=中文 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 items-start">
        {/* LEFT: 原文 (target language) */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {targetLang} 回复
          </label>
          <textarea
            value={targetValue}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="目标语言回复内容..."
            className={`w-full bg-black/30 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 placeholder:text-slate-600 ${colors.focus} outline-none resize-y transition-colors`}
            style={{ minHeight: minTextareaHeight }}
          />
        </div>

        {/* CENTER: 双向翻译按钮 */}
        <div className="flex lg:flex-col items-center justify-center gap-2 py-2 lg:py-0 lg:pt-6">
          {/* target → 中文 */}
          <button
            onClick={() => onTranslate('target_to_zh')}
            disabled={translating || !targetValue.trim() || !isDirectionEnabled('target_to_zh')}
            title={!isDirectionEnabled('target_to_zh') ? disabledDirectionTooltip : '翻译为中文'}
            className="px-3 py-1.5 text-[10px] font-black bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg transition-all shadow-lg shadow-cyan-500/20 whitespace-nowrap"
          >
            {translating ? '...' : '← 中文'}
          </button>
          {/* 中文 → target */}
          <button
            onClick={() => onTranslate('zh_to_target')}
            disabled={translating || !zhValue.trim() || !isDirectionEnabled('zh_to_target')}
            title={!isDirectionEnabled('zh_to_target') ? disabledDirectionTooltip : '翻译为原文'}
            className="px-3 py-1.5 text-[10px] font-black bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-all shadow-lg shadow-emerald-500/20 whitespace-nowrap"
          >
            {translating ? '...' : '原文 →'}
          </button>
        </div>

        {/* RIGHT: 中文 */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">中文回复</label>
          <textarea
            value={zhValue}
            onChange={(e) => onZhChange(e.target.value)}
            placeholder="请输入中文回复内容..."
            className={`w-full bg-black/30 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 placeholder:text-slate-600 ${colors.focus} outline-none resize-y transition-colors`}
            style={{ minHeight: minTextareaHeight }}
          />
        </div>
      </div>

      {/* 翻译加载指示器 */}
      {translating && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
          <span className="text-[10px] text-cyan-400 font-bold animate-pulse">翻译同步中...</span>
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-700/50">
        {footerHint && (
          <span className="text-[10px] text-amber-400/80 mr-auto">{footerHint}</span>
        )}
        <button
          onClick={cancelAction.onClick}
          className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
        >
          {cancelAction.label}
        </button>
        <button
          onClick={primaryAction.onClick}
          disabled={primaryAction.loading || primaryAction.disabled}
          className={`px-6 py-2 ${colors.primaryBtn} disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black rounded-lg transition-all shadow-lg`}
        >
          {primaryAction.loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {primaryAction.loadingLabel}
            </span>
          ) : (
            primaryAction.label
          )}
        </button>
      </div>
    </div>
  );
};

export default ReplyEditor;
