import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";

// 首屏必需的组件（同步加载）
import type { TabType } from "./shared/types/navigation";
import AppShell from "./shared/components/navigation/AppShell";
import AuthLoginTab from "./modules/auth/pages/AuthLoginTab";
import AuthRegisterTab from "./modules/auth/pages/AuthRegisterTab";
import ErrorBoundary from "./shared/components/ErrorBoundary";
import ToastProvider from "./shared/components/ToastProvider";

// 非首屏组件（懒加载）
const SettingsTab = lazy(() => import("./modules/system/pages/SettingsTab"));
const ServerTicketsTab = lazy(() => import("./modules/ticket/pages/ServerTicketsTab"));
const ApprovedTasksTab = lazy(() => import("./modules/ticket/pages/ApprovedTasksTab"));
const AdminUsersTab = lazy(() => import("./modules/admin/pages/AdminUsersTab"));
const ManualSyncTab = lazy(() => import("./modules/admin/pages/ManualSyncTab"));
const ServerLogsTab = lazy(() => import("./modules/admin/pages/ServerLogsTab"));
const DatabaseTab = lazy(() => import("./modules/admin/pages/DatabaseTab"));
const KnowledgeTab = lazy(() => import("./modules/admin/pages/KnowledgeTab"));
const RolePermissionTab = lazy(() => import("./modules/admin/pages/RolePermissionTab"));
const OrgSyncTab = lazy(() => import("./modules/admin/pages/OrgSyncTab"));
const JenkinsTab = lazy(() => import("./modules/admin/pages/JenkinsTab"));
const TaskDashboardTab = lazy(() => import("./modules/task/pages/TaskDashboardTab"));
const TaskDefinitionsTab = lazy(() => import("./modules/task/pages/TaskDefinitionsTab"));
const TaskHistoryTab = lazy(() => import("./modules/task/pages/TaskHistoryTab"));
const AgentExecutionTab = lazy(() => import("./modules/task/pages/AgentExecutionTab"));
const UserProfileTab = lazy(() => import("./modules/system/pages/UserProfileTab"));
const WorkflowCapabilitiesTab = lazy(() => import("./modules/workflow/pages/WorkflowCapabilitiesTab"));
const WorkflowAgentsTab = lazy(() => import("./modules/workflow/pages/WorkflowAgentsTab"));
const WorkflowAiTab = lazy(() => import("./modules/workflow/pages/WorkflowAiTab"));
const WorkflowN8nTab = lazy(() => import("./modules/workflow/pages/WorkflowN8nTab"));
const AiDashboardTab = lazy(() => import("./modules/workflow/pages/AiDashboardTab"));
const ManualRequiredTab = lazy(() => import("./modules/workflow/pages/ManualRequiredTab"));
const AgentAutomationTab = lazy(() => import("./modules/ticket/pages/AgentAutomationTab"));
const AuditCenterTab = lazy(() => import("./modules/ticket/pages/AuditCenterTab"));
const KnowledgeBasePage = lazy(() => import("./modules/knowledge/pages/KnowledgeBasePage"));
const NotebookLmPage = lazy(() => import("./modules/knowledge/pages/NotebookLmPage"));
const MobileAuditPage = lazy(() => import("./modules/mobile/pages/MobileAuditPage"));

import { AuthProvider, useAuthContext } from "./shared/context/AuthContext";
import { AgentProvider } from "./shared/agents";
import { ServerEventsProvider } from "./shared/context/ServerEventsContext";
import { UniversalAgentConsumer } from "./shared/context/UniversalAgentConsumer";
import { JsonPreviewProvider } from "./shared/components/JsonPreview";

import { useSettings } from "./shared/hooks/useSettings";
import { ticketApi } from "./shared/services/serverApi";
import type { QueueCounts } from "./shared/types/server";

/**
 * Tab 路由上下文 — 传入 props 工厂函数使用
 */
