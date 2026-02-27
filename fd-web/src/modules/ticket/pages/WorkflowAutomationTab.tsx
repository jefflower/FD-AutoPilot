import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMQTranslation } from '../../../shared/context/MQTranslationContext';
import { useMQReply } from '../../../shared/context/MQReplyContext';
import { useMQAudit } from '../../../shared/context/MQAuditContext';
import { serverApi, ticketApi } from '../../../shared/services/serverApi';
import { isTauriEnv, checkBridgeAvailable } from '../../../tauri/bridge';
import PipelineOverviewBar from '../components/PipelineOverviewBar';
import type { PipelineStage } from '../components/PipelineOverviewBar';
import PipelineSidebar from '../components/PipelineSidebar';
import NotifyConfigPanel from '../components/NotifyConfigPanel';
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
    const [agentDisabled, setAgentDisabled] = useState(!isTauriEnv());

    // Mobile preview state
    const [previewToken, setPreviewToken] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState<number | null>(null);

    // Notify config panel state
    const [showNotifyConfig, setShowNotifyConfig] = useState(false);

    // 异步检测 Agent 可用性：Tauri 直接可用，或浏览器模式下 bridge 服务器可用
    useEffect(() => {
        if (isTauriEnv()) {
            setAgentDisabled(false);
            return;
        }
        checkBridgeAvailable().then(ok => setAgentDisabled(!ok));
    }, []);

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
            setPreviewToken(null); // Clear preview when selecting a ticket
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

    // ============ Toggle handlers ============

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

    // ============ Mobile preview ============

    const handleMobilePreview = useCallback(async (ticketId: number) => {
        setPreviewLoading(ticketId);
        try {
            const token = await ticketApi.getAuditToken(ticketId);
            setPreviewToken(token);
        } catch (err) {
            alert(t('audit.previewFailed', { error: (err as Error).message }));
        } finally {
            setPreviewLoading(null);
        }
    }, [t]);

    const handleBackFromPreview = useCallback(() => {
        setPreviewToken(null);
    }, []);

    // ============ Combined logs ============

    const combinedLogs = React.useMemo(() => {
        const all = [
            ...translation.logs.map(l => `[Trans] ${l}`),
            ...reply.logs.map(l => `[Reply] ${l}`),
            ...audit.logs.map(l => `[Audit] ${l}`),
        ];
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
                onSettingsClick={() => {
                    setShowNotifyConfig(v => !v);
                    setPreviewToken(null);
                }}
                showSettings={showNotifyConfig}
            />

            {/* Middle: Sidebar + Detail */}
            <div className="flex-1 flex overflow-hidden">
                {/* Pipeline sidebar */}
                <div className="w-80 flex-shrink-0 border-r border-slate-700/50 overflow-hidden">
                    <PipelineSidebar
                        translation={{
                            isRunning: translation.isRunning,
                            onToggle: handleTranslationToggle,
                            processingTasks: translation.processingTasks,
                            completedHistory: translation.completedHistory,
                            disabled: agentDisabled,
                            disabledMessage: agentDisabled ? t('automation.bridgeUnavailable') : undefined,
                        }}
                        reply={{
                            isRunning: reply.isRunning,
                            onToggle: handleReplyToggle,
                            processingTasks: reply.processingTasks,
                            completedHistory: reply.completedHistory,
                            disabled: agentDisabled,
                            disabledMessage: agentDisabled ? t('automation.bridgeUnavailable') : undefined,
                        }}
                        audit={{
                            isRunning: audit.isRunning,
                            onToggle: handleAuditToggle,
                            processingTasks: audit.processingTasks,
                            completedHistory: audit.completedHistory,
                            onPass: handleAuditPass,
                            onReject: handleAuditReject,
                            onRetranslate: handleAuditRetranslate,
                            onMobilePreview: handleMobilePreview,
                            previewLoading,
                        }}
                        onSelectTicket={setSelectedTicketId}
                        selectedTicketId={selectedTicketId}
                    />
                </div>

                {/* Right: Detail panel */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {showNotifyConfig ? (
                        <NotifyConfigPanel onClose={() => setShowNotifyConfig(false)} />
                    ) : previewToken ? (
                        <div className="flex-1 flex flex-col items-center justify-center bg-black/30 overflow-hidden py-4">
                            {/* Back + controls bar */}
                            <div className="flex items-center gap-3 mb-3">
                                <button
                                    onClick={handleBackFromPreview}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/90 rounded-lg text-xs font-medium text-slate-300 hover:text-white border border-white/10 transition-colors"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                    {t('common:button.back')}
                                </button>
                                <span className="text-[10px] text-slate-500 font-mono">390 x 844 · iPhone 14</span>
                            </div>
                            {/* Phone frame */}
                            <div
                                className="bg-slate-950 rounded-[2.5rem] p-3 shadow-2xl border border-slate-700/50 flex-shrink-0"
                                style={{ width: 390 + 24, height: Math.min(844, 720) + 24 }}
                            >
                                {/* Notch */}
                                <div className="flex justify-center mb-1">
                                    <div className="w-24 h-5 bg-slate-950 rounded-b-2xl" />
                                </div>
                                <iframe
                                    src={`/m/audit?token=${encodeURIComponent(previewToken)}`}
                                    className="w-full rounded-2xl bg-slate-900"
                                    style={{ width: 390, height: Math.min(844, 720) - 30 }}
                                    title="Mobile Audit Preview"
                                />
                            </div>
                        </div>
                    ) : selectedTicket ? (
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
