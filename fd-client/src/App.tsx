import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";

// 首屏必需的组件（同步加载）
import SidebarNew, { TabType } from "./components/SidebarNew";
import AuthLoginTab from "./components/auth/AuthLoginTab";
import AuthRegisterTab from "./components/auth/AuthRegisterTab";

// 非首屏组件（懒加载）
const SettingsTab = lazy(() => import("./components/SettingsTab"));
const TranslationTasksTab = lazy(() => import("./components/server/TranslationTasksTab"));
const ReplyTasksTab = lazy(() => import("./components/server/ReplyTasksTab"));
const ServerTicketsTab = lazy(() => import("./components/server/ServerTicketsTab"));
const AuditTasksTab = lazy(() => import("./components/server/AuditTasksTab"));
const ApprovedTasksTab = lazy(() => import("./components/server/ApprovedTasksTab"));
const AdminUsersTab = lazy(() => import("./components/admin/AdminUsersTab"));
const ManualSyncTab = lazy(() => import("./components/admin/ManualSyncTab"));
const ServerLogsTab = lazy(() => import("./components/admin/ServerLogsTab"));
const DatabaseTab = lazy(() => import("./components/admin/DatabaseTab"));
const KnowledgeTab = lazy(() => import("./components/admin/KnowledgeTab"));
const UserProfileTab = lazy(() => import("./components/user/UserProfileTab"));
const FloatingTaskWidget = lazy(() => import("./components/common/FloatingTaskWidget").then(m => ({ default: m.FloatingTaskWidget })));

import { MQTranslationProvider } from "./context/MQTranslationContext";
import { MQReplyProvider } from "./context/MQReplyContext";
import { MQAuditProvider } from "./context/MQAuditContext";

import { useSettings } from "./hooks/useSettings";
import { useAuth } from "./hooks/useAuth";
import { ticketApi } from "./services/serverApi";
import type { QueueCounts } from "./types/server";

