import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";

// 首屏必需的组件（同步加载）
import SidebarNew, { TabType } from "./shared/components/SidebarNew";
import AuthLoginTab from "./modules/auth/pages/AuthLoginTab";
import AuthRegisterTab from "./modules/auth/pages/AuthRegisterTab";
import ErrorBoundary from "./shared/components/ErrorBoundary";
import ToastProvider from "./shared/components/ToastProvider";

// 非首屏组件（懒加载）
const SettingsTab = lazy(() => import("./modules/system/pages/SettingsTab"));
const TranslationTasksTab = lazy(() => import("./modules/ticket/pages/TranslationTasksTab"));
const ReplyTasksTab = lazy(() => import("./modules/ticket/pages/ReplyTasksTab"));
const ServerTicketsTab = lazy(() => import("./modules/ticket/pages/ServerTicketsTab"));
const AuditTasksTab = lazy(() => import("./modules/ticket/pages/AuditTasksTab"));
const ApprovedTasksTab = lazy(() => import("./modules/ticket/pages/ApprovedTasksTab"));
const AdminUsersTab = lazy(() => import("./modules/admin/pages/AdminUsersTab"));
const ManualSyncTab = lazy(() => import("./modules/admin/pages/ManualSyncTab"));
const ServerLogsTab = lazy(() => import("./modules/admin/pages/ServerLogsTab"));
const DatabaseTab = lazy(() => import("./modules/admin/pages/DatabaseTab"));
const KnowledgeTab = lazy(() => import("./modules/admin/pages/KnowledgeTab"));
const TaskDashboardTab = lazy(() => import("./modules/task/pages/TaskDashboardTab"));
const TaskDefinitionsTab = lazy(() => import("./modules/task/pages/TaskDefinitionsTab"));
const TaskHistoryTab = lazy(() => import("./modules/task/pages/TaskHistoryTab"));
const UserProfileTab = lazy(() => import("./modules/system/pages/UserProfileTab"));
const FloatingTaskWidget = lazy(() => import("./shared/components/FloatingTaskWidget").then(m => ({ default: m.FloatingTaskWidget })));

import { MQTranslationProvider } from "./shared/context/MQTranslationContext";
import { MQReplyProvider } from "./shared/context/MQReplyContext";
import { MQAuditProvider } from "./shared/context/MQAuditContext";

import { useSettings } from "./shared/hooks/useSettings";
import { useAuth } from "./shared/hooks/useAuth";
import { ticketApi } from "./shared/services/serverApi";
import type { QueueCounts } from "./shared/types/server";

/** Admin 权限守卫 — 未登录或非管理员时显示锁定提示 */
const AdminGuard: React.FC<{ isLoggedIn: boolean; isAdmin: boolean; children: React.ReactNode }> = ({ isLoggedIn, isAdmin, children }) => {
    const { t } = useTranslation('common');
    if (!isLoggedIn || !isAdmin) {
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
    return <>{children}</>;
};

function App() {
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
                        errorCode={auth.errorCode}
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
                        translationLang={translationLang}
                        setTranslationLang={setTranslationLang}
                        isAdmin={auth.isAdmin}
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
                            errorCode={auth.errorCode}
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
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><AdminUsersTab /></AdminGuard>;

            case 'manual-sync':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><ManualSyncTab /></AdminGuard>;

            case 'server-logs':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><ServerLogsTab /></AdminGuard>;

            case 'database':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><DatabaseTab /></AdminGuard>;

            case 'knowledge':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><KnowledgeTab /></AdminGuard>;

            case 'task-dashboard':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><TaskDashboardTab /></AdminGuard>;

            case 'task-definitions':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><TaskDefinitionsTab /></AdminGuard>;

            case 'task-history':
                return <AdminGuard isLoggedIn={auth.isLoggedIn} isAdmin={auth.isAdmin}><TaskHistoryTab /></AdminGuard>;

            default:
                return null;
        }
    };

    if (!auth.isLoggedIn) {
        return (
            <ToastProvider>
                <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
                    {authView === 'login' ? (
                        <AuthLoginTab
                            onLogin={handleLogin}
                            onSwitchToRegister={() => setAuthView('register')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                            errorCode={auth.errorCode}
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
            </ToastProvider>
        );
    }

    return (
        <ToastProvider>
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

                            <ErrorBoundary>
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
                            </ErrorBoundary>
                        </div>
                    </MQAuditProvider>
                </MQReplyProvider>
            </MQTranslationProvider>
        </ToastProvider>
    );
}

export default App;
