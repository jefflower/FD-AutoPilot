import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Trash2, Pencil, ExternalLink, Save, X, FileText, Loader2, BookOpen } from 'lucide-react';
import type { KnowledgeSource } from '../../../shared/types/server';
import { notebookLmBridge } from '../../../shared/services/serverApi';
import { getApiBaseUrl, getAuthToken } from '../../../shared/services/api/client';
import SourceTypeIcon from './SourceTypeIcon';
import CsvViewer from './CsvViewer';

interface SourceDetailProps {
    source: KnowledgeSource;
    notebookId?: string;
    onSync: (source: KnowledgeSource) => void;
    onDelete: (source: KnowledgeSource) => void;
    onUpdate: (source: KnowledgeSource, data: { title?: string; content?: string; preserveSyncStatus?: boolean }) => void;
    syncing: boolean;
}

const SYNC_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
    NOT_SYNCED: { label: 'notSynced', color: 'text-slate-400', bg: 'bg-slate-500/10' },
    SYNCING: { label: 'syncing', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    SYNCED: { label: 'synced', color: 'text-green-400', bg: 'bg-green-500/10' },
    FAILED: { label: 'failed', color: 'text-red-400', bg: 'bg-red-500/10' },
};

const SourceDetail: React.FC<SourceDetailProps> = ({ source, notebookId, onSync, onDelete, onUpdate, syncing }) => {
    const { t } = useTranslation('knowledge');
    const [editing, setEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(source.title);
    const [editContent, setEditContent] = useState(source.content || '');

    // Fulltext loading state
    const [fulltextContent, setFulltextContent] = useState<string | null>(null);
    const [fulltextLoading, setFulltextLoading] = useState(false);
    const [fulltextError, setFulltextError] = useState<string | null>(null);

    // PDF blob URL for uploaded files
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfLoading, setPdfLoading] = useState(false);
    const prevSourceIdRef = useRef<number | null>(null);

    // Load PDF blob URL when source changes (for uploaded PDFs)
    useEffect(() => {
        if (source.id === prevSourceIdRef.current) return;
        prevSourceIdRef.current = source.id;

        // Cleanup previous blob URL
        if (pdfBlobUrl) {
            URL.revokeObjectURL(pdfBlobUrl);
            setPdfBlobUrl(null);
        }
        // Reset fulltext state on source change
        setFulltextContent(null);
        setFulltextError(null);

        if (source.sourceType === 'PDF' && source.filePath) {
            setPdfLoading(true);
            const baseUrl = getApiBaseUrl();
            const token = getAuthToken();
            const url = `${baseUrl}/knowledge-bases/${source.knowledgeBaseId}/sources/${source.id}/file`;
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            fetch(url, { headers })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.blob();
                })
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    setPdfBlobUrl(blobUrl);
                })
                .catch(err => {
                    console.error('Failed to load PDF file:', err);
                })
                .finally(() => setPdfLoading(false));
        }

        return () => {
            // Cleanup on unmount
        };
    }, [source.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup blob URL on unmount
    useEffect(() => {
        return () => {
            if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        };
    }, [pdfBlobUrl]);

    const handleStartEdit = () => {
        setEditTitle(source.title);
        setEditContent(source.content || fulltextContent || '');
        setEditing(true);
    };

    const handleSave = () => {
        onUpdate(source, { title: editTitle, content: editContent });
        setEditing(false);
    };

    const handleCancel = () => {
        setEditing(false);
    };

    // Fetch fulltext from NotebookLM via Bridge
    const handleFetchFulltext = useCallback(async () => {
        if (!notebookId || !source.notebookSourceId) return;
        setFulltextLoading(true);
        setFulltextError(null);
        try {
            const content = await notebookLmBridge.getFulltext(notebookId, source.notebookSourceId);
            setFulltextContent(content);
            // Also save content back to backend for future use (preserve sync status since content comes from NotebookLM)
            if (content) {
                onUpdate(source, { content, preserveSyncStatus: true });
            }
        } catch (err: any) {
            console.error('Failed to fetch fulltext:', err);
            setFulltextError(err.message || t('source.fulltextFailed'));
        } finally {
            setFulltextLoading(false);
        }
    }, [notebookId, source, onUpdate, t]);

    const statusInfo = SYNC_STATUS_MAP[source.syncStatus] || SYNC_STATUS_MAP.NOT_SYNCED;

    // Determine displayable content
    const displayContent = source.content || fulltextContent;
    const canFetchFulltext = notebookId && source.notebookSourceId && !displayContent && !fulltextLoading;
    const isEditable = source.sourceType === 'TEXT' || source.sourceType === 'MARKDOWN';
    const hasUploadedPdf = source.sourceType === 'PDF' && !!source.filePath;

    const formatSize = (bytes?: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString();
    };

    /** Render content based on source type */
    const renderContent = () => {
        if (!displayContent) return null;

        // CSV: use table viewer
        if (source.sourceType === 'CSV') {
            return (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-slate-500">{t('source.content')}</span>
                        {fulltextContent && !source.content && (
                            <span className="text-[10px] text-green-400 flex items-center gap-1">
                                <BookOpen size={10} />
                                {t('source.fulltextLoaded')}
                            </span>
                        )}
                    </div>
                    <CsvViewer content={displayContent} />
                </div>
            );
        }

        // PDF: show PDF viewer (if uploaded) + extracted text
        if (source.sourceType === 'PDF') {
            return (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-slate-500">
                            {hasUploadedPdf ? t('source.content') : t('source.extractedText')}
                        </span>
                        {fulltextContent && !source.content && (
                            <span className="text-[10px] text-green-400 flex items-center gap-1">
                                <BookOpen size={10} />
                                {t('source.fulltextLoaded')}
                            </span>
                        )}
                    </div>
                    {/* Uploaded PDF viewer */}
                    {pdfBlobUrl && (
                        <div className="mb-4 rounded-lg border border-white/10 overflow-hidden">
                            <iframe
                                src={pdfBlobUrl}
                                className="w-full bg-white"
                                style={{ height: '500px' }}
                                title={source.title}
                            />
                        </div>
                    )}
                    {pdfLoading && (
                        <div className="mb-4 rounded-lg border border-white/10 flex items-center justify-center py-12">
                            <Loader2 size={20} className="animate-spin text-amber-400" />
                            <span className="ml-2 text-xs text-slate-400">PDF 加载中...</span>
                        </div>
                    )}
                    {/* Extracted text below */}
                    <div className="rounded-lg border border-white/10 overflow-hidden">
                        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-white/10 flex items-center gap-2">
                            <FileText size={10} className="text-slate-500" />
                            <span className="text-[10px] text-slate-500 font-bold">
                                {hasUploadedPdf ? '索引文本' : '提取文本'}
                            </span>
                        </div>
                        <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                            {displayContent}
                        </pre>
                    </div>
                </div>
            );
        }

        // Default: TEXT / MARKDOWN / URL - plain text view
        return (
            <div>
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-500">{t('source.content')}</span>
                    {fulltextContent && !source.content && (
                        <span className="text-[10px] text-green-400 flex items-center gap-1">
                            <BookOpen size={10} />
                            {t('source.fulltextLoaded')}
                        </span>
                    )}
                </div>
                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap bg-white/5 rounded-lg p-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {displayContent}
                </pre>
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-900/40">
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <SourceTypeIcon type={source.sourceType} size={18} />
                    {editing ? (
                        <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="text-sm font-bold text-white bg-white/5 border border-white/10 rounded px-2 py-1 focus:outline-none focus:border-amber-500/30"
                        />
                    ) : (
                        <h3 className="text-sm font-bold text-white truncate">{source.title}</h3>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusInfo.color} ${statusInfo.bg}`}>
                        {t(`sync.${statusInfo.label}` as any)}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {editing ? (
                        <>
                            <button
                                onClick={handleSave}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 text-amber-300 text-[10px] font-bold transition-all"
                            >
                                <Save size={11} />
                                {t('button.save', { ns: 'common' })}
                            </button>
                            <button
                                onClick={handleCancel}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold transition-all"
                            >
                                <X size={11} />
                                {t('button.cancel', { ns: 'common' })}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => onSync(source)}
                                disabled={syncing}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 disabled:opacity-30 text-amber-300 text-[10px] font-bold transition-all"
                            >
                                <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                                {t('sync.syncOne')}
                            </button>
                            {isEditable && (
                                <button
                                    onClick={handleStartEdit}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold transition-all"
                                >
                                    <Pencil size={11} />
                                    {t('button.edit', { ns: 'common' })}
                                </button>
                            )}
                            <button
                                onClick={() => onDelete(source)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold transition-all"
                            >
                                <Trash2 size={11} />
                                {t('button.delete', { ns: 'common' })}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Meta info */}
            <div className="px-6 py-3 border-b border-white/10 grid grid-cols-3 gap-4">
                <div>
                    <span className="text-[10px] text-slate-500 block mb-0.5">{t('source.type')}</span>
                    <span className="text-xs text-white font-mono">{source.sourceType}</span>
                </div>
                {source.fileSize != null && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">{t('source.size')}</span>
                        <span className="text-xs text-white font-mono">{formatSize(source.fileSize)}</span>
                    </div>
                )}
                {source.originalFileName && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">{t('source.fileName')}</span>
                        <span className="text-xs text-white font-mono truncate block">{source.originalFileName}</span>
                    </div>
                )}
                <div>
                    <span className="text-[10px] text-slate-500 block mb-0.5">{t('source.createdAt')}</span>
                    <span className="text-xs text-white font-mono">{formatDate(source.createdAt)}</span>
                </div>
                {source.updatedAt && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">{t('source.updatedAt')}</span>
                        <span className="text-xs text-white font-mono">{formatDate(source.updatedAt)}</span>
                    </div>
                )}
                {source.syncedAt && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">{t('sync.status')}</span>
                        <span className="text-xs text-white font-mono">{formatDate(source.syncedAt)}</span>
                    </div>
                )}
                {source.notebookSourceId && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">NotebookLM ID</span>
                        <span className="text-xs text-white font-mono truncate block">{source.notebookSourceId}</span>
                    </div>
                )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {/* URL link */}
                {source.sourceType === 'URL' && source.url && (
                    <div className="mb-4">
                        <span className="text-[10px] text-slate-500 block mb-1">{t('source.url')}</span>
                        <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                        >
                            {source.url}
                            <ExternalLink size={10} />
                        </a>
                    </div>
                )}

                {/* Editing mode for TEXT/MARKDOWN */}
                {editing && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-1">{t('source.content')}</span>
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full h-80 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-amber-500/30 transition-colors"
                        />
                    </div>
                )}

                {/* Display content with type-specific viewers */}
                {!editing && displayContent && renderContent()}

                {/* Uploaded PDF without extracted text - show PDF viewer only */}
                {!editing && !displayContent && hasUploadedPdf && (
                    <div>
                        <span className="text-[10px] text-slate-500 block mb-2">{t('source.content')}</span>
                        {pdfBlobUrl && (
                            <div className="rounded-lg border border-white/10 overflow-hidden">
                                <iframe
                                    src={pdfBlobUrl}
                                    className="w-full bg-white"
                                    style={{ height: '600px' }}
                                    title={source.title}
                                />
                            </div>
                        )}
                        {pdfLoading && (
                            <div className="rounded-lg border border-white/10 flex items-center justify-center py-12">
                                <Loader2 size={20} className="animate-spin text-amber-400" />
                                <span className="ml-2 text-xs text-slate-400">PDF 加载中...</span>
                            </div>
                        )}
                        {/* Fetch fulltext button below PDF viewer */}
                        {canFetchFulltext && (
                            <div className="mt-3 flex justify-center">
                                <button
                                    onClick={handleFetchFulltext}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold transition-all"
                                >
                                    <FileText size={14} />
                                    {t('source.viewContent')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* No content yet - show fetch button or placeholder (for non-PDF or PDFs without file) */}
                {!editing && !displayContent && !hasUploadedPdf && (
                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                        <SourceTypeIcon type={source.sourceType} size={32} className="opacity-30" />
                        <p className="text-xs text-slate-500">{source.originalFileName || source.title}</p>
                        {source.fileSize != null && (
                            <p className="text-[10px] text-slate-600">{formatSize(source.fileSize)}</p>
                        )}

                        {/* Fetch fulltext button */}
                        {canFetchFulltext && (
                            <button
                                onClick={handleFetchFulltext}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold transition-all mt-2"
                            >
                                <FileText size={14} />
                                {t('source.viewContent')}
                            </button>
                        )}

                        {/* Loading state */}
                        {fulltextLoading && (
                            <div className="flex items-center gap-2 text-amber-400">
                                <Loader2 size={14} className="animate-spin" />
                                <span className="text-xs">{t('source.loadingFulltext')}</span>
                            </div>
                        )}

                        {/* Error state */}
                        {fulltextError && (
                            <div className="text-center">
                                <p className="text-xs text-red-400 mb-2">{fulltextError}</p>
                                <button
                                    onClick={handleFetchFulltext}
                                    className="text-[10px] text-amber-400 hover:text-amber-300 underline"
                                >
                                    {t('button.refresh', { ns: 'common' })}
                                </button>
                            </div>
                        )}

                        {/* No notebookSourceId - can't fetch */}
                        {!source.notebookSourceId && !notebookId && (
                            <p className="text-[10px] text-slate-600">{t('source.noContent')}</p>
                        )}
                    </div>
                )}

                {/* Loading/error states for fulltext with PDF viewer */}
                {!editing && hasUploadedPdf && (fulltextLoading || fulltextError) && (
                    <div className="mt-3 flex flex-col items-center gap-2">
                        {fulltextLoading && (
                            <div className="flex items-center gap-2 text-amber-400">
                                <Loader2 size={14} className="animate-spin" />
                                <span className="text-xs">{t('source.loadingFulltext')}</span>
                            </div>
                        )}
                        {fulltextError && (
                            <div className="text-center">
                                <p className="text-xs text-red-400 mb-2">{fulltextError}</p>
                                <button
                                    onClick={handleFetchFulltext}
                                    className="text-[10px] text-amber-400 hover:text-amber-300 underline"
                                >
                                    {t('button.refresh', { ns: 'common' })}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SourceDetail;
