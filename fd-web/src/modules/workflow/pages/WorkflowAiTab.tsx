/**
 * 工作流中心 - AI 工作流页面
 *
 * 三栏布局：左侧工作流列表 | 中间 AI 对话面板 | 右侧工具面板（可折叠）
 * 通过 AI 对话生成/修改 n8n 工作流 JSON
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowAiApi } from '../../../shared/services/serverApi';
import type { AiWorkflow, WorkflowDesignResult } from '../../../shared/services/api/workflow';
import { useToast } from '../../../shared/hooks/useToast';
import {
  Plus, Send, Sparkles, MoreHorizontal, Trash2,
  PanelRightOpen, PanelRightClose, Pencil, Check, X,
  Loader2, Bot, User, Code, FileJson,
  MessageSquareWarning, MessageSquare, Wrench, ChevronDown, ChevronRight,
  Play, ExternalLink, Eye, Settings, Key, AlertTriangle,
} from 'lucide-react';
import { n8nConfigApi } from '../../../shared/services/api/workflow';
import { agentApi } from '../../../shared/services/serverApi';
import type { AgentDefinition } from '../../../shared/types/server';
import WorkspacePanel from '../components/WorkspacePanel';
import VersionHistory from '../components/VersionHistory';
import DeployPanel from '../components/DeployPanel';
import { useJsonPreview } from '../../../shared/components/JsonPreview';

// ============ 类型 ============

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  workflowJson?: string;
  designResult?: WorkflowDesignResult;
  loading?: boolean;
}

/** 单个迭代（对话线程），绑定一个 Agent */
interface Iteration {
  id: string;
  agentCode: string;
  agentName: string;
  messages: ConversationMessage[];
  createdAt: number;
}

/** 每个工作流的迭代集合 */
interface WorkflowIterations {
  activeIterationId: string | null;
  iterations: Iteration[];
}

// ============ localStorage 工具函数 ============

const ITER_STORAGE_PREFIX = 'fd-wf-iter:';

function loadIterations(workflowId: number): WorkflowIterations {
  try {
    const raw = localStorage.getItem(`${ITER_STORAGE_PREFIX}${workflowId}`);
    return raw ? JSON.parse(raw) : { activeIterationId: null, iterations: [] };
  } catch {
    return { activeIterationId: null, iterations: [] };
  }
}

function saveIterations(workflowId: number, data: WorkflowIterations): void {
  try {
    localStorage.setItem(`${ITER_STORAGE_PREFIX}${workflowId}`, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function removeIterations(workflowId: number): void {
  localStorage.removeItem(`${ITER_STORAGE_PREFIX}${workflowId}`);
}

// ============ 工具函数 ============

function generateId(): string {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 从 AI 回复中解析结构化设计结果 */
function tryParseDesignResult(text: string): { designResult: WorkflowDesignResult | null; workflowJson: string | null } {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return { designResult: null, workflowJson: null };

  try {
    const parsed = JSON.parse(match[1]);

    // 优先尝试结构化格式（包含 explanation + workflowJson）
    if (parsed.workflowJson && parsed.explanation) {
      const result: WorkflowDesignResult = {
        explanation: parsed.explanation || '',
        workflowJson: parsed.workflowJson,
        agentPromptAdjustments: Array.isArray(parsed.agentPromptAdjustments) ? parsed.agentPromptAdjustments : [],
        apiAdjustments: Array.isArray(parsed.apiAdjustments) ? parsed.apiAdjustments : [],
      };
      const wfJson = typeof parsed.workflowJson === 'object'
        ? JSON.stringify(parsed.workflowJson, null, 2)
        : null;
      return { designResult: result, workflowJson: wfJson };
    }

    // 回退：兼容旧格式（直接是 n8n 工作流 JSON）
    if (parsed.nodes && parsed.connections) {
      return { designResult: null, workflowJson: match[1].trim() };
    }

    return { designResult: null, workflowJson: null };
  } catch {
    return { designResult: null, workflowJson: null };
  }
}

/** 简要解析 JSON 中的节点信息 */
function parseJsonSummary(json: string | null): { nodeCount: number; connectionCount: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    const connectionCount = parsed.connections
      ? Object.keys(parsed.connections).length
      : 0;
    return { nodeCount, connectionCount };
  } catch {
    return null;
  }
}

// ============ 状态 Badge ============

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'workflowAi.status.draft' },
  DEPLOYED: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'workflowAi.status.deployed' },
  ACTIVE: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'workflowAi.status.active' },
  INACTIVE: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'workflowAi.status.inactive' },
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation('common');
  const style = STATUS_STYLES[status] || STATUS_STYLES.DRAFT;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
      {t(style.label as any)}
    </span>
  );
};

// ============ 左侧列表面板 ============

