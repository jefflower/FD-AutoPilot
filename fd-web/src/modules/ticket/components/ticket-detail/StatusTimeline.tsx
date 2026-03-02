import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { serverApi } from '../../../../shared/services/serverApi';

interface StatusLogEntry {
    id: number;
    fromStatus: string | null;
    toStatus: string;
    triggeredBy: string;
    remark: string | null;
    createdAt: string;
}

/** 状态圆点颜色（border + bg） */
function getStatusDotColor(status: string): string {
    const colors: Record<string, string> = {
        PENDING_TRANS: 'border-blue-400 bg-blue-400',
        TRANSLATING: 'border-cyan-400 bg-cyan-400',
        PENDING_REPLY: 'border-purple-400 bg-purple-400',
        REPLYING: 'border-violet-400 bg-violet-400',
        PROCESSING: 'border-yellow-400 bg-yellow-400',
        PENDING_AUDIT: 'border-orange-400 bg-orange-400',
        APPROVED: 'border-green-400 bg-green-400',
        COMPLETED: 'border-green-500 bg-green-500',
    };
    return colors[status] || 'border-slate-400 bg-slate-400';
}

/** 状态徽章颜色（bg + text） */
function getStatusBadgeColor(status: string): string {
    const colors: Record<string, string> = {
        PENDING_TRANS: 'bg-blue-500/20 text-blue-400',
        TRANSLATING: 'bg-cyan-500/20 text-cyan-400',
        PENDING_REPLY: 'bg-purple-500/20 text-purple-400',
        REPLYING: 'bg-violet-500/20 text-violet-400',
        PROCESSING: 'bg-yellow-500/20 text-yellow-400',
        PENDING_AUDIT: 'bg-orange-500/20 text-orange-400',
        APPROVED: 'bg-green-500/20 text-green-400',
        COMPLETED: 'bg-green-600/20 text-green-400',
    };
    return colors[status] || 'bg-slate-500/20 text-slate-400';
}

/** 格式化时间：展示为相对友好的格式 */
function formatTime(isoStr: string): string {
    try {
        const date = new Date(isoStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHour = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;

        // 超过 7 天显示完整日期时间
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoStr;
    }
}

interface StatusTimelineProps {
    ticketId: number;
}

const StatusTimeline: React.FC<StatusTimelineProps> = ({ ticketId }) => {
    const [logs, setLogs] = useState<StatusLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(true);
    const { t } = useTranslation(['tickets', 'common']);

    useEffect(() => {
        setLoading(true);
        serverApi.ticket
            .getStatusHistory(ticketId)
            .then(setLogs)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [ticketId]);

    /** 将状态码翻译为可读文本，优先使用 i18n */
    const translateStatus = (status: string): string => {
        const key = `common:ticketStatus.${status}` as any;
        const translated = t(key) as string;
        // 如果 i18n 没有对应 key，返回原始状态码
        return translated === key ? status : translated;
    };

    if (loading) {
        return (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                    <span className="text-xs text-slate-500">{t('detail.aiThinking')}</span>
                </div>
            </div>
        );
    }

    if (logs.length === 0) return null;

    const displayLogs = collapsed ? logs.slice(0, 3) : logs;
    const hasMore = logs.length > 3;

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
            <h3 className="text-xs font-black text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('timeline.title')}
                <span className="text-[10px] text-slate-600 font-mono font-normal">({logs.length})</span>
            </h3>

            <div className="relative pl-6">
                {/* 纵向连接线 */}
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-700/80" />

                {displayLogs.map((log, index) => (
                    <div key={log.id} className="relative pb-4 last:pb-0">
                        {/* 圆点 */}
                        <div
                            className={`absolute left-[-18px] top-[3px] w-2.5 h-2.5 rounded-full border-2 ${getStatusDotColor(log.toStatus)} ${
                                index === 0 ? 'ring-2 ring-offset-1 ring-offset-slate-800 ring-slate-600/50' : ''
                            }`}
                        />

                        {/* 内容 */}
                        <div className="ml-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${getStatusBadgeColor(log.toStatus)}`}>
                                    {translateStatus(log.toStatus)}
                                </span>
                                {log.fromStatus && (
                                    <span className="text-[10px] text-slate-600">
                                        <span className="text-slate-700 mx-0.5">&larr;</span>
                                        {translateStatus(log.fromStatus)}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] text-slate-500 font-mono">{formatTime(log.createdAt)}</span>
                                <span className="text-[10px] text-slate-700">&middot;</span>
                                <span className="text-[10px] text-slate-500">{log.triggeredBy}</span>
                            </div>
                            {log.remark && (
                                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{log.remark}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* 展开/收起按钮 */}
            {hasMore && (
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="mt-3 text-[10px] text-slate-500 hover:text-slate-300 font-bold uppercase tracking-wider transition-colors"
                >
                    {collapsed
                        ? t('timeline.showAll', { count: logs.length })
                        : t('timeline.collapse')}
                </button>
            )}
        </div>
    );
};

export default StatusTimeline;
