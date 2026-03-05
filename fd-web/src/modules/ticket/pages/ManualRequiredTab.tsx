/**
 * 人工处理工单页面
 *
 * 展示 MANUAL_REQUIRED 状态的工单列表，提供"继续处理"和"直接完结"操作
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { request } from '../../../shared/services/serverApi';
import type { ServerTicket } from '../../../shared/types/server';
import { getTicketCategoryLabel, getTicketCategoryColor } from '../../../shared/utils/statusLabels';
import {
  AlertTriangle, RefreshCw, ChevronDown, ChevronRight,
  Play, CheckCircle2, Inbox, Loader2,
} from 'lucide-react';

// ============ 工单卡片 ============

interface TicketCardProps {
  ticket: ServerTicket;
  onAction: (ticketId: number, action: 'continue' | 'complete') => Promise<void>;
}

const TicketCard: React.FC<TicketCardProps> = ({ ticket, onAction }) => {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<'continue' | 'complete' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'continue' | 'complete' | null>(null);

  const handleAction = useCallback(async (action: 'continue' | 'complete') => {
    if (confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    setActing(action);
    setConfirmAction(null);
    try {
      await onAction(ticket.id, action);
    } finally {
      setActing(null);
    }
  }, [onAction, ticket.id, confirmAction]);

  // 点击卡片外部时取消确认状态
  const handleBlur = useCallback(() => {
    setTimeout(() => setConfirmAction(null), 200);
  }, []);

  const createdAt = ticket.createdAt
    ? new Date(ticket.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600/60 transition-colors">
      {/* 头部 */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* 第一行：ID + 分类 + 时间 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-slate-400">
              #{ticket.externalId || ticket.id}
            </span>
            {ticket.ticketCategory && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${getTicketCategoryColor(ticket.ticketCategory)}`}>
                {getTicketCategoryLabel(ticket.ticketCategory)}
              </span>
            )}
            <span className="text-[10px] text-slate-500 ml-auto flex-shrink-0">
              {createdAt}
            </span>
          </div>

          {/* 标题 */}
          <p className="mt-1.5 text-sm text-slate-200 font-medium leading-snug">
            {ticket.translatedTitle || ticket.translation?.translatedTitle || ticket.subject}
          </p>
        </div>
      </div>

      {/* 展开翻译内容 */}
      {ticket.translation && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? '收起翻译' : '查看翻译'}
          </button>
          {expanded && (
            <div className="mt-2 p-3 bg-slate-900/50 rounded-md border border-slate-700/30">
              <p className="text-xs text-slate-400 mb-1 font-medium">翻译标题</p>
              <p className="text-sm text-slate-300 mb-3">{ticket.translation.translatedTitle}</p>
              <p className="text-xs text-slate-400 mb-1 font-medium">翻译内容</p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {ticket.translation.translatedContent}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 原文预览（无翻译时） */}
      {!ticket.translation && ticket.content && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? '收起原文' : '查看原文'}
          </button>
          {expanded && (
            <div className="mt-2 p-3 bg-slate-900/50 rounded-md border border-slate-700/30">
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {ticket.content}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-3 flex items-center gap-2 justify-end" onBlur={handleBlur}>
        <button
          onClick={() => handleAction('continue')}
          disabled={acting !== null}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            confirmAction === 'continue'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400/50'
              : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {acting === 'continue' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {confirmAction === 'continue' ? '确认继续?' : '继续处理'}
        </button>

        <button
          onClick={() => handleAction('complete')}
          disabled={acting !== null}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            confirmAction === 'complete'
              ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/50'
              : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {acting === 'complete' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {confirmAction === 'complete' ? '确认完结?' : '直接完结'}
        </button>
      </div>
    </div>
  );
};

// ============ 主页面 ============

const ManualRequiredTab: React.FC = () => {
  const { t } = useTranslation('common');
  const [tickets, setTickets] = useState<ServerTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tickets = await request<ServerTicket[]>('/n8n/tickets/manual-required');
      setTickets(tickets || []);
    } catch (err: any) {
      setError(err.message || t('message.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleAction = useCallback(async (ticketId: number, action: 'continue' | 'complete') => {
    try {
      await request(`/n8n/tickets/${ticketId}/resolve-manual`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      // 操作成功后刷新列表
      await fetchTickets();
    } catch (err: any) {
      throw err; // 让卡片组件处理错误状态
    }
  }, [fetchTickets]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
          <h2 className="text-sm font-semibold text-slate-200">
            {t('nav.manualRequired')}
          </h2>
          {!loading && (
            <span className="text-xs text-slate-500 ml-1">
              ({tickets.length})
            </span>
          )}
        </div>
        <button
          onClick={fetchTickets}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('button.refresh')}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && tickets.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t('button.loading')}</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400/60" />
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={fetchTickets}
                className="mt-3 text-xs text-slate-400 hover:text-slate-200 underline"
              >
                {t('button.refresh')}
              </button>
            </div>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500">暂无需人工处理的工单</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 max-w-3xl mx-auto">
            {tickets.map(ticket => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManualRequiredTab;
