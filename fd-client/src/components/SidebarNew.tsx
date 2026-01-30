/**
 * 侧边栏导航组件 (扩展版)
 * 在保留原有菜单的基础上添加新功能入口
 */

import React from 'react';
import { NavButton } from './Common';

// 扩展 Tab 类型定义
export type TabType =
    // 原有 Tab
    | 'sync'
    | 'browse'
    | 'settings'
    // 认证 Tab
    | 'auth'
    // 用户中心
    | 'profile'
    // 新增 Tab - 服务端交互
    | 'server-tickets'
    | 'translation'
    | 'reply'
    | 'audit'
    // 新增 Tab - 管理员专属
    | 'admin-users'
    | 'manual-sync';

interface SidebarNewProps {
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    isLoggedIn: boolean;
    isAdmin: boolean;
    onLogout?: () => void;
    username?: string;
}

const SidebarNew: React.FC<SidebarNewProps> = ({
    activeTab,
    setActiveTab,
    isLoggedIn,
    isAdmin,
    onLogout: _onLogout,
    username
}) => {
    return (
        <div className="w-16 min-w-16 max-w-16 bg-slate-900/50 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-6 flex-shrink-0 overflow-x-hidden overflow-y-auto box-border">
            {/* Logo */}
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-indigo-500/25 flex-shrink-0">
                F
            </div>

            {/* 导航菜单 */}
            <div className="flex-1 flex flex-col gap-2 mt-8 w-full items-center overflow-hidden">
                {/* ===== 原有功能 ===== */}
                <NavButton
                    label="Sync"
                    active={activeTab === 'sync'}
                    onClick={() => setActiveTab('sync')}
                    icon={
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    }
                />
                <NavButton
                    label="Tickets"
                    active={activeTab === 'browse'}
                    onClick={() => setActiveTab('browse')}
                    icon={
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    }
                />

                {/* 分隔线 */}
                <div className="w-8 h-px bg-white/10 my-2"></div>

                {/* ===== 服务端交互模块 ===== */}
                {isLoggedIn ? (
                    <>
                        <NavButton
                            label="Server"
                            active={activeTab === 'server-tickets'}
                            onClick={() => setActiveTab('server-tickets')}
                            icon={
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                                </svg>
                            }
                        />
                        <NavButton
                            label="翻译"
                            active={activeTab === 'translation'}
                            onClick={() => setActiveTab('translation')}
                            icon={
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                                </svg>
                            }
                        />
                        <NavButton
                            label="回复"
                            active={activeTab === 'reply'}
                            onClick={() => setActiveTab('reply')}
                            icon={
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                            }
                        />
                        <NavButton
                            label="审核"
                            active={activeTab === 'audit'}
                            onClick={() => setActiveTab('audit')}
                            icon={
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            }
                        />

                        {/* 管理员分隔线 */}
                        {isAdmin && (
                            <div className="w-8 h-px bg-white/10 my-2"></div>
                        )}

                        {/* ===== 管理员专属模块 ===== */}
                        {isAdmin && (
                            <>
                                <NavButton
                                    label="用户"
                                    active={activeTab === 'admin-users'}
                                    onClick={() => setActiveTab('admin-users')}
                                    icon={
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                        </svg>
                                    }
                                />
                                <NavButton
                                    label="同步"
                                    active={activeTab === 'manual-sync'}
                                    onClick={() => setActiveTab('manual-sync')}
                                    icon={
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                        </svg>
                                    }
                                />
                            </>
                        )}
                    </>
                ) : (
                    /* 未登录时显示登录入口 */
                    <NavButton
                        label="登录"
                        active={activeTab === 'auth'}
                        onClick={() => setActiveTab('auth')}
                        icon={
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                            </svg>
                        }
                    />
                )}

                {/* 设置放在底部 */}
                <div className="flex-1"></div>

                <NavButton
                    label="Settings"
                    active={activeTab === 'settings'}
                    onClick={() => setActiveTab('settings')}
                    icon={
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    }
                />
            </div>

            {/* 用户信息 - 点击进入用户中心 */}
            {isLoggedIn && (
                <div className="mt-4 flex flex-col items-center gap-2">
                    <div
                        className={`w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium cursor-pointer hover:scale-110 transition-transform duration-200 shadow-lg shadow-indigo-500/25 ${activeTab === 'profile' ? 'ring-2 ring-white/50' : ''}`}
                        title={`${username || '用户'} - 用户中心`}
                        onClick={() => setActiveTab('profile')}
                    >
                        {username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SidebarNew;
