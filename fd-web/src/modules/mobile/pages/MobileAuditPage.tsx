import { useState, useEffect, useCallback, useMemo } from 'react';
import { auditTokenApi } from '../../../shared/services/serverApi';
import type { MobileAuditDetail, MobileAuditResult } from '../../../shared/types/server';
import { AGENT_MAP } from '../../../shared/constants/agentMap';

type PageState = 'loading' | 'ready' | 'audited' | 'error' | 'submitted';

interface MobileAuditPageProps {
    /** 直接传入 token（嵌入模式），不传则从 URL 参数读取 */
    token?: string;
    /** 嵌入模式下的返回按钮回调 */
    onBack?: () => void;
}

export default function MobileAuditPage({ token: tokenProp, onBack }: MobileAuditPageProps = {}) {
    const [state, setState] = useState<PageState>('loading');
    const [detail, setDetail] = useState<MobileAuditDetail | null>(null);
    const [error, setError] = useState('');
    const [submitResult, setSubmitResult] = useState<MobileAuditResult | null>(null);

    // Audit form state
    const [showRejectForm, setShowRejectForm] = useState(false);
    const [auditRemark, setAuditRemark] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Parse token from prop or URL
    const token = tokenProp || new URLSearchParams(window.location.search).get('token') || '';
    const isEmbedded = !!tokenProp;

    const loadDetail = useCallback(async () => {
        if (!token) {
            setError('缺少审核Token参数');
            setState('error');
            return;
        }
        try {
            const data = await auditTokenApi.getDetail(token);
            setDetail(data);
            setState(data.alreadyAudited ? 'audited' : 'ready');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : '加载失败');
            setState('error');
        }
    }, [token]);

    useEffect(() => {
        loadDetail();
    }, [loadDetail]);

    const handleSubmit = async (result: 'PASS' | 'REJECT') => {
        if (submitting) return;
        setSubmitting(true);
        try {
            const res = await auditTokenApi.submitAudit(token, {
                auditResult: result,
                auditRemark: result === 'REJECT' ? auditRemark : undefined,
            });
            setSubmitResult(res);
            setState('submitted');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : '提交失败');
            setState('error');
        } finally {
            setSubmitting(false);
        }
    };

    // ===== Loading =====
    if (state === 'loading') {
        return (
            <div className={`${isEmbedded ? 'h-full' : 'min-h-screen'} bg-slate-900 flex items-center justify-center`}>
                <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-600 border-t-blue-400 mx-auto mb-4" />
                    <p className="text-slate-400 text-sm">加载审核详情...</p>
                </div>
            </div>
        );
    }

    // ===== Error =====
    if (state === 'error') {
        return (
            <div className={`${isEmbedded ? 'h-full' : 'min-h-screen'} bg-slate-900 flex items-center justify-center p-6`}>
                <div className="text-center max-w-sm">
                    <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                    <h2 className="text-white text-lg font-medium mb-2">无法加载</h2>
                    <p className="text-slate-400 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    // ===== Submitted =====
    if (state === 'submitted' && submitResult) {
        const isPassed = submitResult.auditResult === 'PASS';
        return (
            <div className={`${isEmbedded ? 'h-full' : 'min-h-screen'} bg-slate-900 flex items-center justify-center p-6`}>
                <div className="text-center max-w-sm">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                        submitResult.success
                            ? (isPassed ? 'bg-green-500/10' : 'bg-orange-500/10')
                            : 'bg-red-500/10'
                    }`}>
                        {submitResult.success ? (
                            <svg className={`w-8 h-8 ${isPassed ? 'text-green-400' : 'text-orange-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        )}
                    </div>
                    <h2 className="text-white text-lg font-medium mb-2">
                        {submitResult.success ? (isPassed ? '审核通过' : '审核驳回') : '提交失败'}
                    </h2>
                    <p className="text-slate-400 text-sm">{submitResult.message}</p>
                </div>
            </div>
        );
    }

    if (!detail) return null;

    // ===== Ready / Audited =====
    return (
        <div className={`${isEmbedded ? 'h-full flex flex-col' : 'min-h-screen'} bg-slate-900 text-white`}>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur border-b border-slate-700 px-4 py-3">
                <div className="flex items-center gap-2">
                    {isEmbedded && onBack && (
                        <button
                            onClick={onBack}
                            className="p-1 -ml-1 text-slate-400 hover:text-white transition-colors"
                            title="返回详情"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                        #{detail.externalId}
                    </span>
                    {state === 'audited' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300">
                            已审核
                        </span>
                    )}
                </div>
                <h1 className="text-sm font-medium mt-1 line-clamp-2">{detail.subject}</h1>
            </div>

            {/* Content */}
            <div className={`p-4 space-y-4 ${isEmbedded ? 'flex-1 overflow-y-auto pb-4' : 'pb-32'}`}>
                {/* Translated Title */}
                {detail.translatedTitle && (
                    <Card title="翻译标题">
                        <p className="text-sm text-slate-300">{detail.translatedTitle}</p>
                    </Card>
                )}

                {/* Original Content */}
                <Card title="客户原文" defaultCollapsed>
                    <ConversationView jsonContent={detail.content} />
                </Card>

                {/* Translated Content */}
                {detail.translatedContent && (
                    <Card title="翻译内容">
                        <ConversationView jsonContent={detail.translatedContent} />
                    </Card>
                )}

                {/* Reply */}
                {detail.zhReply && (
                    <Card title="推荐回复（中文）">
                        <div className="text-sm text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {detail.zhReply}
                        </div>
                    </Card>
                )}
                {detail.targetReply && (
                    <Card title="推荐回复（目标语言）">
                        <div className="text-sm text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {detail.targetReply}
                        </div>
                    </Card>
                )}

                {/* Last Audit Remark */}
                {detail.lastAuditRemark && (
                    <Card title="上次驳回意见">
                        <p className="text-sm text-orange-300">{detail.lastAuditRemark}</p>
                    </Card>
                )}

                {/* Audit History */}
                {detail.auditHistory.length > 0 && (
                    <Card title="审核历史" defaultCollapsed>
                        <div className="space-y-2">
                            {detail.auditHistory.map((h, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                    <span className={`px-1.5 py-0.5 rounded ${
                                        h.auditResult === 'PASS'
                                            ? 'bg-green-500/20 text-green-300'
                                            : 'bg-red-500/20 text-red-300'
                                    }`}>
                                        {h.auditResult === 'PASS' ? '通过' : '驳回'}
                                    </span>
                                    <span className="text-slate-400 flex-1">{h.auditRemark || '-'}</span>
                                    <span className="text-slate-500 shrink-0">
                                        {new Date(h.createdAt).toLocaleString('zh-CN', {
                                            month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit',
                                        })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* Reject Form (inline) */}
                {showRejectForm && state === 'ready' && (
                    <Card title="驳回意见">
                        <textarea
                            className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                            rows={3}
                            placeholder="请输入驳回原因..."
                            value={auditRemark}
                            onChange={(e) => setAuditRemark(e.target.value)}
                            autoFocus
                        />
                    </Card>
                )}
            </div>

            {/* Bottom Action Bar */}
            {state === 'ready' && (
                <div className={`${isEmbedded ? 'sticky bottom-0' : 'fixed bottom-0 left-0 right-0'} bg-slate-800/95 backdrop-blur border-t border-slate-700 p-4 safe-area-bottom`}>
                    {!showRejectForm ? (
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowRejectForm(true)}
                                className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-medium text-sm active:bg-red-500/20 transition-colors"
                            >
                                驳回
                            </button>
                            <button
                                onClick={() => handleSubmit('PASS')}
                                disabled={submitting}
                                className="flex-1 py-3 rounded-xl bg-green-500 text-white font-medium text-sm active:bg-green-600 transition-colors disabled:opacity-50"
                            >
                                {submitting ? '提交中...' : '通过'}
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowRejectForm(false); setAuditRemark(''); }}
                                className="flex-1 py-3 rounded-xl bg-slate-700 text-slate-300 font-medium text-sm"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleSubmit('REJECT')}
                                disabled={submitting}
                                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-medium text-sm active:bg-red-600 transition-colors disabled:opacity-50"
                            >
                                {submitting ? '提交中...' : '确认驳回'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Audited overlay notice */}
            {state === 'audited' && (
                <div className={`${isEmbedded ? 'sticky bottom-0' : 'fixed bottom-0 left-0 right-0'} bg-slate-800/95 backdrop-blur border-t border-slate-700 p-4 safe-area-bottom`}>
                    <div className="text-center text-sm text-yellow-300">
                        该工单已被审核，仅供查看
                    </div>
                </div>
            )}
        </div>
    );
}

// ===== Conversation View Component =====
interface ConversationItem {
    id?: number;
    bodyText: string;
    userId?: number;
    createdAt?: string;
    incoming?: boolean;
    isPrivate?: boolean;
}

interface ParsedContent {
    description?: string;
    conversations?: ConversationItem[];
}

function formatTime(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hour}:${minute}`;
    } catch {
        return dateStr;
    }
}

function getSenderLabel(item: ConversationItem): string {
    if (item.userId) {
        const agentName = AGENT_MAP[String(item.userId)];
        if (agentName) return agentName;
    }
    return item.incoming ? '客户' : '客服';
}

function ConversationView({ jsonContent }: { jsonContent: string }) {
    const parsed = useMemo<ParsedContent | null>(() => {
        try {
            const obj = JSON.parse(jsonContent);
            if (obj && typeof obj === 'object' && ('description' in obj || 'conversations' in obj)) {
                return obj as ParsedContent;
            }
            return null;
        } catch {
            return null;
        }
    }, [jsonContent]);

    // Fallback: render raw text if JSON parse fails or structure is unexpected
    if (!parsed) {
        return (
            <div className="text-sm text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {jsonContent}
            </div>
        );
    }

    const { description, conversations } = parsed;

    return (
        <div className="max-h-72 overflow-y-auto space-y-3">
            {/* Description (initial ticket body) */}
            {description && (
                <div className="bg-slate-700/40 rounded-lg px-3 py-2 border-l-2 border-blue-500/60">
                    <div className="text-[10px] font-medium text-blue-400 mb-1 uppercase tracking-wider">工单描述</div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap break-words">{description}</div>
                </div>
            )}

            {/* Conversations */}
            {conversations && conversations.length > 0 && (
                <>
                    {description && (
                        <div className="flex items-center gap-2 py-1">
                            <div className="flex-1 h-px bg-slate-700" />
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">对话记录</span>
                            <div className="flex-1 h-px bg-slate-700" />
                        </div>
                    )}
                    <div className="space-y-2.5">
                        {conversations.map((item, idx) => {
                            const isIncoming = item.incoming !== false;
                            const senderLabel = getSenderLabel(item);
                            const isAgent = !isIncoming;

                            return (
                                <div
                                    key={item.id ?? idx}
                                    className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}
                                >
                                    {/* Sender + timestamp row */}
                                    <div className={`flex items-center gap-1.5 mb-0.5 ${isAgent ? 'flex-row-reverse' : ''}`}>
                                        <span className={`text-[10px] font-medium ${isAgent ? 'text-emerald-400' : 'text-blue-400'}`}>
                                            {senderLabel}
                                        </span>
                                        {item.createdAt && (
                                            <span className="text-[10px] text-slate-500">{formatTime(item.createdAt)}</span>
                                        )}
                                        {item.isPrivate && (
                                            <span className="text-[9px] px-1 py-px rounded bg-yellow-500/20 text-yellow-400">
                                                私密
                                            </span>
                                        )}
                                    </div>
                                    {/* Bubble */}
                                    <div
                                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                                            isAgent
                                                ? 'bg-emerald-600/20 border border-emerald-500/20 text-slate-200 rounded-tr-sm'
                                                : 'bg-slate-700/60 border border-slate-600/30 text-slate-300 rounded-tl-sm'
                                        }`}
                                    >
                                        {item.bodyText}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Edge case: parsed successfully but no content */}
            {!description && (!conversations || conversations.length === 0) && (
                <div className="text-sm text-slate-500 italic">暂无内容</div>
            )}
        </div>
    );
}

// ===== Collapsible Card Component =====
function Card({ title, children, defaultCollapsed = false }: {
    title: string;
    children: React.ReactNode;
    defaultCollapsed?: boolean;
}) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    return (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 overflow-hidden">
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left"
            >
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
                <svg
                    className={`w-4 h-4 text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {!collapsed && (
                <div className="px-4 pb-3">
                    {children}
                </div>
            )}
        </div>
    );
}
