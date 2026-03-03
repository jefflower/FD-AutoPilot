import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileJson,
  X,
  Minus,
  Maximize2,
  Minimize2,
  Search,
  Copy,
  Check,
  ChevronUp,
  ChevronDown,
  GripHorizontal,
  GitBranch,
  Loader2,
} from 'lucide-react';
import { useJsonPreviewInternal } from './JsonPreviewContext';
import JsonSyntaxHighlight, { tryFormatJson } from './JsonSyntaxHighlight';
import type { JsonPreviewPanelState } from './types';
import { MIN_PANEL_SIZE } from './types';

// Lazy-load WorkflowVisualizer (lives in modules/, uses @xyflow/react)
const LazyWorkflowVisualizer = React.lazy(
  () => import('../../../modules/workflow/components/WorkflowVisualizer')
);

// ── Helpers ──────────────────────────────────────────────────────────

type ViewMode = 'json' | 'flow';

/** Check whether a JSON string describes an n8n workflow (has `nodes` array + `connections` object). */
function isN8nWorkflowJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    return (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.nodes) &&
      parsed.connections &&
      typeof parsed.connections === 'object'
    );
  } catch {
    return false;
  }
}

/** Count nodes and connections in an n8n workflow JSON. */
function countWorkflowStats(json: string): { nodes: number; connections: number } {
  try {
    const parsed = JSON.parse(json);
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    let connections = 0;
    if (parsed.connections && typeof parsed.connections === 'object') {
      for (const src of Object.values(parsed.connections)) {
        const main = (src as Record<string, unknown>)?.main;
        if (Array.isArray(main)) {
          for (const outputs of main) {
            if (Array.isArray(outputs)) connections += outputs.length;
          }
        }
      }
    }
    return { nodes, connections };
  } catch {
    return { nodes: 0, connections: 0 };
  }
}

/** Count the lines and characters in a formatted JSON string. */
function countStats(json: string): { lines: number; chars: number } {
  const formatted = tryFormatJson(json);
  const lines = formatted.split('\n').length;
  return { lines, chars: json.length };
}

/** Collect all match indices (line numbers, 0-based) for a search term in formatted JSON. */
function findMatchLines(json: string, term: string): number[] {
  if (!term) return [];
  const formatted = tryFormatJson(json);
  const lines = formatted.split('\n');
  const lower = term.toLowerCase();
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) {
      matches.push(i);
    }
  }
  return matches;
}

// ── Diff helpers for compare mode ────────────────────────────────────

function computeDiffLines(leftJson: string, rightJson: string): { leftDiff: Set<number>; rightDiff: Set<number> } {
  const leftLines = tryFormatJson(leftJson).split('\n');
  const rightLines = tryFormatJson(rightJson).split('\n');
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const leftDiff = new Set<number>();
  const rightDiff = new Set<number>();
  for (let i = 0; i < maxLen; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    if (l !== r) {
      leftDiff.add(i);
      rightDiff.add(i);
    }
  }
  return { leftDiff, rightDiff };
}

// ── Component ────────────────────────────────────────────────────────

interface Props {
  panel: JsonPreviewPanelState;
}

