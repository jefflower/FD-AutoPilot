/**
 * 扩展版主应用入口
 * 在保留原有功能的基础上集成新的服务端交互模块
 */

import { useState } from "react";
import "./index.css";

// 原有组件
import SyncTab from "./components/SyncTab";
import BrowseTab from "./components/BrowseTab";
import SettingsTab from "./components/SettingsTab";

// 新增组件
import SidebarNew, { TabType } from "./components/SidebarNew";
import AuthLoginTab from "./components/auth/AuthLoginTab";
import AuthRegisterTab from "./components/auth/AuthRegisterTab";
import TranslationTasksTab from "./components/server/TranslationTasksTab";
import ReplyTasksTab from "./components/server/ReplyTasksTab";
import ServerTicketsTab from "./components/server/ServerTicketsTab";
import AuditTasksTab from "./components/server/AuditTasksTab";
import AdminUsersTab from "./components/admin/AdminUsersTab";
import ManualSyncTab from "./components/admin/ManualSyncTab";
import UserProfileTab from "./components/user/UserProfileTab";

// Hooks
import { useSettings } from "./hooks/useSettings";
import { useSync } from "./hooks/useSync";
import { useTickets } from "./hooks/useTickets";
import { useTranslation } from "./hooks/useTranslation";
import { useAuth } from "./hooks/useAuth";