interface AppContext {
    navigateToTicketId: number | null;
    handleTaskNavigated: () => void;
    serverUrl: string;
    setServerUrl: (url: string) => void;
    translationLang: string;
    setTranslationLang: (lang: string) => void;
}

/**
 * Tab 路由配置
 */
interface TabRoute {
    component: React.LazyExoticComponent<React.FC<any>> | React.FC<any>;
    requireAuth?: boolean;
    requireAdmin?: boolean;
    props?: (ctx: AppContext) => Record<string, any>;
}

/**
 * Tab 路由映射表 — 替代 switch 巨型语句
 * 注意：'auth' 和 'server-tickets' 有特殊分支逻辑，不在此表中
 */
const TAB_COMPONENTS: Partial<Record<TabType, TabRoute>> = {
    'profile': {
        component: UserProfileTab,
        requireAuth: false, // profile 页面自身处理 auth 状态
    },
    'settings': {
        component: SettingsTab,
        requireAuth: false, // settings 页面自身处理 auth 状态
        props: (ctx) => ({
            serverUrl: ctx.serverUrl,
            setServerUrl: ctx.setServerUrl,
            translationLang: ctx.translationLang,
            setTranslationLang: ctx.setTranslationLang,
        }),
    },
    'agent-automation': {
        component: AgentAutomationTab,
        requireAuth: true,
    },
    'audit-center': {
        component: AuditCenterTab,
        requireAuth: true,
    },
    'approved': {
        component: ApprovedTasksTab,
        requireAuth: true,
    },
    'admin-users': {
        component: AdminUsersTab,
        requireAdmin: true,
    },
    'role-permission': {
        component: RolePermissionTab,
        requireAdmin: true,
    },
    'manual-sync': {
        component: ManualSyncTab,
        requireAdmin: true,
    },
    'server-logs': {
        component: ServerLogsTab,
        requireAdmin: true,
    },
    'database': {
        component: DatabaseTab,
        requireAdmin: true,
    },
    'knowledge': {
        component: KnowledgeTab,
        requireAuth: true,
    },
    'knowledge-base': {
        component: KnowledgeBasePage,
        requireAuth: true,
    },
    'notebooklm': {
        component: NotebookLmPage,
        requireAuth: true,
    },
    'org-sync': {
        component: OrgSyncTab,
        requireAdmin: true,
    },
'task-dashboard': {
        component: TaskDashboardTab,
        requireAdmin: true,
    },
    'task-definitions': {
        component: TaskDefinitionsTab,
        requireAdmin: true,
    },
    'task-history': {
        component: TaskHistoryTab,
        requireAdmin: true,
    },
    'agent-execution': {
        component: AgentExecutionTab,
        requireAdmin: true,
    },
    'workflow-capabilities': {
        component: WorkflowCapabilitiesTab,
        requireAdmin: true,
    },
    'workflow-agents': {
        component: WorkflowAgentsTab,
        requireAdmin: true,
    },
    'workflow-ai': {
        component: WorkflowAiTab,
        requireAdmin: true,
    },
    'ai-dashboard': {
        component: AiDashboardTab,
        requireAdmin: true,
    },
    'manual-required': {
        component: ManualRequiredTab,
        requireAdmin: true,
    },
    // workflow-n8n: keep-alive 模式，不在此表中，始终挂载在 DOM 中（见下方渲染逻辑）
    // admin-jenkins: keep-alive 模式，同 n8n，避免切换标签时重载 iframe
};

/** Admin 权限守卫 — 未登录或非管理员时显示锁定提示（从 AuthContext 获取状态） */
const AdminGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { t } = useTranslation('common');
    const { isLoggedIn, isAdmin } = useAuthContext();
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

