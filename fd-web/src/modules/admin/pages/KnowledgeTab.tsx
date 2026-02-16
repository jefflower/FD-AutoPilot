/**
 * 知识库管理 Tab
 * 包含两个子面板：工单标记（isValid）和注意事项管理
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketApi, adminApi, downloadWithAuth } from '../../../shared/services/serverApi';
import type { ServerTicket, TicketStatus, KnowledgeNote, KnowledgeNoteRequest } from '../../../shared/types/server';
import ServerTicketDetail from '../../ticket/components/ServerTicketDetail';

// ============ 常量 ============

const STATUS_COLORS: Record<string, string> = {
    PENDING_TRANS: 'bg-yellow-500/20 text-yellow-400',
    TRANSLATING: 'bg-blue-500/20 text-blue-400',
    PENDING_REPLY: 'bg-orange-500/20 text-orange-400',
    REPLYING: 'bg-purple-500/20 text-purple-400',
    PENDING_AUDIT: 'bg-pink-500/20 text-pink-400',
    AUDITING: 'bg-indigo-500/20 text-indigo-400',
    APPROVED: 'bg-emerald-500/20 text-emerald-400',
    COMPLETED: 'bg-green-500/20 text-green-400',
};

const TICKET_STATUSES: TicketStatus[] = [
    'PENDING_TRANS', 'TRANSLATING', 'PENDING_REPLY', 'REPLYING',
    'PENDING_AUDIT', 'AUDITING', 'APPROVED', 'COMPLETED',
];

// ============ 主组件 ============

const KnowledgeTab: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [activePanel, setActivePanel] = useState<'tickets' | 'notes'>('tickets');

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* 顶部标题栏 */}
            <div className="px-5 py-3 border-b border-white/10 bg-gradient-to-r from-amber-900/30 to-slate-900/20 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                        <span className="w-1 h-4 bg-amber-500 rounded-full"></span>
                        {t('knowledge.title')}
                    </h3>
                    <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                        <button
                            onClick={() => setActivePanel('tickets')}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activePanel === 'tickets'
                                ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                                : 'text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            {t('knowledge.ticketMarking')}
                        </button>
                        <button
                            onClick={() => setActivePanel('notes')}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activePanel === 'notes'
                                ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                                : 'text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            {t('knowledge.notes')}
                        </button>
                    </div>
                </div>
            </div>

            {/* 面板内容 */}
            {activePanel === 'tickets' ? <TicketValidityPanel /> : <NotesPanel />}
        </div>
    );
};

// ============ 工单标记面板 ============

const TicketValidityPanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);

    const [tickets, setTickets] = useState<ServerTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('COMPLETED');
    const [validFilter, setValidFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [totalElements, setTotalElements] = useState(0);
    const [batchLoading, setBatchLoading] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [isSplitMode, setIsSplitMode] = useState(() => localStorage.getItem('knowledge_split_mode') === 'true');

    const PAGE_SIZE = 30;

    const loadTickets = useCallback(async () => {
        setLoading(true);
        try {
            const result = await ticketApi.getTickets({
                page,
                size: PAGE_SIZE,
                ...(statusFilter && { status: statusFilter }),
                ...(searchQuery.trim() && { subject: searchQuery.trim() }),
                ...(validFilter === 'valid' ? { isValid: true } : validFilter === 'invalid' ? { isValid: false } : {}),
            });
            setTickets(result.content);
            setTotalPages(result.totalPages);
            setTotalElements(result.totalElements);
        } catch (err) {
            console.error('加载工单失败:', err);
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, validFilter, searchQuery]);

    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    // 重置页码当筛选条件变化
    useEffect(() => {
        setPage(0);
        setSelectedIds(new Set());
    }, [statusFilter, validFilter, searchQuery]);

    // 加载选中工单的详情
    useEffect(() => {
        if (!selectedTicketId) {
            setSelectedTicket(null);
            return;
        }
        setDetailLoading(true);
        ticketApi.getTicketById(selectedTicketId)
            .then(ticket => setSelectedTicket(ticket))
            .catch(err => {
                console.error('加载工单详情失败:', err);
                setSelectedTicket(null);
            })
            .finally(() => setDetailLoading(false));
    }, [selectedTicketId]);

    const handleToggleValid = async (ticketId: number, currentValue: boolean) => {
        // 乐观更新
        setTickets(prev => prev.map(t =>
            t.id === ticketId ? { ...t, isValid: !currentValue } : t
        ));
        try {
            await ticketApi.updateValidity(ticketId, { isValid: !currentValue });
        } catch (err) {
            // 回滚
            setTickets(prev => prev.map(t =>
                t.id === ticketId ? { ...t, isValid: currentValue } : t
            ));
            console.error('更新失败:', err);
        }
    };

    const handleBatchMark = async (isValid: boolean) => {
        if (selectedIds.size === 0) return;
        setBatchLoading(true);
        try {
            await adminApi.batchUpdateValidity(Array.from(selectedIds), isValid);
            setSelectedIds(new Set());
            await loadTickets();
        } catch (err) {
            console.error('批量更新失败:', err);
        } finally {
            setBatchLoading(false);
        }
    };

    const handleExport = async () => {
        try {
            await downloadWithAuth('/admin/knowledge/export/tickets', 'knowledge_tickets.csv');
        } catch (err) {
            console.error('导出失败:', err);
            alert(t('knowledge.tickets.exportFailed', { error: String(err) }));
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === tickets.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(tickets.map(t => t.id)));
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 工具栏 */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-slate-900/30 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {/* 状态筛选 */}
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}
                        className="px-2.5 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:border-amber-500/50 focus:outline-none"
                    >
                        <option value="">{t('common:label.allStatus')}</option>
                        {TICKET_STATUSES.map(status => (
                            <option key={status} value={status}>{t(`common:ticketStatus.${status}`)}</option>
                        ))}
                    </select>

                    {/* 有效性筛选 */}
                    <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/5">
                        {(['all', 'valid', 'invalid'] as const).map(opt => (
                            <button
                                key={opt}
                                onClick={() => setValidFilter(opt)}
                                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${validFilter === opt
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'text-slate-500 hover:text-slate-400'
                                    }`}
                            >
                                {opt === 'all' ? t('knowledge.tickets.all') : opt === 'valid' ? t('knowledge.tickets.validOnly') : t('knowledge.tickets.invalidOnly')}
                            </button>
                        ))}
                    </div>

                    {/* 搜索框 */}
                    <div className="relative flex-1 min-w-[180px] max-w-[300px]">
                        <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder={t('knowledge.tickets.searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-7 pr-3 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-white placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
                        />
                    </div>

                    <div className="flex-1" />

                    {/* 批量操作 */}
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400">{t('knowledge.tickets.selectedCount', { count: selectedIds.size })}</span>
                            <button
                                onClick={() => handleBatchMark(true)}
                                disabled={batchLoading}
                                className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                            >
                                {t('knowledge.tickets.markValid')}
                            </button>
                            <button
                                onClick={() => handleBatchMark(false)}
                                disabled={batchLoading}
                                className="px-2.5 py-1 bg-red-500/20 text-red-400 rounded-lg text-[10px] font-medium hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                            >
                                {t('knowledge.tickets.markInvalid')}
                            </button>
                        </div>
                    )}

                    {/* 导出 */}
                    <button
                        onClick={handleExport}
                        className="px-2.5 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-[10px] font-medium hover:bg-amber-500/30 transition-colors flex items-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {t('knowledge.tickets.exportValid')}
                    </button>
                </div>
            </div>

            {/* 主内容区：左右分栏 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧：工单列表 */}
                <div className="w-[480px] flex-shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
                    {/* 表格 */}
                    <div className="flex-1 overflow-auto">
                        <table className="w-full">
                            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm z-10">
                                <tr className="border-b border-white/10">
                                    <th className="px-3 py-2.5 w-10">
                                        <input
                                            type="checkbox"
                                            checked={tickets.length > 0 && selectedIds.size === tickets.length}
                                            onChange={toggleSelectAll}
                                            className="w-3.5 h-3.5 rounded border-white/20 bg-transparent accent-amber-500 cursor-pointer"
                                        />
                                    </th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-slate-400 uppercase tracking-wider w-24">{t('knowledge.tickets.ticketId')}</th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-slate-400 uppercase tracking-wider">{t('knowledge.tickets.subject')}</th>
                                    <th className="px-3 py-2.5 text-center text-[10px] font-medium text-slate-400 uppercase tracking-wider w-20">{t('common:label.status')}</th>
                                    <th className="px-3 py-2.5 text-center text-[10px] font-medium text-slate-400 uppercase tracking-wider w-16">{t('knowledge.tickets.valid')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-20 text-center text-slate-500 text-xs">
                                            <div className="flex items-center justify-center gap-2">
                                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                                </svg>
                                                {t('common:button.loading')}
                                            </div>
                                        </td>
                                    </tr>
                                ) : tickets.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-20 text-center text-slate-500 text-xs">
                                            {t('knowledge.tickets.noData')}
                                        </td>
                                    </tr>
                                ) : (
                                    tickets.map(ticket => (
                                        <tr
                                            key={ticket.id}
                                            onClick={() => setSelectedTicketId(ticket.id)}
                                            className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer ${
                                                selectedTicketId === ticket.id ? 'bg-amber-500/10 border-l-2 border-l-amber-500' : ''
                                            }`}
                                        >
                                            <td className="px-3 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(ticket.id)}
                                                    onChange={() => toggleSelect(ticket.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="w-3.5 h-3.5 rounded border-white/20 bg-transparent accent-amber-500 cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="text-[10px] font-mono text-indigo-400/80">#{ticket.externalId}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="text-xs text-slate-300 line-clamp-1">{ticket.subject}</span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_COLORS[ticket.status] || 'bg-slate-500/20 text-slate-400'}`}>
                                                    {t(`common:ticketStatus.${ticket.status}` as any)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleToggleValid(ticket.id, ticket.isValid); }}
                                                    className={`relative w-9 h-5 rounded-full transition-colors ${ticket.isValid ? 'bg-emerald-500' : 'bg-slate-600'
                                                        }`}
                                                >
                                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${ticket.isValid ? 'translate-x-[18px]' : 'translate-x-0.5'
                                                        }`} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* 分页 */}
                    <div className="px-4 py-2 border-t border-white/5 bg-slate-900/30 flex items-center justify-between flex-shrink-0">
                        <span className="text-[10px] text-slate-500">
                            {t('knowledge.tickets.pagination', { total: totalElements, current: page + 1, pages: totalPages })}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="px-2.5 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('common:button.previousPage')}
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="px-2.5 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('common:button.nextPage')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* 右侧：详情预览 */}
                <div className="flex-1 overflow-auto">
                    {detailLoading ? (
                        <div className="flex items-center justify-center h-full text-slate-500 text-xs gap-2">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            加载中...
                        </div>
                    ) : selectedTicket ? (
                        <ServerTicketDetail
                            ticket={selectedTicket}
                            onRefresh={loadTickets}
                            isEmbed
                            isSplitMode={isSplitMode}
                            setIsSplitMode={(s) => { setIsSplitMode(s); localStorage.setItem('knowledge_split_mode', String(s)); }}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-500 text-xs">
                            点击左侧工单查看详情
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============ 注意事项面板 ============

const NotesPanel: React.FC = () => {
    const { t, i18n } = useTranslation(['admin', 'common']);

    const [notes, setNotes] = useState<KnowledgeNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null); // null=查看, 0=新建
    const [editForm, setEditForm] = useState<KnowledgeNoteRequest>({ title: '', content: '', sortOrder: 0 });
    const [saving, setSaving] = useState(false);

    const loadNotes = useCallback(async () => {
        try {
            const data = await adminApi.getKnowledgeNotes();
            setNotes(data);
        } catch (err) {
            console.error('加载注意事项失败:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadNotes();
    }, [loadNotes]);

    const handleAdd = () => {
        setEditingId(0);
        setEditForm({ title: '', content: '', sortOrder: notes.length });
    };

    const handleEdit = (note: KnowledgeNote) => {
        setEditingId(note.id);
        setEditForm({ title: note.title, content: note.content, sortOrder: note.sortOrder });
    };

    const handleCancel = () => {
        setEditingId(null);
        setEditForm({ title: '', content: '', sortOrder: 0 });
    };

    const handleSave = async () => {
        if (!editForm.title.trim() || !editForm.content.trim()) return;
        setSaving(true);
        try {
            if (editingId === 0) {
                await adminApi.createKnowledgeNote(editForm);
            } else if (editingId) {
                await adminApi.updateKnowledgeNote(editingId, editForm);
            }
            setEditingId(null);
            setEditForm({ title: '', content: '', sortOrder: 0 });
            await loadNotes();
        } catch (err) {
            console.error('保存失败:', err);
            alert(t('knowledge.notesPanel.saveFailed', { error: String(err) }));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm(t('knowledge.notesPanel.confirmDelete'))) return;
        try {
            await adminApi.deleteKnowledgeNote(id);
            await loadNotes();
        } catch (err) {
            console.error('删除失败:', err);
        }
    };

    const handleExport = async () => {
        try {
            await downloadWithAuth('/admin/knowledge/export/notes', 'knowledge_notes.csv');
        } catch (err) {
            console.error('导出失败:', err);
            alert(t('knowledge.notesPanel.exportFailed', { error: String(err) }));
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 工具栏 */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-slate-900/30 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] text-slate-500">{t('knowledge.notesPanel.totalNotes', { count: notes.length })}</span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleAdd}
                        disabled={editingId === 0}
                        className="px-2.5 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-[10px] font-medium hover:bg-amber-500/30 disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {t('knowledge.notesPanel.add')}
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={notes.length === 0}
                        className="px-2.5 py-1.5 bg-white/5 text-slate-400 rounded-lg text-[10px] font-medium hover:bg-white/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {t('knowledge.notesPanel.export')}
                    </button>
                </div>
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
                {/* 新建表单 */}
                {editingId === 0 && (
                    <NoteEditCard
                        form={editForm}
                        setForm={setEditForm}
                        onSave={handleSave}
                        onCancel={handleCancel}
                        saving={saving}
                    />
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-slate-500 text-xs gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        {t('common:button.loading')}
                    </div>
                ) : notes.length === 0 && editingId !== 0 ? (
                    <div className="text-center py-20 text-slate-500 text-xs">
                        {t('knowledge.notesPanel.noData')}
                    </div>
                ) : (
                    notes.map(note => (
                        editingId === note.id ? (
                            <NoteEditCard
                                key={note.id}
                                form={editForm}
                                setForm={setEditForm}
                                onSave={handleSave}
                                onCancel={handleCancel}
                                saving={saving}
                            />
                        ) : (
                            <div
                                key={note.id}
                                className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10 p-4 group hover:border-white/20 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-[10px] text-amber-500/60 font-mono">#{note.sortOrder}</span>
                                            <h4 className="text-sm font-medium text-white truncate">{note.title}</h4>
                                        </div>
                                        <p className="text-xs text-slate-400 whitespace-pre-wrap break-words leading-relaxed">{note.content}</p>
                                        <p className="text-[10px] text-slate-600 mt-2">
                                            {t('knowledge.notesPanel.createdAt', { time: new Date(note.createdAt).toLocaleString(i18n.language) })}
                                            {note.updatedAt && ` \u00B7 ${t('knowledge.notesPanel.updatedAt', { time: new Date(note.updatedAt).toLocaleString(i18n.language) })}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                        <button
                                            onClick={() => handleEdit(note)}
                                            className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                                            title={t('common:button.edit')}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDelete(note.id)}
                                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title={t('common:button.delete')}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    ))
                )}
            </div>
        </div>
    );
};

