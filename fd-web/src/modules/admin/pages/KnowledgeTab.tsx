/**
 * 知识库管理 Tab
 * 包含两个子面板：工单标记（isValid）和注意事项管理
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketApi, adminApi, configApi, knowledgeApi, downloadWithAuth, getAuthToken, getApiBaseUrl } from '../../../shared/services/serverApi';
import type { ServerTicket, TicketStatus, KnowledgeNote, KnowledgeNoteRequest, KnowledgeBase, KnowledgeSyncConfig } from '../../../shared/types/server';
import ServerTicketDetail from '../../ticket/components/ServerTicketDetail';
import SourcePicker from '../../../shared/components/SourcePicker';
import TicketList from '../../../shared/components/TicketList';

// ============ 常量 ============

const TICKET_STATUSES: TicketStatus[] = [
    'PENDING_TRANS', 'TRANSLATING', 'PENDING_REPLY', 'REPLYING',
    'PROCESSING', 'PENDING_AUDIT', 'AUDITING', 'APPROVED', 'COMPLETED',
];

// ============ 主组件 ============

const KnowledgeTab: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [activePanel, setActivePanel] = useState<'tickets' | 'notes' | 'notebooklm'>('tickets');

    const panels: { key: typeof activePanel; label: string }[] = [
        { key: 'tickets', label: t('knowledge.ticketMarking') },
        { key: 'notes', label: t('knowledge.notes') },
        { key: 'notebooklm', label: 'NotebookLM' },
    ];

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
                        {panels.map(p => (
                            <button
                                key={p.key}
                                onClick={() => setActivePanel(p.key)}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activePanel === p.key
                                    ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-300'
                                    }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 面板内容 */}
            {activePanel === 'tickets' && <TicketValidityPanel />}
            {activePanel === 'notes' && <NotesPanel />}
            {activePanel === 'notebooklm' && <NotebookLmConfigPanel />}
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

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧：工单列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 头部工具栏 */}
                <div className="p-3 border-b border-white/10 bg-gradient-to-br from-amber-900/30 to-slate-900/20 space-y-2">
                    {/* 状态筛选 + 有效性筛选 */}
                    <div className="flex items-center gap-2">
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}
                            className="flex-1 min-w-0 px-2 py-1.5 bg-black/40 border border-white/10 rounded-lg text-[10px] text-white focus:border-amber-500/50 focus:outline-none"
                        >
                            <option value="">{t('common:label.allStatus')}</option>
                            {TICKET_STATUSES.map(status => (
                                <option key={status} value={status}>{t(`common:ticketStatus.${status}`)}</option>
                            ))}
                        </select>

                        <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/5 flex-shrink-0">
                            {(['all', 'valid', 'invalid'] as const).map(opt => (
                                <button
                                    key={opt}
                                    onClick={() => setValidFilter(opt)}
                                    className={`px-1.5 py-1 rounded-md text-[10px] font-medium transition-all ${validFilter === opt
                                        ? 'bg-amber-500/20 text-amber-400'
                                        : 'text-slate-500 hover:text-slate-400'
                                        }`}
                                >
                                    {opt === 'all' ? t('knowledge.tickets.all') : opt === 'valid' ? t('knowledge.tickets.validOnly') : t('knowledge.tickets.invalidOnly')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 搜索框 */}
                    <div className="relative">
                        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder={t('knowledge.tickets.searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-white placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
                        />
                    </div>
                </div>

                {/* 批量操作栏 */}
                {selectedIds.size > 0 && (
                    <div className="px-3 py-2 border-b border-white/10 bg-amber-500/5 flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[10px] text-slate-400 flex-shrink-0">{t('knowledge.tickets.selectedCount', { count: selectedIds.size })}</span>
                        <div className="flex-1" />
                        <button
                            onClick={() => handleBatchMark(true)}
                            disabled={batchLoading}
                            className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                        >
                            {t('knowledge.tickets.markValid')}
                        </button>
                        <button
                            onClick={() => handleBatchMark(false)}
                            disabled={batchLoading}
                            className="px-2 py-1 bg-red-500/20 text-red-400 rounded-lg text-[10px] font-medium hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                        >
                            {t('knowledge.tickets.markInvalid')}
                        </button>
                    </div>
                )}

                {/* 工单列表 */}
                <TicketList
                    tickets={tickets}
                    selectedId={selectedTicketId}
                    onSelect={(ticket) => setSelectedTicketId(ticket.id)}
                    themeColor="amber"
                    titleMode="original"
                    selectable
                    selectedIds={selectedIds}
                    onSelectionChange={setSelectedIds}
                    renderExtra={(ticket) => (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleToggleValid(ticket.id, ticket.isValid); }}
                                className={`relative w-9 h-5 rounded-full transition-colors ${ticket.isValid ? 'bg-emerald-500' : 'bg-slate-600'}`}
                            >
                                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${ticket.isValid ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </button>
                            <span className="text-[10px] text-slate-500">
                                {ticket.isValid ? t('knowledge.tickets.validLabel', { defaultValue: '有效' }) : t('knowledge.tickets.invalidLabel', { defaultValue: '无效' })}
                            </span>
                        </div>
                    )}
                    pagination={{ mode: 'pages', page, totalPages, totalElements, onPageChange: setPage }}
                    loading={loading}
                    density="compact"
                    emptyText={t('knowledge.tickets.noData')}
                />
            </div>

            {/* 右侧：详情预览 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {detailLoading ? (
                    <div className="flex items-center justify-center h-full text-slate-500 text-xs gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        加载中...
                    </div>
                ) : selectedTicket ? (
                    <div className="flex flex-col h-full">
                        {/* 右侧顶部操作栏：导出按钮 */}
                        <div className="px-4 py-2 border-b border-white/10 bg-slate-900/60 flex items-center justify-end flex-shrink-0">
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
                        <div className="flex-1 overflow-auto">
                            <ServerTicketDetail
                                ticket={selectedTicket}
                                onRefresh={loadTickets}
                                isEmbed
                                isSplitMode={isSplitMode}
                                setIsSplitMode={(s) => { setIsSplitMode(s); localStorage.setItem('knowledge_split_mode', String(s)); }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs gap-3">
                        <span>点击左侧工单查看详情</span>
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
                )}
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

// ============ 知识库同步配置面板 ============

const NotebookLmConfigPanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    // 配置数据
    const [config, setConfig] = useState<KnowledgeSyncConfig>({});
    const [bases, setBases] = useState<KnowledgeBase[]>([]);

    // 同步结果
    const [syncResult, setSyncResult] = useState<{ tickets?: string; notes?: string } | null>(null);

    // 加载知识库列表 + 已保存配置
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [baseList, savedConfig] = await Promise.all([
                knowledgeApi.listBases(),
                configApi.getKnowledgeSyncConfig(),
            ]);
            setBases(baseList);

            // 验证配置中的知识库是否仍然存在，不存在则清空失效的映射
            const cfg = savedConfig || {};
            if (cfg.knowledgeBaseId && !baseList.some(b => b.id === cfg.knowledgeBaseId)) {
                console.warn(`配置的知识库 ID=${cfg.knowledgeBaseId} 已不存在，自动清空`);
                cfg.knowledgeBaseId = undefined;
                cfg.ticketSourceId = undefined;
                cfg.notesSourceId = undefined;
            }
            setConfig(cfg);
        } catch (err) {
            console.error('加载配置失败:', err);
            setErrorMsg('加载配置失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // 选择知识库后重置源映射（SourcePicker 内部会自动加载源列表）
    const handleBaseChange = (baseId: number | undefined) => {
        setConfig(prev => ({
            ...prev,
            knowledgeBaseId: baseId,
            ticketSourceId: undefined,
            notesSourceId: undefined,
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setErrorMsg('');
        try {
            await configApi.setKnowledgeSyncConfig(config);
            setSuccessMsg(t('admin:knowledge.sync.saveSuccess', '配置已保存'));
            setTimeout(() => setSuccessMsg(''), 3000);
        } catch (err) {
            console.error('保存配置失败:', err);
            setErrorMsg('保存失败');
        } finally {
            setSaving(false);
        }
    };

    const handleSync = async () => {
        if (!config.knowledgeBaseId || !config.ticketSourceId || !config.notesSourceId) {
            setErrorMsg(t('admin:knowledge.sync.configIncomplete', '请先完成映射配置'));
            return;
        }

        setSyncing(true);
        setErrorMsg('');
        setSyncResult(null);

        try {
            const token = getAuthToken();
            const baseUrl = getApiBaseUrl();
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // 1. 获取工单 CSV 内容
            const ticketRes = await fetch(`${baseUrl}/admin/knowledge/export/tickets`, { headers });
            if (!ticketRes.ok) throw new Error(`导出工单失败: ${ticketRes.status}`);
            const ticketCsv = await ticketRes.text();

            // 2. 获取注意事项内容
            const notesRes = await fetch(`${baseUrl}/admin/knowledge/export/notes`, { headers });
            if (!notesRes.ok) throw new Error(`导出注意事项失败: ${notesRes.status}`);
            const notesCsv = await notesRes.text();

            // 3. 更新映射的源文件 content
            await knowledgeApi.updateSource(config.knowledgeBaseId, config.ticketSourceId, { content: ticketCsv });
            await knowledgeApi.updateSource(config.knowledgeBaseId, config.notesSourceId, { content: notesCsv });

            // 统计行数
            const ticketLines = ticketCsv.split('\n').filter(l => l.trim()).length - 1; // 减去表头
            const notesLines = notesCsv.split('\n').filter(l => l.trim()).length - 1;

            setSyncResult({
                tickets: `${t('admin:knowledge.sync.ticketLabel', '标记工单')} (${Math.max(0, ticketLines)} 条工单)`,
                notes: `${t('admin:knowledge.sync.notesLabel', '注意事项')} (${Math.max(0, notesLines)} 条注意事项)`,
            });

            setSuccessMsg(t('admin:knowledge.sync.syncSuccess', '同步成功'));
            setTimeout(() => setSuccessMsg(''), 5000);
        } catch (err) {
            console.error('同步失败:', err);
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('404') || msg.includes('NOT_FOUND')) {
                setErrorMsg('同步失败: 映射的源文件已被删除，请重新选择');
            } else {
                setErrorMsg(`同步失败: ${msg}`);
            }
        } finally {
            setSyncing(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500 text-xs gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                加载中...
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* 消息提示 */}
            {successMsg && (
                <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
                    {successMsg}
                </div>
            )}
            {errorMsg && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
                    {errorMsg}
                </div>
            )}

            {/* 说明 */}
            <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <h3 className="text-slate-200 font-medium mb-2">{t('admin:knowledge.sync.title', '知识库同步配置')}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                    {t('admin:knowledge.sync.desc', '将标记的有效工单和注意事项同步到本地知识库中。同步后，请前往知识库模块的 NotebookLM 页面将内容推送到云端。')}
                </p>
            </div>

            {/* 目标知识库选择 */}
            <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                    <h4 className="text-slate-200 text-sm font-medium">{t('admin:knowledge.sync.targetBase', '目标知识库')}</h4>
                </div>
                <select
                    value={config.knowledgeBaseId || ''}
                    onChange={e => handleBaseChange(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:border-amber-500/50 focus:outline-none"
                >
                    <option value="">{t('admin:knowledge.sync.selectBase', '-- 请选择知识库 --')}</option>
                    {bases.map(base => (
                        <option key={base.id} value={base.id}>{base.name}</option>
                    ))}
                </select>
            </div>

            {/* 映射配置 */}
            {config.knowledgeBaseId && (
                <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                        <h4 className="text-slate-200 text-sm font-medium">{t('admin:knowledge.sync.mapping', '映射配置')}</h4>
                    </div>

                    <div className="space-y-3">
                        {/* 标记工单 → 源文件 */}
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-300 w-24 shrink-0">{t('admin:knowledge.sync.ticketLabel', '标记工单')}</span>
                            <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <SourcePicker
                                knowledgeBaseId={config.knowledgeBaseId!}
                                value={config.ticketSourceId}
                                onChange={(id) => setConfig(prev => ({ ...prev, ticketSourceId: id }))}
                                filterType="CSV"
                                createDefaults={{ title: '已解决工单列表.csv', sourceType: 'CSV' }}
                                className="flex-1"
                            />
                        </div>

                        {/* 注意事项 → 源文件 */}
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-300 w-24 shrink-0">{t('admin:knowledge.sync.notesLabel', '注意事项')}</span>
                            <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <SourcePicker
                                knowledgeBaseId={config.knowledgeBaseId!}
                                value={config.notesSourceId}
                                onChange={(id) => setConfig(prev => ({ ...prev, notesSourceId: id }))}
                                filterType="CSV"
                                createDefaults={{ title: '注意事项.csv', sourceType: 'CSV' }}
                                className="flex-1"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving || !config.knowledgeBaseId}
                    className="px-4 py-2 bg-slate-500/20 text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-500/30 disabled:opacity-50 transition-colors"
                >
                    {saving ? t('admin:knowledge.sync.saving', '保存中...') : t('admin:knowledge.sync.save', '保存配置')}
                </button>
                <button
                    onClick={handleSync}
                    disabled={syncing || !config.knowledgeBaseId || !config.ticketSourceId || !config.notesSourceId}
                    className="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                    {syncing && (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                    )}
                    {syncing ? t('admin:knowledge.sync.syncing', '同步中...') : t('admin:knowledge.sync.syncBtn', '同步到知识库')}
                </button>
            </div>

            {/* 同步结果 */}
            {syncResult && (
                <div className="p-4 bg-slate-800/50 border border-emerald-500/20 rounded-lg space-y-2">
                    <h4 className="text-slate-200 text-sm font-medium">{t('admin:knowledge.sync.result', '同步结果')}</h4>
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-emerald-400">✓</span>
                            <span className="text-slate-300">{t('admin:knowledge.sync.ticketLabel', '标记工单')}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-slate-400">{syncResult.tickets}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-emerald-400">✓</span>
                            <span className="text-slate-300">{t('admin:knowledge.sync.notesLabel', '注意事项')}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-slate-400">{syncResult.notes}</span>
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                        {t('admin:knowledge.sync.nextStep', '请前往知识库模块的 NotebookLM 页面，点击同步将内容推送到云端。')}
                    </p>
                </div>
            )}
        </div>
    );
};

export default KnowledgeTab;