/** 内部应用组件 — 在 AuthProvider 内部使用 useAuthContext */
function AppInner() {
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

    const auth = useAuthContext();
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
    } = useSettings();

    const handleLogin = async (credentials: { username: string; password: string }) => {
        await auth.login(credentials);
    };

    const handleOAuthLogin = async (platform: string, authCode: string) => {
        await auth.oauthLogin(platform, authCode);
    };

    const handleRegister = async (data: { username: string; password: string }) => {
        await auth.register(data);
    };

    /** 渲染 auth 视图（login/register 切换） */
    const renderAuthView = () => {
        if (authView === 'login') {
            return (
                <AuthLoginTab
                    onLogin={handleLogin}
                    onOAuthLogin={handleOAuthLogin}
                    onSwitchToRegister={() => setAuthView('register')}
                    isLoading={auth.isLoading}
                    error={auth.error}
                    errorCode={auth.errorCode}
                />
            );
        }
        return (
            <AuthRegisterTab
                onRegister={handleRegister}
                onSwitchToLogin={() => setAuthView('login')}
                isLoading={auth.isLoading}
                error={auth.error}
            />
        );
    };

    const renderTabContent = () => {
        // auth tab — 特殊分支（login/register 切换逻辑）
        if (activeTab === 'auth') {
            return renderAuthView();
        }

        // server-tickets — 特殊分支（未登录时显示登录页）
        if (activeTab === 'server-tickets') {
            if (!auth.isLoggedIn) {
                return renderAuthView();
            }
            return <ServerTicketsTab />;
        }

        // 查表驱动
        const route = TAB_COMPONENTS[activeTab];
        if (!route) return null;

        // requireAuth 守卫
        if (route.requireAuth && !auth.isLoggedIn) return null;

        // requireAdmin 守卫 — 使用 AdminGuard 包裹
        const appContext: AppContext = {
            navigateToTicketId,
            handleTaskNavigated,
            serverUrl,
            setServerUrl,
            translationLang,
            setTranslationLang,
        };

        const props = route.props ? route.props(appContext) : {};
        const Component = route.component;
        const element = <Component {...props} />;

        if (route.requireAdmin) {
            return <AdminGuard>{element}</AdminGuard>;
        }

        return element;
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
            <JsonPreviewProvider>
            <ServerEventsProvider>
            <AgentProvider>
                        <UniversalAgentConsumer />
                        <AppShell
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            queueCounts={queueCounts}
                        >
                            <ErrorBoundary>
                                <Suspense fallback={
                                    <div className="flex-1 flex items-center justify-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                                    </div>
                                }>
                                    {/* 常规 tab 内容（条件渲染） */}
                                    <div className="flex-1 flex overflow-hidden" style={{ display: (activeTab === 'workflow-n8n' || activeTab === 'admin-jenkins') ? 'none' : undefined }}>
                                        {renderTabContent()}
                                    </div>

                                    {/* n8n iframe — keep-alive：始终挂载，CSS 切换显隐，避免切换菜单时重新加载 */}
                                    {auth.isLoggedIn && (
                                        <div className="flex-1 flex overflow-hidden" style={{ display: activeTab === 'workflow-n8n' ? undefined : 'none' }}>
                                            <WorkflowN8nTab />
                                        </div>
                                    )}

                                    {/* Jenkins iframe — keep-alive：同 n8n 模式 */}
                                    {auth.isLoggedIn && (
                                        <div className="flex-1 flex overflow-hidden" style={{ display: activeTab === 'admin-jenkins' ? undefined : 'none' }}>
                                            <JenkinsTab />
                                        </div>
                                    )}
                                </Suspense>
                            </ErrorBoundary>
                        </AppShell>
            </AgentProvider>
            </ServerEventsProvider>
            </JsonPreviewProvider>
        </ToastProvider>
    );
}

/** App 根组件 — AuthProvider 包裹，确保所有子组件共享认证状态 */
function App() {
    // 移动审核页面 — 独立入口，无需登录
    if (window.location.pathname === '/m/audit') {
        return (
            <Suspense fallback={
                <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                </div>
            }>
                <MobileAuditPage />
            </Suspense>
        );
    }

    return (
        <AuthProvider>
            <AppInner />
        </AuthProvider>
    );
}

export default App;
