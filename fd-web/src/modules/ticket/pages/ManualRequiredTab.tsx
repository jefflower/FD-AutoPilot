/**
 * 人工处理工单页面
 *
 * 左右分栏布局：左侧 TicketList 列表 + 右侧 ServerTicketDetail 详情
 * 提供"继续处理"、"直接完结"和"手动回复"操作
 *
 * v0.4 重构：操作栏移至底部，手动回复面板使用共享 ReplyEditor 组件，
 * 支持双向翻译（中文⇄原文），布局为 LEFT=原文 RIGHT=中文
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { request, serverApi } from '../../../shared/services/serverApi';
import ServerTicketDetail from '../components/ServerTicketDetail';
import DetailEmptyState from '../components/DetailEmptyState';
import EmptyStateHint from '../components/EmptyStateHint';
import TicketList from '../../../shared/components/TicketList';
import ReplyEditor from '../components/ticket-detail/ReplyEditor';
import type { TranslateDirection } from '../components/ticket-detail/ReplyEditor';
import type { ServerTicket } from '../../../shared/types/server';
import {
  AlertTriangle, Play, CheckCircle2, Loader2, MessageSquare, Sparkles,
} from 'lucide-react';

const ManualRequiredTab: React.FC = () => {
  const { t } = useTranslation('common');
  const [tickets, setTickets] = useState<ServerTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

  // 操作状态
  const [acting, setActing] = useState<'continue' | 'complete' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'continue' | 'complete' | null>(null);

  // 手动回复状态
  const [showManualReply, setShowManualReply] = useState(false);
  const [manualZhReply, setManualZhReply] = useState('');
  const [manualTargetReply, setManualTargetReply] = useState('');
  const [translating, setTranslating] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);
  const [aiReplying, setAiReplying] = useState(false);

  // Split 模式持久化
  const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
    const saved = localStorage.getItem('manual_split_mode');
    return saved !== null ? saved === 'true' : true;
  });
  const setIsSplitMode = (s: boolean) => {
    setIsSplitModeState(s);
    localStorage.setItem('manual_split_mode', s.toString());
  };

  // 自动刷新定时器
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await request<ServerTicket[]>('/n8n/tickets/manual-required');
      setTickets(data || []);
    } catch (err) {
      console.error('[ManualRequiredTab] Failed to load data:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    pollRef.current = setInterval(() => fetchTickets(true), 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTickets]);

  // 选中工单详情加载
  useEffect(() => {
    if (selectedId) {
      serverApi.ticket.getTicketById(selectedId)
        .then(setSelectedTicket)
        .catch(err => console.error('Failed to load detail:', err));
    } else {
      setSelectedTicket(null);
    }
  }, [selectedId]);

  const handleRefresh = useCallback(() => {
    if (selectedId) {
      serverApi.ticket.getTicketById(selectedId)
        .then(setSelectedTicket)
        .catch(console.error);
    }
    fetchTickets(true);
  }, [selectedId, fetchTickets]);

  // 操作：继续处理 / 直接完结（双击确认）
  const handleAction = useCallback(async (ticketId: number, action: 'continue' | 'complete') => {
    if (confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    setActing(action);
    setConfirmAction(null);
    try {
      await request(`/n8n/tickets/${ticketId}/resolve-manual`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      // 操作成功后：如果操作的是当前选中工单，清除选中
      if (selectedId === ticketId) {
        setSelectedId(null);
        setSelectedTicket(null);
      }
      await fetchTickets();
    } catch (err) {
      console.error('[ManualRequiredTab] Action failed:', err);
    } finally {
      setActing(null);
    }
  }, [confirmAction, selectedId, fetchTickets]);

  // 双向翻译：直接调用 /agents/{agentCode}/execute
  const handleTranslate = useCallback(async (direction: TranslateDirection) => {
    if (!selectedTicket) return;
    setTranslating(true);
    try {
      const sourceLang = selectedTicket.sourceLang || 'en';
      const ticketDescription = selectedTicket.content || selectedTicket.subject || '';

      if (direction === 'zh_to_target') {
        if (!manualZhReply.trim()) return;
        const result = await request<any>('/n8n/agents/manual-reply-translate/execute', {
          method: 'POST',
          body: JSON.stringify({
            input: {
              zhReply: manualZhReply,
              ticketContent: ticketDescription,
              targetLang: sourceLang,
            },
            refType: 'ticket',
            refId: String(selectedTicket.id),
            timeoutMs: 120000,
          }),
        });
        if (result?.data?.output) {
          let output = result.data.output;
          const fm = output.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/);
          if (fm) output = fm[1];
          setManualTargetReply(output.trim());
        }
      } else {
        // target_to_zh: 反向翻译 Agent
        if (!manualTargetReply.trim()) return;
        const result = await request<any>('/n8n/agents/manual-reply-translate-reverse/execute', {
          method: 'POST',
          body: JSON.stringify({
            input: {
              targetReply: manualTargetReply,
              ticketContent: ticketDescription,
              sourceLang,
            },
            refType: 'ticket',
            refId: String(selectedTicket.id),
            timeoutMs: 120000,
          }),
        });
        if (result?.data?.output) {
          let output = result.data.output;
          const fm = output.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/);
          if (fm) output = fm[1];
          setManualZhReply(output.trim());
        }
      }
    } catch (err) {
      console.error('[ManualRequiredTab] Translation failed:', err);
    } finally {
      setTranslating(false);
    }
  }, [selectedTicket, manualZhReply, manualTargetReply]);

  // 提交人工回复（支持选择目标状态）
  const handleSubmitManualReply = useCallback(async (targetStatus: 'PENDING_AUDIT' | 'COMPLETED') => {
    if (!selectedTicket || !manualTargetReply.trim() || !manualZhReply.trim()) return;
    setSubmittingReply(true);
    try {
      await request(`/n8n/tickets/${selectedTicket.id}/save-manual-reply`, {
        method: 'POST',
        body: JSON.stringify({
          targetReply: manualTargetReply,
          zhReply: manualZhReply,
          targetStatus,
        }),
      });
      // 清理状态
      setShowManualReply(false);
      setManualZhReply('');
      setManualTargetReply('');
      if (selectedId === selectedTicket.id) {
        setSelectedId(null);
        setSelectedTicket(null);
      }
      await fetchTickets();
    } catch (err) {
      console.error('[ManualRequiredTab] Save manual reply failed:', err);
    } finally {
      setSubmittingReply(false);
    }
  }, [selectedTicket, manualTargetReply, manualZhReply, selectedId, fetchTickets]);

  // AI 回复（异步）：提交到后端 → n8n webhook 异步处理 → 工单进入审核
  const [confirmAiReply, setConfirmAiReply] = useState(false);
  const handleAiReply = useCallback(async () => {
    if (!selectedTicket) return;
    // 双击确认
    if (!confirmAiReply) {
      setConfirmAiReply(true);
      return;
    }
    setAiReplying(true);
    setConfirmAiReply(false);
    try {
      await request(`/n8n/tickets/${selectedTicket.id}/submit-for-ai-reply`, {
        method: 'POST',
      });
      // 工单已转为 REPLYING，从列表移除
      if (selectedId === selectedTicket.id) {
        setSelectedId(null);
        setSelectedTicket(null);
      }
      setShowManualReply(false);
      await fetchTickets();
    } catch (err) {
      console.error('[ManualRequiredTab] Submit AI reply failed:', err);
    } finally {
      setAiReplying(false);
    }
  }, [selectedTicket, confirmAiReply, selectedId, fetchTickets]);

  // 点击外部时取消确认状态
  const handleBlur = useCallback(() => {
    setTimeout(() => setConfirmAction(null), 200);
  }, []);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* 左侧面板 */}
      <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
        {/* 头部 */}
        <div className="p-4 border-b border-white/10 bg-gradient-to-br from-red-900/40 to-slate-900/20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
              <span className="w-1 h-3 bg-red-500 rounded-full"></span>
              人工处理
            </h3>
            <div className="flex items-center gap-2">
              {/* 工单数量 badge */}
              <div className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/30">
                {tickets.length}
              </div>
            </div>
          </div>

          {/* 刷新按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => fetchTickets()}
              disabled={loading}
              className="flex-1 h-8 bg-red-600/30 hover:bg-red-600/50 text-red-300 text-[10px] font-bold rounded-lg transition-all border border-red-500/20 flex items-center justify-center gap-1.5"
            >
              <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t('button.refresh')}
            </button>
          </div>
        </div>

        {/* 工单列表 */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
          <div>
            <div className="flex items-center justify-between px-2 mb-2">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                {tickets.length > 0 && <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-ping"></span>}
                需人工处理
              </h4>
              <span className="text-[10px] font-mono text-red-500/50">({tickets.length})</span>
            </div>

            {tickets.length === 0 && !loading ? (
              <EmptyStateHint message="暂无需人工处理的工单" />
            ) : (
              <TicketList
                tickets={tickets}
                selectedId={selectedId}
                onSelect={(ticket) => {
                  setSelectedId(selectedId === ticket.id ? null : ticket.id);
                  setConfirmAction(null);
                }}
                themeColor="red"
                titleMode="auto"
                loading={loading}
                renderStatus={(_ticket) => (
                  <span className="text-[8px] font-black uppercase tracking-tighter text-red-400/50 flex-shrink-0">
                    需人工处理
                  </span>
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 bg-slate-900/40 relative flex flex-col">
        {selectedTicket ? (
          <>
            {/* 工单详情（占据主要空间） */}
            <div className="flex-1 overflow-hidden">
              <ServerTicketDetail
                ticket={selectedTicket}
                isEmbed={true}
                isSplitMode={isSplitMode}
                setIsSplitMode={setIsSplitMode}
                onRefresh={handleRefresh}
              />
            </div>

            {/* 手动回复面板（展开时在详情与操作栏之间） */}
            {showManualReply && selectedTicket && (
              <div className="border-t border-white/10 bg-slate-800/60 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-3 bg-purple-500 rounded-full"></div>
                  <span className="text-xs font-bold text-purple-400">手动回复</span>
                  <span className="text-[10px] text-slate-500">
                    目标语言: {selectedTicket.sourceLang || 'en'}
                  </span>
                </div>
                <ReplyEditor
                  targetValue={manualTargetReply}
                  zhValue={manualZhReply}
                  targetLang={selectedTicket.sourceLang || 'en'}
                  onTargetChange={setManualTargetReply}
                  onZhChange={setManualZhReply}
                  onTranslate={handleTranslate}
                  translating={translating}
                  enabledDirections={['zh_to_target', 'target_to_zh']}
                  primaryAction={{
                    label: '提交并审核',
                    loadingLabel: '提交中...',
                    loading: submittingReply,
                    disabled: !manualTargetReply.trim() || !manualZhReply.trim(),
                    onClick: () => handleSubmitManualReply('PENDING_AUDIT'),
                  }}
                  secondaryAction={{
                    label: '提交并完成',
                    loadingLabel: '提交中...',
                    loading: submittingReply,
                    disabled: !manualTargetReply.trim() || !manualZhReply.trim(),
                    onClick: () => handleSubmitManualReply('COMPLETED'),
                  }}
                  cancelAction={{
                    label: '取消',
                    onClick: () => { setShowManualReply(false); setManualZhReply(''); setManualTargetReply(''); },
                  }}
                  themeColor="purple"
                  minTextareaHeight="120px"
                />
              </div>
            )}

            {/* 底部操作工具栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-slate-800/40" onBlur={handleBlur}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-slate-400">
                  #{selectedTicket.externalId || selectedTicket.id}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAction(selectedTicket.id, 'continue')}
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
                  onClick={() => handleAction(selectedTicket.id, 'complete')}
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

                <button
                  onClick={handleAiReply}
                  onBlur={() => setTimeout(() => setConfirmAiReply(false), 200)}
                  disabled={aiReplying || submittingReply}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    confirmAiReply
                      ? 'bg-amber-600 text-white ring-2 ring-amber-400/50'
                      : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {aiReplying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {aiReplying ? '提交中...' : confirmAiReply ? '确认提交?' : '提交AI回复'}
                </button>

                <button
                  onClick={() => setShowManualReply(!showManualReply)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    showManualReply
                      ? 'bg-purple-600 text-white ring-2 ring-purple-400/50'
                      : 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  手动回复
                </button>
              </div>
            </div>
          </>
        ) : (
          <DetailEmptyState
            title="选择一个工单进行处理"
            subtitle="从左侧列表选择需人工处理的工单，查看详情并执行操作"
          />
        )}
      </div>
    </div>
  );
};

export default ManualRequiredTab;