// ============ 注意事项编辑卡片 ============

interface NoteEditCardProps {
    form: KnowledgeNoteRequest;
    setForm: React.Dispatch<React.SetStateAction<KnowledgeNoteRequest>>;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}

const NoteEditCard: React.FC<NoteEditCardProps> = ({ form, setForm, onSave, onCancel, saving }) => {
    const { t } = useTranslation(['admin', 'common']);

    return (
        <div className="bg-slate-800/70 backdrop-blur-xl rounded-xl border border-amber-500/30 p-4 space-y-3">
            <div className="flex items-center gap-3">
                <input
                    type="number"
                    value={form.sortOrder ?? 0}
                    onChange={e => setForm(prev => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))}
                    className="w-16 px-2 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-white text-center focus:border-amber-500/50 focus:outline-none"
                    placeholder={t('knowledge.notesPanel.sortOrder')}
                    title={t('knowledge.notesPanel.sortOrder')}
                />
                <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                    className="flex-1 px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:border-amber-500/50 focus:outline-none"
                    placeholder={t('knowledge.notesPanel.titlePlaceholder')}
                    autoFocus
                />
            </div>
            <textarea
                value={form.content}
                onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:border-amber-500/50 focus:outline-none resize-none leading-relaxed"
                placeholder={t('knowledge.notesPanel.contentPlaceholder')}
                rows={4}
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-3 py-1.5 text-slate-400 hover:text-slate-300 text-[10px] font-medium transition-colors"
                >
                    {t('common:button.cancel')}
                </button>
                <button
                    onClick={onSave}
                    disabled={saving || !form.title.trim() || !form.content.trim()}
                    className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-[10px] font-medium hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
                >
                    {saving ? t('knowledge.notesPanel.saving') : t('common:button.save')}
                </button>
            </div>
        </div>
    );
};

export default KnowledgeTab;