const WorkflowListPanel: React.FC<{
  workflows: AiWorkflow[];
  selectedId: number | null;
  onSelect: (wf: AiWorkflow) => void;
  onCreate: () => void;
  onDelete: (wf: AiWorkflow) => void;
  loading: boolean;
}> = ({ workflows, selectedId, onSelect, onCreate, onDelete, loading }) => {
  const { t } = useTranslation('common');
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId !== null) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  return (
    <div className="w-60 flex-shrink-0 border-r border-slate-700/50 flex flex-col overflow-hidden">
      {/* 标题 + 新建按钮 */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-300">{t('workflowAi.title')}</span>
        <button
          onClick={onCreate}
          className="p-1 rounded text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 transition-colors"
          title={t('workflowAi.create')}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-8">
            {t('workflowAi.emptyList')}
          </div>
        ) : (
          workflows.map(wf => (
            <div
              key={wf.id}
              onClick={() => onSelect(wf)}
              className={`px-4 py-3 cursor-pointer border-b border-slate-800/50 transition-colors relative group ${
                selectedId === wf.id
                  ? 'bg-slate-700/40 border-l-2 border-l-blue-500'
                  : 'hover:bg-slate-800/50 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-200 truncate flex-1 mr-2">
                  {wf.name}
                </span>
                <div className="flex items-center gap-1">
                  <StatusBadge status={wf.status} />
                  <div className="relative" ref={menuOpenId === wf.id ? menuRef : undefined}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === wf.id ? null : wf.id);
                      }}
                      className="p-0.5 rounded text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                    {menuOpenId === wf.id && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded shadow-lg py-1 min-w-[100px]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            onDelete(wf);
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-slate-700/50 flex items-center gap-2"
                        >
                          <Trash2 className="w-3 h-3" />
                          {t('button.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {wf.description && (
                <p className="text-xs text-slate-500 mt-1 truncate">{wf.description}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============ 消息气泡 ============

/** 可折叠区块组件 */
const CollapsibleSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}> = ({ title, icon, count, children, defaultOpen = false, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`mt-3 border border-slate-600/50 rounded-lg overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-700/30 hover:bg-slate-700/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        {icon}
        <span className="text-xs font-medium text-slate-300 flex-1">{title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-600/50 text-slate-400">{count}</span>
      </button>
      {open && <div className="px-3 py-2 space-y-2">{children}</div>}
    </div>
  );
};

const MessageBubble: React.FC<{
  message: ConversationMessage;
  onApplyJson?: (json: string) => void;
  onPreviewJson?: (json: string) => void;
}> = ({ message, onApplyJson, onPreviewJson }) => {
  const { t } = useTranslation('common');
  const isUser = message.role === 'user';

  if (message.loading) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="w-7 h-7 rounded-full bg-purple-600/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-purple-400" />
        </div>
        <div className="bg-slate-800/70 border border-slate-700/50 rounded-lg px-4 py-3 max-w-[80%]">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('workflowAi.thinking')}
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex items-start gap-3 mb-4 justify-end">
        <div className="bg-blue-600/20 border border-blue-500/30 rounded-lg px-4 py-3 max-w-[80%]">
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-blue-400" />
        </div>
      </div>
    );
  }

  // assistant 消息
  const dr = message.designResult;
  const hasStructuredResult = !!dr;

  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-7 h-7 rounded-full bg-purple-600/20 flex items-center justify-center flex-shrink-0">
        <Bot className="w-4 h-4 text-purple-400" />
      </div>
      <div className="bg-slate-800/70 border border-slate-700/50 rounded-lg px-4 py-3 max-w-[85%] overflow-hidden">
        {hasStructuredResult ? (
          <>
            {/* 设计说明 */}
            <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {dr.explanation}
            </div>

            {/* 工作流 JSON 操作 */}
            <div className="flex items-center gap-2">
              {message.workflowJson && onApplyJson && (
                <button
                  onClick={() => onApplyJson(message.workflowJson!)}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-colors"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  {t('workflowAi.applyJson')}
                </button>
              )}
              {message.workflowJson && onPreviewJson && (
                <button
                  onClick={() => onPreviewJson(message.workflowJson!)}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/30 border border-slate-600/30 rounded text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-300 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {t('jsonPreview.preview')}
                </button>
              )}
            </div>

            {/* Agent 提示词调整建议 */}
            {dr.agentPromptAdjustments.length > 0 && (
              <CollapsibleSection
                title={t('workflowAi.agentPromptAdjustments')}
                icon={<MessageSquareWarning className="w-3.5 h-3.5 text-amber-400" />}
                count={dr.agentPromptAdjustments.length}
                defaultOpen
              >
                {dr.agentPromptAdjustments.map((adj, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-700/30 rounded p-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-medium text-amber-300">{adj.agentCode}</span>
                      <span className="text-[10px] text-slate-500">({adj.agentName})</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">{adj.reason}</p>
                    <details className="group">
                      <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400 select-none">
                        {t('workflowAi.viewSuggestedPrompt')}
                      </summary>
                      <pre className="mt-1.5 bg-slate-900/80 border border-slate-700/50 p-2 rounded text-[11px] text-slate-300 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {adj.suggestedPrompt}
                      </pre>
                    </details>
                  </div>
                ))}
              </CollapsibleSection>
            )}

            {/* API 调整建议 */}
            {dr.apiAdjustments.length > 0 && (
              <CollapsibleSection
                title={t('workflowAi.apiAdjustments')}
                icon={<Wrench className="w-3.5 h-3.5 text-cyan-400" />}
                count={dr.apiAdjustments.length}
                defaultOpen
              >
                {dr.apiAdjustments.map((adj, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-700/30 rounded p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400 font-mono">{adj.method}</span>
                      <span className="text-xs font-mono text-slate-300">{adj.endpoint}</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-1">{adj.description}</p>
                    <p className="text-xs text-slate-500">{adj.suggestedChanges}</p>
                  </div>
                ))}
              </CollapsibleSection>
            )}
          </>
        ) : (
          <>
            {/* 旧格式：纯文本渲染 */}
            <AssistantContent content={message.content} />
            <div className="flex items-center gap-2">
              {message.workflowJson && onApplyJson && (
                <button
                  onClick={() => onApplyJson(message.workflowJson!)}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-colors"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  {t('workflowAi.applyJson')}
                </button>
              )}
              {message.workflowJson && onPreviewJson && (
                <button
                  onClick={() => onPreviewJson(message.workflowJson!)}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/30 border border-slate-600/30 rounded text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-300 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {t('jsonPreview.preview')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** 简易 Markdown 渲染：代码块、内联代码、换行 */
const AssistantContent: React.FC<{ content: string }> = ({ content }) => {
  // 将内容按 ```...``` 分割为文本段和代码段
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="text-sm text-slate-300 space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          // 代码块
          const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
          const lang = match?.[1] || '';
          const code = match?.[2] || part.slice(3, -3);
          return (
            <div key={i} className="relative">
              {lang && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900/80 border border-slate-700/50 border-b-0 rounded-t text-[10px] text-slate-500">
                  <Code className="w-3 h-3" />
                  {lang}
                </div>
              )}
              <pre className={`bg-slate-900/80 border border-slate-700/50 p-3 overflow-x-auto text-xs text-slate-300 font-mono ${lang ? 'rounded-b' : 'rounded'}`}>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        // 普通文本
        return (
          <div key={i} className="whitespace-pre-wrap leading-relaxed">
            {part.split(/(`[^`]+`)/g).map((seg, j) => {
              if (seg.startsWith('`') && seg.endsWith('`')) {
                return (
                  <code key={j} className="px-1 py-0.5 bg-slate-700/50 rounded text-xs text-blue-300 font-mono">
                    {seg.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j}>{seg}</span>;
            })}
          </div>
        );
      })}
    </div>
  );
};

// ============ 迭代标签栏 ============

const IterationBar: React.FC<{
  iterations: Iteration[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}> = ({ iterations, activeId, onSwitch, onCreate, onDelete }) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-700/30 overflow-x-auto flex-shrink-0">
      {/* New iteration button */}
      <button
        onClick={onCreate}
        className="flex items-center gap-1 px-3 py-1.5 text-xs text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg transition-colors flex-shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('workflowAi.iteration.new')}
      </button>

      {/* Iteration tabs */}
      {iterations.map((iter, idx) => (
        <div
          key={iter.id}
          onClick={() => onSwitch(iter.id)}
          className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors flex-shrink-0 ${
            activeId === iter.id
              ? 'bg-slate-700/50 text-white border border-slate-600/50'
              : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
          <span className="truncate max-w-[120px]">
            {iter.agentName} #{idx + 1}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(iter.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-red-400 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
};

// ============ Agent 选择弹窗 ============

const AgentSelectDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (agentCode: string, agentName: string) => void;
}> = ({ open, onClose, onSelect }) => {
  const { t } = useTranslation('common');
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    agentApi.getDefinitions()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = agents.filter(a =>
    !search || a.code.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[400px] max-h-[500px] bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
          <h3 className="text-sm font-semibold text-white">{t('workflowAi.iteration.selectAgent')}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3">
          <input
            type="text"
            placeholder={t('workflowAi.iteration.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700/50 text-slate-300 rounded-lg focus:outline-none focus:border-indigo-500/50"
            autoFocus
          />
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-indigo-400" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-6">
              {t('workflowAi.iteration.noAgent')}
            </div>
          )}
          {!loading && filtered.map(agent => (
            <div
              key={agent.code}
              onClick={() => onSelect(agent.code, agent.name)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer hover:bg-slate-800/70 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">{agent.name || agent.code}</div>
                <div className="text-xs text-slate-500">{agent.code} · {agent.capability || agent.requiredCapability || '-'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ 中间对话面板 ============

const ChatPanel: React.FC<{
  workflow: AiWorkflow | null;
  messages: ConversationMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  onApplyJson: (json: string) => void;
  onPreviewJson?: (json: string) => void;
  onRename: (name: string) => void;
  activeIteration: Iteration | null;
  iterations: Iteration[];
  activeIterationId: string | null;
  onSwitchIteration: (id: string) => void;
  onCreateIteration: () => void;
  onDeleteIteration: (id: string) => void;
}> = ({ workflow, messages, sending, onSend, onApplyJson, onPreviewJson, onRename, activeIteration, iterations, activeIterationId, onSwitchIteration, onCreateIteration, onDeleteIteration }) => {
  const { t } = useTranslation('common');
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // textarea 自适应高度
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setInput('');
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, sending, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const startRename = useCallback(() => {
    if (!workflow) return;
    setEditName(workflow.name);
    setEditing(true);
  }, [workflow]);

  const confirmRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== workflow?.name) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editName, workflow, onRename]);

  if (!workflow) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-slate-500">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">{t('workflowAi.selectPlaceholder')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* 顶部标题栏 */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2 flex-shrink-0">
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 flex-1 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <button onClick={confirmRename} className="p-1 text-green-400 hover:text-green-300">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => setEditing(false)} className="p-1 text-slate-400 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <h3 className="text-sm font-medium text-slate-200 truncate">{workflow.name}</h3>
            <button
              onClick={startRename}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title={t('button.edit')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <StatusBadge status={workflow.status} />
          </>
        )}
      </div>

      {/* 迭代标签栏 */}
      <IterationBar
        iterations={iterations}
        activeId={activeIterationId}
        onSwitch={onSwitchIteration}
        onCreate={onCreateIteration}
        onDelete={onDeleteIteration}
      />

      {/* 对话消息列表 */}
      {!activeIteration ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3">
          <MessageSquare className="w-10 h-10 text-slate-600" />
          <p className="text-sm">{t('workflowAi.iteration.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Bot className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">{t('workflowAi.emptyChat')}</p>
              <p className="text-xs mt-1 text-slate-600">{t('workflowAi.emptyChatHint')}</p>
            </div>
          )}
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} onApplyJson={onApplyJson} onPreviewJson={onPreviewJson} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 底部输入区 */}
      {activeIteration && (
        <div className="px-4 py-3 border-t border-slate-700/50 flex-shrink-0">
          <div className="flex items-end gap-2 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('workflowAi.inputPlaceholder')}
              rows={1}
              className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none max-h-40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                input.trim() && !sending
                  ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-600/20'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-slate-600 mt-1 px-1">
            {t('workflowAi.inputHint')}
          </p>
        </div>
      )}
    </div>
  );
};

// ============ 右侧工具面板 ============

const ToolPanel: React.FC<{
  workflow: AiWorkflow | null;
  currentJson: string | null;
  onDeploy: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onRollback: (versionNumber: number) => void;
  onPreviewVersion?: (json: string) => void;
  onViewFullJson?: () => void;
  deploying?: boolean;
}> = ({ workflow, currentJson, onDeploy, onActivate, onDeactivate, onRollback, onPreviewVersion, onViewFullJson, deploying }) => {
  const { t } = useTranslation('common');
  const summary = useMemo(() => parseJsonSummary(currentJson), [currentJson]);
  const [showExecutions, setShowExecutions] = useState(false);

  if (!workflow) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标题 */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
        <span className="text-sm font-medium text-slate-300">{t('workflowAi.toolPanel')}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* JSON 摘要 */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
            <FileJson className="w-3.5 h-3.5" />
            {t('workflowAi.jsonSummary')}
          </h4>
          {summary ? (
            <div className="space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('workflowAi.nodeCount')}</span>
                <span>{summary.nodeCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('workflowAi.connectionCount')}</span>
                <span>{summary.connectionCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('workflowAi.version')}</span>
                <span>v{workflow.currentVersion}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">{t('workflowAi.noJson')}</p>
          )}
          {currentJson && onViewFullJson && (
            <button
              onClick={onViewFullJson}
              className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-slate-400 hover:text-blue-400 border border-dashed border-slate-600/50 hover:border-blue-500/30 rounded transition-colors"
            >
              <Eye className="w-3 h-3" />
              {t('jsonPreview.viewFull')}
            </button>
          )}
        </div>

        {/* 工作流信息 */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-slate-400 mb-2">{t('workflowAi.workflowInfo')}</h4>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">ID</span>
              <span className="text-slate-300">{workflow.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t('workflowAi.createdBy')}</span>
              <span className="text-slate-300">{workflow.createdBy}</span>
            </div>
            {workflow.n8nWorkflowId && (
              <div className="flex justify-between">
                <span className="text-slate-500">n8n ID</span>
                <span className="text-slate-300 font-mono">{workflow.n8nWorkflowId}</span>
              </div>
            )}
          </div>
        </div>

        {/* 部署管理 */}
        <DeployPanel
          workflow={workflow}
          onDeploy={onDeploy}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          deploying={deploying}
        />

        {/* 执行记录 */}
        {workflow.n8nWorkflowId && (
          <>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <h4 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" />
                {t('workflowAi.executions')}
              </h4>
              <button
                onClick={() => setShowExecutions(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t('workflowAi.viewExecutions')}
              </button>
            </div>

            {/* 执行记录弹窗 */}
            {showExecutions && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowExecutions(false)}>
                <div
                  className="bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
                  style={{ width: '90vw', height: '85vh' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-100 border-b">
                    <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                      <Play className="w-4 h-4 text-slate-500" />
                      {t('workflowAi.executions')} — {workflow.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/n8n/workflow/${workflow.n8nWorkflowId}/executions`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-500 transition-colors"
                      >
                        {t('workflowAi.openInN8n')}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        onClick={() => setShowExecutions(false)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={`/n8n/workflow/${workflow.n8nWorkflowId}/executions`}
                    className="flex-1 w-full border-0"
                    title="n8n executions"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* 版本历史 */}
        <VersionHistory
          workflowId={workflow.id}
          currentVersion={workflow.currentVersion}
          onRollback={onRollback}
          onPreview={onPreviewVersion}
        />

        {/* 工作区文档管理 */}
        <WorkspacePanel workflowId={workflow.id} />
      </div>
    </div>
  );
};

// ============ 新建对话框 ============

const CreateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string, description: string) => void;
  loading: boolean;
}> = ({ open, onClose, onConfirm, loading }) => {
  const { t } = useTranslation('common');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg w-[420px] p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-slate-200 font-medium mb-4">{t('workflowAi.createTitle')}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('workflowAi.nameLabel')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('workflowAi.namePlaceholder')}
              className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && name.trim()) {
                  onConfirm(name.trim(), description.trim());
                }
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('workflowAi.descriptionLabel')}</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('workflowAi.descriptionPlaceholder')}
              rows={2}
              className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            {t('button.cancel')}
          </button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim(), description.trim())}
            disabled={!name.trim() || loading}
            className={`px-4 py-1.5 text-sm rounded transition-colors ${
              name.trim() && !loading
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {loading ? t('button.loading') : t('button.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 删除确认对话框 ============

const DeleteDialog: React.FC<{
  workflow: AiWorkflow | null;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ workflow, onConfirm, onCancel }) => {
  const { t } = useTranslation('common');
  if (!workflow) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg w-[400px] p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-slate-200 font-medium mb-3">{t('confirmDialog.defaultTitle')}</h3>
        <p className="text-slate-400 text-sm mb-6">
          {t('workflowAi.confirmDelete', { name: workflow.name })}
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
            className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
          >
            {t('confirmDialog.defaultConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 主组件 ============

const WorkflowAiTab: React.FC = () => {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const { openPreview } = useJsonPreview();

  // 工作流列表
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 迭代管理（替代原有 conversations）
  const [iterationsMap, setIterationsMap] = useState<Record<number, WorkflowIterations>>({});
  const [showAgentSelect, setShowAgentSelect] = useState(false);
  const [sending, setSending] = useState(false);

  // 当前 JSON（本地状态，从 AI 回复或加载中获取）
  const [currentJson, setCurrentJson] = useState<string | null>(null);

  // 右侧面板折叠
  const [toolPanelOpen, setToolPanelOpen] = useState(true);

  // 部署
  const [deploying, setDeploying] = useState(false);

  // 对话框
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiWorkflow | null>(null);

  // n8n 配置
  const [n8nConfigOpen, setN8nConfigOpen] = useState(false);
  const [n8nApiUrl, setN8nApiUrl] = useState('');
  const [n8nApiKey, setN8nApiKey] = useState('');
  const [n8nConfigured, setN8nConfigured] = useState<boolean | null>(null); // null=loading
  const [n8nSaving, setN8nSaving] = useState(false);

  const selectedWorkflow = useMemo(
    () => workflows.find(w => w.id === selectedId) || null,
    [workflows, selectedId],
  );

  // Derived iteration state
  const currentWorkflowIters = selectedId ? iterationsMap[selectedId] : null;
  const activeIteration = currentWorkflowIters?.iterations.find(
    it => it.id === currentWorkflowIters.activeIterationId
  ) || null;
  const currentMessages = activeIteration?.messages || [];

  // Load iterations from localStorage when workflow is selected
  useEffect(() => {
    if (selectedId && !iterationsMap[selectedId]) {
      setIterationsMap(prev => ({ ...prev, [selectedId]: loadIterations(selectedId) }));
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist iterations to localStorage on change
  useEffect(() => {
    if (selectedId && iterationsMap[selectedId]) {
      saveIterations(selectedId, iterationsMap[selectedId]);
    }
  }, [selectedId, iterationsMap]);

  // 加载工作流列表
  const loadWorkflows = useCallback(async () => {
    setListLoading(true);
    try {
      const list = await workflowAiApi.list();
      setWorkflows(list || []);
    } catch (err: any) {
      toast('error', err.message || t('message.loadFailed'));
    } finally {
      setListLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // 加载 n8n 配置状态
  const loadN8nConfig = useCallback(async () => {
    try {
      const config = await n8nConfigApi.getConfig();
      setN8nApiUrl(config.apiUrl || '');
      setN8nApiKey(config.apiKey || '');
      setN8nConfigured(config.configured);
    } catch {
      setN8nConfigured(false);
    }
  }, []);

  useEffect(() => {
    loadN8nConfig();
  }, [loadN8nConfig]);

  // 保存 n8n 配置
  const handleSaveN8nConfig = useCallback(async () => {
    setN8nSaving(true);
    try {
      await n8nConfigApi.setConfig({
        apiUrl: n8nApiUrl || undefined,
        apiKey: n8nApiKey || undefined,
      });
      toast('success', t('workflowAi.n8nConfig.saved'));
      setN8nConfigOpen(false);
      // 重新加载配置状态和工作流列表
      await loadN8nConfig();
      loadWorkflows();
    } catch (err: any) {
      toast('error', err.message || t('workflowAi.n8nConfig.saveFailed'));
    } finally {
      setN8nSaving(false);
    }
  }, [n8nApiUrl, n8nApiKey, toast, t, loadN8nConfig, loadWorkflows]);

  // 选中工作流后加载详情
  useEffect(() => {
    if (selectedId && selectedWorkflow) {
      setCurrentJson(selectedWorkflow.currentJson || null);
    }
  }, [selectedId, selectedWorkflow]);

  // ============ 迭代管理 ============

  const handleCreateIteration = useCallback((agentCode: string, agentName: string) => {
    if (!selectedId) return;
    const wfIters = iterationsMap[selectedId] || { activeIterationId: null, iterations: [] };
    const newIter: Iteration = {
      id: generateId(),
      agentCode,
      agentName,
      messages: [],
      createdAt: Date.now(),
    };
    setIterationsMap(prev => ({
      ...prev,
      [selectedId]: {
        activeIterationId: newIter.id,
        iterations: [...wfIters.iterations, newIter],
      },
    }));
    setShowAgentSelect(false);
  }, [selectedId, iterationsMap]);

  const handleSwitchIteration = useCallback((iterationId: string) => {
    if (!selectedId) return;
    setIterationsMap(prev => ({
      ...prev,
      [selectedId]: { ...prev[selectedId], activeIterationId: iterationId },
    }));
  }, [selectedId]);

  const handleDeleteIteration = useCallback((iterationId: string) => {
    if (!selectedId) return;
    setIterationsMap(prev => {
      const wfIters = prev[selectedId];
      if (!wfIters) return prev;
      const remaining = wfIters.iterations.filter(it => it.id !== iterationId);
      return {
        ...prev,
        [selectedId]: {
          activeIterationId: wfIters.activeIterationId === iterationId
            ? (remaining[remaining.length - 1]?.id || null)
            : wfIters.activeIterationId,
          iterations: remaining,
        },
      };
    });
  }, [selectedId]);

  const updateIterationMessages = useCallback((
    workflowId: number,
    iterationId: string,
    updater: (msgs: ConversationMessage[]) => ConversationMessage[]
  ) => {
    setIterationsMap(prev => {
      const wfIters = prev[workflowId];
      if (!wfIters) return prev;
      return {
        ...prev,
        [workflowId]: {
          ...wfIters,
          iterations: wfIters.iterations.map(it =>
            it.id === iterationId
              ? { ...it, messages: updater(it.messages) }
              : it
          ),
        },
      };
    });
  }, []);

  // 选中工作流
  const handleSelect = useCallback((wf: AiWorkflow) => {
    setSelectedId(wf.id);
  }, []);

  // 新建工作流
  const handleCreate = useCallback(async (name: string, description: string) => {
    setCreating(true);
    try {
      const created = await workflowAiApi.create({ name, description: description || undefined });
      setWorkflows(prev => [created, ...prev]);
      setSelectedId(created.id);
      setCreateDialogOpen(false);
      toast('success', t('message.operationSuccess'));
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    } finally {
      setCreating(false);
    }
  }, [t, toast]);

  // 删除工作流
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await workflowAiApi.delete(deleteTarget.id);
      setWorkflows(prev => prev.filter(w => w.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setCurrentJson(null);
      }
      // 清除迭代历史（内存 + localStorage）
      removeIterations(deleteTarget.id);
      setIterationsMap(prev => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      toast('success', t('message.operationSuccess'));
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, selectedId, t, toast]);

  // 重命名工作流（通过 updateJson 接口，仅改名暂用 create 后 reload）
  const handleRename = useCallback(async (name: string) => {
    if (!selectedId) return;
    try {
      // 使用 create 重载列表（后端暂无 rename 端点，后续 Phase 补充）
      // 暂时通过 reload 列表模拟
      await workflowAiApi.updateJson(selectedId, {
        json: currentJson || '{}',
        changeDescription: `Renamed to: ${name}`,
      });
      await loadWorkflows();
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    }
  }, [selectedId, currentJson, loadWorkflows, t, toast]);

  // 发送消息
  const handleSend = useCallback(async (userMessage: string) => {
    if (!selectedId || !activeIteration) return;
    setSending(true);

    const userMsg: ConversationMessage = {
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    const loadingMsg: ConversationMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      loading: true,
    };

    // Add messages to active iteration
    updateIterationMessages(selectedId, activeIteration.id, msgs => [...msgs, userMsg, loadingMsg]);

    // Build history from active iteration's messages as ChatMessage array
    const history = activeIteration.messages
      .filter(m => !m.loading)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await workflowAiApi.chat(selectedId, {
        userMessage,
        conversationHistory: history,
        agentCode: activeIteration.agentCode,
      });

      const output = result?.output || result?.errorMessage || t('workflowAi.requestFailed');
      const { designResult, workflowJson } = tryParseDesignResult(output);

      updateIterationMessages(selectedId, activeIteration.id, msgs =>
        msgs.map(m =>
          m.id === loadingMsg.id
            ? {
                ...m,
                content: designResult ? designResult.explanation : output,
                loading: false,
                workflowJson: workflowJson || undefined,
                designResult: designResult || undefined,
              }
            : m
        )
      );

      if (workflowJson) {
        setCurrentJson(workflowJson);
      }
    } catch (err: any) {
      updateIterationMessages(selectedId, activeIteration.id, msgs =>
        msgs.map(m =>
          m.id === loadingMsg.id
            ? { ...m, content: `${t('workflowAi.error')}: ${err.message || t('workflowAi.requestFailed')}`, loading: false }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }, [selectedId, activeIteration, t, updateIterationMessages]);

  // 应用 JSON
  const handleApplyJson = useCallback(async (json: string) => {
    if (!selectedId) return;
    try {
      const updated = await workflowAiApi.updateJson(selectedId, {
        json,
        changeDescription: 'Applied from AI chat',
      });
      setCurrentJson(json);
      setWorkflows(prev =>
        prev.map(w => (w.id === selectedId ? { ...w, ...updated } : w)),
      );
      toast('success', t('workflowAi.jsonApplied'));
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    }
  }, [selectedId, t, toast]);

  // 刷新单个工作流
  const refreshWorkflow = useCallback(async (id: number) => {
    try {
      const updated = await workflowAiApi.getById(id);
      setWorkflows(prev => prev.map(w => (w.id === id ? updated : w)));
      if (id === selectedId) {
        setCurrentJson(updated.currentJson || null);
      }
    } catch {
      // fallback: 重新加载整个列表
      await loadWorkflows();
    }
  }, [selectedId, loadWorkflows]);

  // 部署到 n8n
  const handleDeploy = useCallback(async () => {
    if (!selectedWorkflow) return;
    setDeploying(true);
    try {
      await workflowAiApi.deploy(selectedWorkflow.id);
      await refreshWorkflow(selectedWorkflow.id);
      toast('success', t('workflowAi.deploy.deploySuccess'));
    } catch (err: any) {
      toast('error', t('workflowAi.deploy.deployFailed') + ': ' + (err.message || ''));
    } finally {
      setDeploying(false);
    }
  }, [selectedWorkflow, refreshWorkflow, t, toast]);

  // 激活
  const handleActivate = useCallback(async () => {
    if (!selectedWorkflow) return;
    try {
      await workflowAiApi.activate(selectedWorkflow.id);
      await refreshWorkflow(selectedWorkflow.id);
      toast('success', t('workflowAi.deploy.activateSuccess'));
    } catch (err: any) {
      toast('error', t('workflowAi.deploy.activateFailed') + ': ' + (err.message || ''));
    }
  }, [selectedWorkflow, refreshWorkflow, t, toast]);

  // 停用
  const handleDeactivate = useCallback(async () => {
    if (!selectedWorkflow) return;
    try {
      await workflowAiApi.deactivate(selectedWorkflow.id);
      await refreshWorkflow(selectedWorkflow.id);
      toast('success', t('workflowAi.deploy.deactivateSuccess'));
    } catch (err: any) {
      toast('error', t('workflowAi.deploy.deactivateFailed') + ': ' + (err.message || ''));
    }
  }, [selectedWorkflow, refreshWorkflow, t, toast]);

  // 回滚版本
  const handleRollback = useCallback(async (versionNumber: number) => {
    if (!selectedWorkflow) return;
    try {
      const result = await workflowAiApi.rollback(selectedWorkflow.id, { versionNumber });
      setWorkflows(prev => prev.map(w => (w.id === selectedWorkflow.id ? result : w)));
      setCurrentJson(result.currentJson || null);
      toast('success', t('workflowAi.versionHistory.rollbackSuccess'));
    } catch (err: any) {
      toast('error', t('workflowAi.versionHistory.rollbackFailed') + ': ' + (err.message || ''));
    }
  }, [selectedWorkflow, t, toast]);

  // 预览版本 JSON
  const handlePreviewVersion = useCallback((json: string) => {
    setCurrentJson(json);
    openPreview({ title: t('workflowAi.versionHistory.preview'), json });
  }, [openPreview, t]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* n8n API 配置提示 */}
      {n8nConfigured === false && !n8nConfigOpen && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <AlertTriangle className="w-4 h-4" />
            <span>{t('workflowAi.n8nConfig.notConfigured')}</span>
          </div>
          <button
            onClick={() => setN8nConfigOpen(true)}
            className="px-3 py-1 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" />
            {t('workflowAi.n8nConfig.configure')}
          </button>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧列表 */}
        <WorkflowListPanel
          workflows={workflows}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={() => setCreateDialogOpen(true)}
          onDelete={wf => setDeleteTarget(wf)}
          loading={listLoading}
        />

        {/* 中间对话面板 */}
        <ChatPanel
          workflow={selectedWorkflow}
          messages={currentMessages}
          sending={sending}
          onSend={handleSend}
          onApplyJson={handleApplyJson}
          onPreviewJson={(json) => openPreview({ title: t('jsonPreview.preview'), json })}
          onRename={handleRename}
          activeIteration={activeIteration}
          iterations={currentWorkflowIters?.iterations || []}
          activeIterationId={currentWorkflowIters?.activeIterationId || null}
          onSwitchIteration={handleSwitchIteration}
          onCreateIteration={() => setShowAgentSelect(true)}
          onDeleteIteration={handleDeleteIteration}
        />

        {/* 右侧工具面板 */}
        {selectedWorkflow && (
          <>
            {/* 折叠切换按钮 */}
            <button
              onClick={() => setToolPanelOpen(v => !v)}
              className="flex-shrink-0 w-6 flex items-center justify-center border-l border-slate-700/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
              title={toolPanelOpen ? t('workflowAi.collapsePanel') : t('workflowAi.expandPanel')}
            >
              {toolPanelOpen ? (
                <PanelRightClose className="w-3.5 h-3.5" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5" />
              )}
            </button>

            {toolPanelOpen && (
              <div className="w-72 flex-shrink-0 border-l border-slate-700/50 h-full overflow-hidden">
                <ToolPanel
                  workflow={selectedWorkflow}
                  currentJson={currentJson}
                  onDeploy={handleDeploy}
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                  onRollback={handleRollback}
                  onPreviewVersion={handlePreviewVersion}
                  onViewFullJson={() => currentJson && openPreview({ title: `${selectedWorkflow?.name || 'Workflow'} - JSON`, json: currentJson })}
                  deploying={deploying}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 对话框 */}
      <CreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onConfirm={handleCreate}
        loading={creating}
      />
      <DeleteDialog
        workflow={deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <AgentSelectDialog
        open={showAgentSelect}
        onClose={() => setShowAgentSelect(false)}
        onSelect={handleCreateIteration}
      />

      {/* n8n 配置弹窗 */}
      {n8nConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setN8nConfigOpen(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Key className="w-5 h-5 text-blue-400" />
              <h3 className="text-slate-200 font-medium">{t('workflowAi.n8nConfig.title')}</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('workflowAi.n8nConfig.apiUrl')}</label>
                <input
                  value={n8nApiUrl}
                  onChange={e => setN8nApiUrl(e.target.value)}
                  placeholder="http://localhost:5678"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t('workflowAi.n8nConfig.apiUrlHint')}</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('workflowAi.n8nConfig.apiKey')}</label>
                <input
                  value={n8nApiKey}
                  onChange={e => setN8nApiKey(e.target.value)}
                  placeholder={t('workflowAi.n8nConfig.apiKeyPlaceholder')}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t('workflowAi.n8nConfig.apiKeyHint')}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                onClick={() => setN8nConfigOpen(false)}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
              >
                {t('button.cancel')}
              </button>
              <button
                onClick={handleSaveN8nConfig}
                disabled={n8nSaving}
                className={`px-4 py-1.5 text-sm rounded transition-colors ${
                  !n8nSaving
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {n8nSaving ? t('button.loading') : t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowAiTab;