function App() {
    const { t } = useTranslation('common');
    const [activeTab, setActiveTab] = useState<TabType>('server-tickets');
    const [authView, setAuthView] = useState<'login' | 'register'>('login');
    const [navigateToTicketId, setNavigateToTicketId] = useState<number | null>(null);

    useEffect(() => {
        const handler = (e: Event) => {
            const { tab, ticketId } = (e as CustomEvent).detail;
            setActiveTab(tab);
            setNavigateToTicketId(ticketId);
        };
        window.addEventListener('navigate-to-task', handler);
        return () => window.removeEventListener('navigate-to-task', handler);
    }, []);

    const handleTaskNavigated = useCallback(() => {
        setNavigateToTicketId(null);
    }, []);

    const auth = useAuth();
    const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchQueueCounts = useCallback(() => {
        if (!auth.isLoggedIn) return;
        ticketApi.getQueueCounts().then(setQueueCounts).catch(() => {});
    }, [auth.isLoggedIn]);

    // 定时轮询 MQ 队列计数
    useEffect(() => {
        if (!auth.isLoggedIn) {
            setQueueCounts(null);
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            return;
        }

        fetchQueueCounts();
        pollTimerRef.current = setInterval(fetchQueueCounts, 30_000);

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [auth.isLoggedIn, fetchQueueCounts]);

    // 任务完成时立即刷新队列计数
    useEffect(() => {
        const handler = () => fetchQueueCounts();
        window.addEventListener('queue-counts-refresh', handler);
        return () => window.removeEventListener('queue-counts-refresh', handler);
    }, [fetchQueueCounts]);

    const {
        serverUrl, setServerUrl,
        mqHost, setMqHost,
        mqPort, setMqPort,
        mqUsername, setMqUsername,
        mqPassword, setMqPassword,
        translationLang, setTranslationLang,
        notebookLMConfig, setNotebookLMConfig
    } = useSettings();

    const handleLogin = async (credentials: { username: string; password: string }) => {
        await auth.login(credentials);
    };

    const handleRegister = async (data: { username: string; password: string }) => {
        await auth.register(data);
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'auth':
                return authView === 'login' ? (
                    <AuthLoginTab
                        onLogin={handleLogin}
                        onSwitchToRegister={() => setAuthView('register')}
                        isLoading={auth.isLoading}
                        error={auth.error}
                    />
                ) : (
                    <AuthRegisterTab
                        onRegister={handleRegister}
                        onSwitchToLogin={() => setAuthView('login')}
                        isLoading={auth.isLoading}
                        error={auth.error}
                    />
                );

            case 'profile':
                return (
                    <UserProfileTab
                        username={auth.user?.username}
                        role={auth.user?.role}
                        onLogout={auth.logout}
                    />
                );

            case 'settings':
                return (
                    <SettingsTab
                        serverUrl={serverUrl}
                        setServerUrl={setServerUrl}
                        mqHost={mqHost}
                        setMqHost={setMqHost}
                        mqPort={mqPort}
                        setMqPort={setMqPort}
                        mqUsername={mqUsername}
                        setMqUsername={setMqUsername}
                        mqPassword={mqPassword}
                        setMqPassword={setMqPassword}
                        translationLang={translationLang}
                        setTranslationLang={setTranslationLang}
                        notebookLMConfig={notebookLMConfig}
                        setNotebookLMConfig={setNotebookLMConfig}
                    />
                );

            case 'server-tickets':
                if (!auth.isLoggedIn) {
                    return authView === 'login' ? (
                        <AuthLoginTab
                            onLogin={handleLogin}
                            onSwitchToRegister={() => setAuthView('register')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                        />
                    ) : (
                        <AuthRegisterTab
                            onRegister={handleRegister}
                            onSwitchToLogin={() => setAuthView('login')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                        />
                    );
                }
                return (
                    <ServerTicketsTab
                        isAdmin={auth.isAdmin}
                    />
                );

            case 'translation':
                if (!auth.isLoggedIn) return null;
                return (
                    <TranslationTasksTab
                        initialSelectedId={navigateToTicketId}
                        onNavigated={handleTaskNavigated}
                    />
                );

            case 'reply':
                if (!auth.isLoggedIn) return null;
                return (
                    <ReplyTasksTab
                        initialSelectedId={navigateToTicketId}
                        onNavigated={handleTaskNavigated}
                    />
                );

            case 'audit':
                if (!auth.isLoggedIn) return null;
                return (
                    <AuditTasksTab />
                );

            case 'approved':
                if (!auth.isLoggedIn) return null;
                return (
                    <ApprovedTasksTab />
                );

            case 'admin-users':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>{t('error.adminRequired')}</p>
                            </div>
                        </div>
                    );
                }
                return <AdminUsersTab />;

            case 'manual-sync':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>{t('error.adminRequired')}</p>
                            </div>
                        </div>
                    );
                }
                return <ManualSyncTab />;

            case 'server-logs':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>{t('error.adminRequired')}</p>
                            </div>
                        </div>
                    );
                }
                return <ServerLogsTab />;

            case 'database':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>{t('error.adminRequired')}</p>
                            </div>
                        </div>
                    );
                }
                return <DatabaseTab />;

            case 'knowledge':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>{t('error.adminRequired')}</p>
                            </div>
                        </div>
                    );
                }
                return <KnowledgeTab />;

            default:
                return null;
        }
    };

    if (!auth.isLoggedIn) {
        return (
            <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
                {authView === 'login' ? (
                    <AuthLoginTab
                        onLogin={handleLogin}
                        onSwitchToRegister={() => setAuthView('register')}
                        isLoading={auth.isLoading}
                        error={auth.error}
                    />
                ) : (
                    <AuthRegisterTab
                        onRegister={handleRegister}
                        onSwitchToLogin={() => setAuthView('login')}
                        isLoading={auth.isLoading}
                        error={auth.error}
                    />
                )}
            </div>
        );
    }

    return (
        <MQTranslationProvider>
            <MQReplyProvider>
                <MQAuditProvider>
                    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
                        <SidebarNew
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            isLoggedIn={auth.isLoggedIn}
                            isAdmin={auth.isAdmin}
                            onLogout={auth.logout}
                            username={auth.user?.username}
                            queueCounts={queueCounts}
                        />

                        <Suspense fallback={
                            <div className="flex-1 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                            </div>
                        }>
                            <div className="flex-1 flex overflow-hidden">
                                {renderTabContent()}
                            </div>

                            <FloatingTaskWidget />
                        </Suspense>
                    </div>
                </MQAuditProvider>
            </MQReplyProvider>
        </MQTranslationProvider>
    );
}

export default App;