const JsonPreviewPanel: React.FC<Props> = ({ panel }) => {
  const { t } = useTranslation('common');
  const {
    closePreview,
    bringToFront,
    toggleMinimize,
    toggleMaximize,
    updatePosition,
    updateSize,
  } = useJsonPreviewInternal();

  // ── Workflow detection ──
  const hasWorkflow = useMemo(() => isN8nWorkflowJson(panel.json), [panel.json]);
  const workflowStats = useMemo(() => (hasWorkflow ? countWorkflowStats(panel.json) : null), [panel.json, hasWorkflow]);

  // ── Local state ──
  const [viewMode, setViewMode] = useState<ViewMode>(hasWorkflow ? 'flow' : 'json');
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  // When panel json changes and workflow detection changes, update viewMode accordingly
  useEffect(() => {
    setViewMode(hasWorkflow ? 'flow' : 'json');
  }, [hasWorkflow]);

  // ── Drag state ──
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const rafDragRef = useRef<number | null>(null);

  // ── Resize state ──
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0 });
  const rafResizeRef = useRef<number | null>(null);

  // ── Refs for DOM elements ──
  const contentRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSyncingScroll = useRef(false);

  // ── Computed values ──
  const stats = useMemo(() => countStats(panel.json), [panel.json]);
  const matchLines = useMemo(() => findMatchLines(panel.json, searchTerm), [panel.json, searchTerm]);
  const isCompareMode = !!panel.compareJson;

  const diffResult = useMemo(() => {
    if (!panel.compareJson) return null;
    return computeDiffLines(panel.json, panel.compareJson);
  }, [panel.json, panel.compareJson]);

  // Reset match index when search term changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchTerm]);

  // Focus search input when search bar opens
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  // ── Drag handlers ──────────────────────────────────────────────────

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking on a button
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - panel.position.x,
      y: e.clientY - panel.position.y,
    };
    bringToFront(panel.id);
  }, [panel.id, panel.position.x, panel.position.y, bringToFront]);

  // ── Resize handlers ────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: panel.size.width,
      height: panel.size.height,
    };
    bringToFront(panel.id);
  }, [panel.id, panel.size.width, panel.size.height, bringToFront]);

  // ── Global mouse events for drag & resize ──────────────────────────

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Drag
      if (isDraggingRef.current) {
        if (rafDragRef.current !== null) cancelAnimationFrame(rafDragRef.current);
        rafDragRef.current = requestAnimationFrame(() => {
          const maxX = window.innerWidth - 100;
          const maxY = window.innerHeight - 40;
          const newX = Math.max(0, Math.min(maxX, e.clientX - dragOffsetRef.current.x));
          const newY = Math.max(0, Math.min(maxY, e.clientY - dragOffsetRef.current.y));
          updatePosition(panel.id, { x: newX, y: newY });
          rafDragRef.current = null;
        });
      }

      // Resize
      if (isResizingRef.current) {
        if (rafResizeRef.current !== null) cancelAnimationFrame(rafResizeRef.current);
        rafResizeRef.current = requestAnimationFrame(() => {
          const start = resizeStartRef.current;
          const newWidth = Math.max(MIN_PANEL_SIZE.width, start.width + (e.clientX - start.mouseX));
          const newHeight = Math.max(MIN_PANEL_SIZE.height, start.height + (e.clientY - start.mouseY));
          updateSize(panel.id, { width: newWidth, height: newHeight });
          rafResizeRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        if (rafDragRef.current !== null) {
          cancelAnimationFrame(rafDragRef.current);
          rafDragRef.current = null;
        }
      }
      if (isResizingRef.current) {
        isResizingRef.current = false;
        if (rafResizeRef.current !== null) {
          cancelAnimationFrame(rafResizeRef.current);
          rafResizeRef.current = null;
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafDragRef.current !== null) cancelAnimationFrame(rafDragRef.current);
      if (rafResizeRef.current !== null) cancelAnimationFrame(rafResizeRef.current);
    };
  }, [panel.id, updatePosition, updateSize]);

  // ── Search navigation ──────────────────────────────────────────────

  const scrollToMatch = useCallback((index: number) => {
    if (matchLines.length === 0) return;
    const lineIndex = matchLines[index];
    const container = contentRef.current;
    if (!container) return;
    // Each line is roughly 20px (leading-5 = 1.25rem = 20px)
    const lineHeight = 20;
    const targetScroll = lineIndex * lineHeight - container.clientHeight / 2 + lineHeight;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [matchLines]);

  const handlePrevMatch = useCallback(() => {
    if (matchLines.length === 0) return;
    const next = (currentMatchIndex - 1 + matchLines.length) % matchLines.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchLines, currentMatchIndex, scrollToMatch]);

  const handleNextMatch = useCallback(() => {
    if (matchLines.length === 0) return;
    const next = (currentMatchIndex + 1) % matchLines.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchLines, currentMatchIndex, scrollToMatch]);

  // ── Copy ───────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tryFormatJson(panel.json));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing on failure
    }
  }, [panel.json]);

  // ── Synchronized scrolling (compare mode) ──────────────────────────

  const handleLeftScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (leftScrollRef.current && rightScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  const handleRightScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (leftScrollRef.current && rightScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  // ── Click to bring to front ────────────────────────────────────────

  const handlePanelMouseDown = useCallback(() => {
    bringToFront(panel.id);
  }, [panel.id, bringToFront]);

  // ── Keyboard shortcut for search ───────────────────────────────────

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    }
    if (e.key === 'Escape') {
      setShowSearch(false);
      setSearchTerm('');
    }
  }, [handleNextMatch, handlePrevMatch]);

  // ── Compute minimized bottom position ──────────────────────────────

  // When minimized, anchor to bottom of screen
  const minimizedStyle: React.CSSProperties = panel.minimized
    ? {
        left: panel.position.x,
        bottom: 8,
        top: 'auto',
        width: 320,
        height: 'auto',
      }
    : {};

  // ── Render ─────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = panel.minimized
    ? {
        position: 'fixed',
        zIndex: panel.zIndex,
        ...minimizedStyle,
      }
    : {
        position: 'fixed',
        left: panel.position.x,
        top: panel.position.y,
        width: panel.size.width,
        height: panel.size.height,
        zIndex: panel.zIndex,
      };

  return (
    <div
      style={panelStyle}
      className="bg-slate-900 border border-slate-600/60 rounded-lg shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
      onMouseDown={handlePanelMouseDown}
    >
      {/* ── Title bar ─────────────────────────────────────────────── */}
      <div
        className="px-3 h-9 bg-slate-800/90 border-b border-slate-700/50 flex items-center justify-between select-none cursor-move shrink-0"
        onMouseDown={handleTitleMouseDown}
      >
        {/* Left: icon + title + view mode toggle */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {viewMode === 'flow' ? (
            <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <FileJson className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          )}
          <span className="text-xs font-medium text-slate-300 truncate">
            {panel.title}
          </span>

          {/* View mode toggle (only show when JSON is n8n workflow & not minimized) */}
          {!panel.minimized && hasWorkflow && (
            <div className="flex items-center bg-slate-800/80 rounded border border-slate-700/50 shrink-0 ml-1">
              <button
                onClick={() => setViewMode('flow')}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-l transition-colors ${
                  viewMode === 'flow'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title={t('jsonPreview.flowView', '流程图')}
              >
                <GitBranch className="w-3 h-3" />
                {t('jsonPreview.flowView', '流程图')}
              </button>
              <button
                onClick={() => setViewMode('json')}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-r transition-colors ${
                  viewMode === 'json'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title={t('jsonPreview.jsonView', 'JSON')}
              >
                <FileJson className="w-3 h-3" />
                JSON
              </button>
            </div>
          )}

          {/* Stats */}
          {!panel.minimized && (
            <span className="text-[10px] text-slate-500 shrink-0 ml-1">
              {viewMode === 'flow' && workflowStats
                ? `${workflowStats.nodes} ${t('workflowAi.nodeCount', '节点')} / ${workflowStats.connections} ${t('workflowAi.connectionCount', '连接')}`
                : `${stats.lines} ${t('jsonPreview.lines', '{{count}} 行', { count: stats.lines })} / ${stats.chars.toLocaleString()} ${t('jsonPreview.chars', '{{count}} 字符', { count: stats.chars })}`}
            </span>
          )}
        </div>

        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {!panel.minimized && (
            <>
              {/* Search toggle (only in JSON view mode) */}
              {viewMode === 'json' && (
                <button
                  onClick={() => {
                    setShowSearch(prev => !prev);
                    if (showSearch) setSearchTerm('');
                  }}
                  className="p-1 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
                  title={t('search', 'Search')}
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Copy */}
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
                title={t('copy', 'Copy')}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}

          {/* Minimize */}
          <button
            onClick={() => toggleMinimize(panel.id)}
            className="p-1 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
            title={panel.minimized ? t('restore', 'Restore') : t('minimize', 'Minimize')}
          >
            {panel.minimized ? (
              <Maximize2 className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Maximize */}
          {!panel.minimized && (
            <button
              onClick={() => toggleMaximize(panel.id)}
              className="p-1 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
              title={panel.maximized ? t('restore', 'Restore') : t('maximize', 'Maximize')}
            >
              {panel.maximized ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Close */}
          <button
            onClick={() => closePreview(panel.id)}
            className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
            title={t('close', 'Close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Everything below title bar (hidden when minimized) ──── */}
      {!panel.minimized && (
        <>
          {/* ── Search bar (collapsible) ────────────────────────── */}
          {showSearch && (
            <div className="px-3 py-1.5 bg-slate-800/60 border-b border-slate-700/30 flex items-center gap-2 shrink-0">
              <Search className="w-3 h-3 text-slate-500 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('searchPlaceholder', 'Search...')}
                className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none min-w-0"
              />
              {searchTerm && (
                <span className="text-[10px] text-slate-500 shrink-0">
                  {matchLines.length > 0
                    ? `${currentMatchIndex + 1}/${matchLines.length}`
                    : t('noMatches', '0 matches')}
                </span>
              )}
              <button
                onClick={handlePrevMatch}
                disabled={matchLines.length === 0}
                className="p-0.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-30"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNextMatch}
                disabled={matchLines.length === 0}
                className="p-0.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-30"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Content area ────────────────────────────────────── */}
          {viewMode === 'flow' && hasWorkflow && !isCompareMode ? (
            // ── Flow visualization mode ──
            <div className="flex-1 min-h-0 bg-slate-900">
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm">{t('button.loading', '加载中...')}</span>
                  </div>
                }
              >
                <LazyWorkflowVisualizer
                  workflowJson={panel.json}
                  className="w-full h-full"
                />
              </Suspense>
            </div>
          ) : isCompareMode ? (
            // ── Compare mode: side-by-side ──
            <div className="flex-1 flex min-h-0">
              {/* Left pane */}
              <div className="flex-1 flex flex-col min-w-0 border-r border-slate-700/40">
                <div className="px-3 py-1 bg-slate-800/50 border-b border-slate-700/30 shrink-0">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                    {panel.title}
                  </span>
                </div>
                <div
                  ref={leftScrollRef}
                  onScroll={handleLeftScroll}
                  className="flex-1 overflow-auto bg-slate-900"
                >
                  <CompareHighlight
                    json={panel.json}
                    searchTerm={searchTerm}
                    diffLines={diffResult?.leftDiff ?? new Set()}
                    diffColor="bg-red-500/10"
                  />
                </div>
              </div>

              {/* Right pane */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-3 py-1 bg-slate-800/50 border-b border-slate-700/30 shrink-0">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                    {panel.compareTitle ?? t('compare', 'Compare')}
                  </span>
                </div>
                <div
                  ref={rightScrollRef}
                  onScroll={handleRightScroll}
                  className="flex-1 overflow-auto bg-slate-900"
                >
                  <CompareHighlight
                    json={panel.compareJson!}
                    searchTerm={searchTerm}
                    diffLines={diffResult?.rightDiff ?? new Set()}
                    diffColor="bg-emerald-500/10"
                  />
                </div>
              </div>
            </div>
          ) : (
            // ── Normal JSON mode ──
            <div
              ref={contentRef}
              className="flex-1 overflow-auto bg-slate-900"
            >
              <div className="py-2">
                <JsonSyntaxHighlight json={panel.json} searchTerm={searchTerm} />
              </div>
            </div>
          )}

          {/* ── Resize handle (bottom-right corner) ─────────────── */}
          {!panel.maximized && (
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            >
              <GripHorizontal
                className="w-3 h-3 text-slate-500"
                style={{ transform: 'rotate(-45deg)' }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── CompareHighlight sub-component ───────────────────────────────────

interface CompareHighlightProps {
  json: string;
  searchTerm: string;
  diffLines: Set<number>;
  diffColor: string;
}

/**
 * Wraps JsonSyntaxHighlight and overlays per-line diff highlighting.
 * Uses a CSS approach: each line div gets a background if its index is in diffLines.
 */
const CompareHighlight: React.FC<CompareHighlightProps> = React.memo(
  ({ json, searchTerm, diffLines, diffColor }) => {
    const formatted = useMemo(() => tryFormatJson(json), [json]);
    const lineCount = useMemo(() => formatted.split('\n').length, [formatted]);

    return (
      <div className="relative py-2">
        {/* Diff highlight overlay */}
        {diffLines.size > 0 && (
          <div className="absolute inset-0 pointer-events-none py-2">
            {Array.from({ length: lineCount }, (_, i) =>
              diffLines.has(i) ? (
                <div
                  key={i}
                  className={`h-5 ${diffColor}`}
                />
              ) : (
                <div key={i} className="h-5" />
              )
            )}
          </div>
        )}
        <div className="relative">
          <JsonSyntaxHighlight json={json} searchTerm={searchTerm} />
        </div>
      </div>
    );
  }
);

CompareHighlight.displayName = 'CompareHighlight';

export default React.memo(JsonPreviewPanel);