function AppNew() {
    const [activeTab, setActiveTab] = useState<TabType>('sync');
    const [authView, setAuthView] = useState<'login' | 'register'>('login');

    // 认证状态
    const auth = useAuth();

    // 原有 Logic Hooks
    const {
        apiKey, setApiKey,
        outputDir, setOutputDir,
        syncStartDate, setSyncStartDate,
        mqHost, setMqHost,
        mqPort, setMqPort,
        mqUsername, setMqUsername,
        mqPassword, setMqPassword,
        notebookLMConfig, setNotebookLMConfig
    } = useSettings();

    const {
        tickets,
        selectedTicket, setSelectedTicket,
        displayLang, setDisplayLang,
        isLoadingTickets, setIsLoadingTickets,
        listLang, setListLang,
        searchQuery, setSearchQuery,
        statusFilter, setStatusFilter,
        filteredTickets, statusCounts,
        loadTickets,
        navigateToTicket
    } = useTickets(outputDir);

    const {
        logs, setLogs,
        isSyncing,
        progress,
        fullSync, setFullSync,
        logsEndRef,
        startSync,
        syncStatuses
    } = useSync(apiKey, outputDir, syncStartDate, loadTickets);

    const {
        isTranslating,
        selectedIds, setSelectedIds,
        batchProgress,
        isAborting, setIsAborting,
        abortBatchRef,
        handleTranslate,
        handleBatchTranslate,
        handleBatchExport,
        toggleTicketSelection,
        handleSwitchToOriginal
    } = useTranslation(
        outputDir,
        tickets,
        selectedTicket,
        setSelectedTicket,
        setDisplayLang,
        setIsLoadingTickets,
        loadTickets,
        setLogs
    );

    // 处理登录
    const handleLogin = async (credentials: { username: string; password: string }) => {
        await auth.login(credentials);
    };

    // 处理注册
    const handleRegister = async (data: { username: string; password: string }) => {
        await auth.register(data);
    };

    // 渲染当前 Tab 内容
    const renderTabContent = () => {
        switch (activeTab) {
            // ===== 认证 =====
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

            // ===== 用户中心 =====
            case 'profile':
                return (
                    <UserProfileTab
                        username={auth.user?.username}
                        role={auth.user?.role}
                        onLogout={auth.logout}
                    />
                );

            // ===== 原有功能 =====
            case 'sync':
                return (
                    <SyncTab
                        isSyncing={isSyncing}
                        progress={progress}
                        fullSync={fullSync}
                        setFullSync={setFullSync}
                        syncStartDate={syncStartDate}
                        startSync={startSync}
                        syncStatuses={syncStatuses}
                        logs={logs}
                        logsEndRef={logsEndRef}
                    />
                );

            case 'browse':
                return (
                    <BrowseTab
                        tickets={tickets}
                        filteredTickets={filteredTickets}
                        selectedTicket={selectedTicket}
                        setSelectedTicket={setSelectedTicket}
                        isLoadingTickets={isLoadingTickets}
                        loadTickets={loadTickets}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        statusFilter={statusFilter}
                        setStatusFilter={setStatusFilter}
                        statusCounts={statusCounts}
                        listLang={listLang}
                        setListLang={setListLang}
                        selectedIds={selectedIds}
                        toggleSelectAll={() => {
                            if (selectedIds.size === filteredTickets.length && filteredTickets.length > 0) {
                                setSelectedIds(new Set());
                            } else {
                                setSelectedIds(new Set(filteredTickets.map(t => t.id)));
                            }
                        }}
                        toggleTicketSelection={toggleTicketSelection}
                        handleBatchTranslate={handleBatchTranslate}
                        handleBatchExport={() => handleBatchExport(listLang)}
                        batchProgress={batchProgress}
                        isAborting={isAborting}
                        abortBatchRef={abortBatchRef}
                        setIsAborting={setIsAborting}
                        displayLang={displayLang}
                        setDisplayLang={setDisplayLang}
                        isTranslating={isTranslating}
                        handleTranslate={handleTranslate}
                        handleSwitchToOriginal={handleSwitchToOriginal}
                        navigateToTicket={navigateToTicket}
                        setLogs={setLogs}
                        notebookLMConfig={notebookLMConfig}
                    />
                );

            case 'settings':
                return (
                    <SettingsTab
                        apiKey={apiKey}
                        setApiKey={setApiKey}
                        outputDir={outputDir}
                        setOutputDir={setOutputDir}
                        syncStartDate={syncStartDate}
                        setSyncStartDate={setSyncStartDate}
                        mqHost={mqHost}
                        setMqHost={setMqHost}
                        mqPort={mqPort}
                        setMqPort={setMqPort}
                        mqUsername={mqUsername}
                        setMqUsername={setMqUsername}
                        mqPassword={mqPassword}
                        setMqPassword={setMqPassword}
                        notebookLMConfig={notebookLMConfig}
                        setNotebookLMConfig={setNotebookLMConfig}
                        setLogs={setLogs}
                    />
                );

            // ===== 服务端交互模块 =====
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
                return <ServerTicketsTab isAdmin={auth.isAdmin} />;

            case 'translation':
                if (!auth.isLoggedIn) {
                    return (
                        <AuthLoginTab
                            onLogin={handleLogin}
                            onSwitchToRegister={() => setAuthView('register')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                        />
                    );
                }
                return <TranslationTasksTab />;

            case 'reply':
                if (!auth.isLoggedIn) {
                    return (
                        <AuthLoginTab
                            onLogin={handleLogin}
                            onSwitchToRegister={() => setAuthView('register')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                        />
                    );
                }
                return <ReplyTasksTab />;

            case 'audit':
                if (!auth.isLoggedIn) {
                    return (
                        <AuthLoginTab
                            onLogin={handleLogin}
                            onSwitchToRegister={() => setAuthView('register')}
                            isLoading={auth.isLoading}
                            error={auth.error}
                        />
                    );
                }
                return <AuditTasksTab />;

            // ===== 管理员模块 =====
            case 'admin-users':
                if (!auth.isLoggedIn || !auth.isAdmin) {
                    return (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <div className="text-center">
                                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p>需要管理员权限</p>
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
                                <p>需要管理员权限</p>
                            </div>
                        </div>
                    );
                }
                return <ManualSyncTab />;

            default:
                return null;
        }
    };

    // 未登录时直接显示登录/注册页面，不显示侧边栏
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

    // 已登录：显示完整界面
    return (
        <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
            {/* 侧边栏 */}
            <SidebarNew
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isLoggedIn={auth.isLoggedIn}
                isAdmin={auth.isAdmin}
                onLogout={auth.logout}
                username={auth.user?.username}
            />

            {/* 主内容区 */}
            <div className="flex-1 flex overflow-hidden">
                {renderTabContent()}
            </div>
        </div>
    );
}

export default AppNew;
