/**
 * 用户中心页面
 * 显示用户信息和注销功能
 */

import React from 'react';

interface UserProfileTabProps {
    username?: string;
    role?: string;
    onLogout: () => void;
}

const UserProfileTab: React.FC<UserProfileTabProps> = ({
    username = '用户',
    role = 'USER',
    onLogout,
}) => {
    return (
        <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-md">
                {/* 用户头像卡片 */}
                <div className="backdrop-blur-xl bg-slate-800/80 rounded-2xl border border-white/10 p-8 shadow-xl text-center">
                    {/* 头像 */}
                    <div className="w-24 h-24 mx-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-indigo-500/30 mb-6">
                        {username.charAt(0).toUpperCase()}
                    </div>

                    {/* 用户名 */}
                    <h2 className="text-2xl font-bold text-white mb-2">{username}</h2>

                    {/* 角色标签 */}
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-700/50 text-sm text-slate-300 mb-8">
                        <span className={`w-2 h-2 rounded-full ${role === 'ADMIN' ? 'bg-amber-400' : 'bg-green-400'}`} />
                        {role === 'ADMIN' ? '管理员' : '普通用户'}
                    </div>

                    {/* 分隔线 */}
                    <div className="border-t border-white/10 my-6" />

                    {/* 功能列表 */}
                    <div className="space-y-3">
                        {/* 注销按钮 */}
                        <button
                            onClick={onLogout}
                            className="w-full py-3 px-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            退出登录
                        </button>
                    </div>

                    {/* 提示 */}
                    <p className="text-slate-500 text-xs mt-6">
                        更多功能即将推出...
                    </p>
                </div>
            </div>
        </div>
    );
};

export default UserProfileTab;
