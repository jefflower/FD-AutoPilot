import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMQTranslation } from '../../../shared/context/MQTranslationContext';
import { useMQReply } from '../../../shared/context/MQReplyContext';
import { useMQAudit } from '../../../shared/context/MQAuditContext';
import { serverApi, ticketApi } from '../../../shared/services/serverApi';
import { isTauriEnv } from '../../../tauri/bridge';
import PipelineOverviewBar from '../components/PipelineOverviewBar';
import type { PipelineStage } from '../components/PipelineOverviewBar';
import StagePanel from '../components/StagePanel';
import AuditStagePanel from '../components/AuditStagePanel';
import ServerTicketDetail from '../components/ServerTicketDetail';
import type { ServerTicket } from '../../../shared/types/server';

const WorkflowAutomationTab: React.FC = () => {
    const { t } = useTranslation(['tasks', 'common']);

    // ============ MQ Contexts ============

    const translation = useMQTranslation();
    const reply = useMQReply();
    const audit = useMQAudit();

    // ============ State ============

    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const isTauri = isTauriEnv();

    // Split mode persistence (shared with other tabs)
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true;
    });
    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    // ============ Load selected ticket detail ============

    useEffect(() => {
        if (selectedTicketId) {
            serverApi.ticket.getTicketById(selectedTicketId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load ticket detail:', err));
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId]);

    const handleRefresh = useCallback(() => {
        if (selectedTicketId) {
            serverApi.ticket.getTicketById(selectedTicketId)
                .then(setSelectedTicket)
                .catch(console.error);
        }
    }, [selectedTicketId]);

    // ============ Pipeline stages data ============

    const stages: PipelineStage[] = [
        {
            id: 'translation',
            label: t('automation.stageTranslation'),
            activeCount: translation.processingTasks.size,
            completedCount: translation.completedHistory.length,
            isRunning: translation.isRunning,
            color: 'cyan',
        },
        {
            id: 'reply',
            label: t('automation.stageReply'),
            activeCount: reply.processingTasks.size,
            completedCount: reply.completedHistory.length,
            isRunning: reply.isRunning,
            color: 'orange',
        },
        {
            id: 'audit',
            label: t('automation.stageAudit'),
            activeCount: audit.processingTasks.size,
            completedCount: audit.completedHistory.length,
            isRunning: audit.isRunning,
            color: 'rose',
        },
    ];

    const allRunning = translation.isRunning && reply.isRunning && audit.isRunning;

    const handleStartAll = useCallback(() => {
        if (!translation.isRunning) translation.startConsumer();
        if (!reply.isRunning) reply.startConsumer();
        if (!audit.isRunning) audit.startConsumer();
    }, [translation, reply, audit]);

    const handleStopAll = useCallback(() => {
        if (translation.isRunning) translation.stopConsumer();
        if (reply.isRunning) reply.stopConsumer();
        if (audit.isRunning) audit.stopConsumer();
    }, [translation, reply, audit]);

    // ============ Audit actions ============

    const handleAuditPass = useCallback(async (ticketId: number) => {
        try {
            const ticket = await serverApi.ticket.getTicketById(ticketId);
            if (!ticket.replies || ticket.replies.length === 0) {
                alert(t('audit.noReplyContent'));
                audit.completeAudit(ticketId, true);
                return;
            }
            await ticketApi.submitAudit(ticketId, {
                replyId: ticket.replies[ticket.replies.length - 1].id,
                auditResult: 'PASS',
            });
            audit.completeAudit(ticketId, true);
            if (selectedTicketId === ticketId) {
                setSelectedTicketId(null);
            }
        } catch (err) {
            alert(t('audit.submitFailed', { error: (err as Error).message }));
            audit.completeAudit(ticketId, false);
        }
    }, [audit, selectedTicketId, t]);

    const handleAuditReject = useCallback(async (ticketId: number, remark: string) => {
        try {
            const ticket = await serverApi.ticket.getTicketById(ticketId);
            if (!ticket.replies || ticket.replies.length === 0) {
                alert(t('audit.noReplyContent'));
                audit.completeAudit(ticketId, true);
                return;
            }
            await ticketApi.submitAudit(ticketId, {
                replyId: ticket.replies[ticket.replies.length - 1].id,
                auditResult: 'REJECT',
                auditRemark: remark,
            });
            audit.completeAudit(ticketId, true);
            if (selectedTicketId === ticketId) {
                setSelectedTicketId(null);
            }
        } catch (err) {
            alert(t('audit.rejectFailed', { error: (err as Error).message }));
            audit.completeAudit(ticketId, false);
        }
    }, [audit, selectedTicketId, t]);

    const handleAuditRetranslate = useCallback(async (ticketId: number, remark: string) => {
        try {
            const ticket = await serverApi.ticket.getTicketById(ticketId);
            if (!ticket.replies || ticket.replies.length === 0) {
                alert(t('audit.noReplyContent'));
                audit.completeAudit(ticketId, true);
                return;
            }
            await ticketApi.submitAudit(ticketId, {
                replyId: ticket.replies[ticket.replies.length - 1].id,
                auditResult: 'RETRANSLATE',
                auditRemark: remark,
            });
            audit.completeAudit(ticketId, true);
            if (selectedTicketId === ticketId) {
                setSelectedTicketId(null);
            }
        } catch (err) {
            alert(t('audit.submitFailed', { error: (err as Error).message }));
            audit.completeAudit(ticketId, false);
        }
    }, [audit, selectedTicketId, t]);

    // ============ Translation/Reply toggle handlers ============

    const handleTranslationToggle = useCallback(() => {
        if (translation.isRunning) {
            translation.stopConsumer();
        } else {
            translation.startConsumer();
        }
    }, [translation]);

    const handleReplyToggle = useCallback(() => {
        if (reply.isRunning) {
            reply.stopConsumer();
        } else {
            reply.startConsumer();
        }
    }, [reply]);

    const handleAuditToggle = useCallback(() => {
        if (audit.isRunning) {
            audit.stopConsumer();
        } else {
            audit.startConsumer();
        }
    }, [audit]);

    // ============ Combined logs ============

    const combinedLogs = React.useMemo(() => {
        const all = [
            ...translation.logs.map(l => `[Trans] ${l}`),
            ...reply.logs.map(l => `[Reply] ${l}`),
            ...audit.logs.map(l => `[Audit] ${l}`),
        ];
        // Logs are already chronological within each source.
        // We show them interleaved, keeping last 50.
        return all.slice(-50);
    }, [translation.logs, reply.logs, audit.logs]);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top: Pipeline Overview */}
            <PipelineOverviewBar
                stages={stages}
                onStartAll={handleStartAll}
                onStopAll={handleStopAll}
                allRunning={allRunning}
            />

            {/* Middle: Three-column layout + Detail */}
            <div className="flex-1 flex overflow-hidden">
                {/* Three stage columns */}
                <div className="w-[540px] flex-shrink-0 flex gap-1 p-1 border-r border-slate-700/50 overflow-hidden">
                    {/* Translation column */}
                    <div className="flex-1 min-w-0">
                        <StagePanel
                            title={t('automation.stageTranslation')}
                            color="cyan"
                            isRunning={translation.isRunning}
                            onToggle={handleTranslationToggle}
                            processingTasks={translation.processingTasks}
                            completedHistory={translation.completedHistory}
                            onSelectTicket={setSelectedTicketId}
                            selectedTicketId={selectedTicketId}
                            disabled={!isTauri}
                            disabledMessage={!isTauri ? t('automation.tauriHint') : undefined}
                        />
                    </div>

                    {/* Reply column */}
                    <div className="flex-1 min-w-0">
                        <StagePanel
                            title={t('automation.stageReply')}
                            color="orange"
                            isRunning={reply.isRunning}
                            onToggle={handleReplyToggle}
                            processingTasks={reply.processingTasks}
                            completedHistory={reply.completedHistory}
                            onSelectTicket={setSelectedTicketId}
                            selectedTicketId={selectedTicketId}
                            disabled={!isTauri}
                            disabledMessage={!isTauri ? t('automation.tauriHint') : undefined}
                        />
                    </div>

                    {/* Audit column */}
                    <div className="flex-1 min-w-0">
                        <AuditStagePanel
                            isRunning={audit.isRunning}
                            onToggle={handleAuditToggle}
                            processingTasks={audit.processingTasks}
                            completedHistory={audit.completedHistory}
                            onPass={handleAuditPass}
                            onReject={handleAuditReject}
                            onRetranslate={handleAuditRetranslate}
                            onSelectTicket={setSelectedTicketId}
                            selectedTicketId={selectedTicketId}
                        />
                    </div>
                </div>

                {/* Right: Ticket detail */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {selectedTicket ? (
                        <ServerTicketDetail
                            ticket={selectedTicket}
                            isEmbed={true}
                            isSplitMode={isSplitMode}
                            setIsSplitMode={setIsSplitMode}
                            onRefresh={handleRefresh}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <svg className="w-12 h-12 mx-auto mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                <p className="text-xs text-slate-600">{t('automation.noTasks')}</p>
                                <p className="text-[10px] text-slate-700 mt-1">{t('automation.pipeline')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom: Collapsible log panel */}
            <div className="border-t border-slate-700/50">
                <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-300 transition-colors bg-slate-800/30"
                >
                    <span className="font-bold uppercase tracking-wide flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                        Logs ({combinedLogs.length})
                    </span>
                    <svg
                        className={`w-3 h-3 transition-transform ${showLogs ? '' : 'rotate-180'}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                </button>

                {showLogs && (
                    <div className="h-32 overflow-y-auto custom-scrollbar bg-black/20 px-4 py-2 space-y-0.5 font-mono text-[10px]">
                        {combinedLogs.length === 0 ? (
                            <div className="text-slate-700 italic">No logs yet</div>
                        ) : (
                            combinedLogs.map((log, idx) => {
                                let color = 'text-slate-500';
                                if (log.startsWith('[Trans]')) color = 'text-cyan-600';
                                else if (log.startsWith('[Reply]')) color = 'text-orange-600';
                                else if (log.startsWith('[Audit]')) color = 'text-rose-600';
                                return (
                                    <div key={idx} className={color}>
                                        {log}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkflowAutomationTab;
