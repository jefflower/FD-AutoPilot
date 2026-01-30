/**
 * 注册页面组件 - 高级玻璃质感设计
 * 风格：暗色渐变 + 玻璃质感 + 光晕效果
 */

import React, { useState } from 'react';

interface AuthRegisterTabProps {
    onRegister: (data: { username: string; password: string }) => Promise<void>;
    onSwitchToLogin: () => void;
    isLoading?: boolean;
    error?: string | null;
}

const AuthRegisterTab: React.FC<AuthRegisterTabProps> = ({
    onRegister,
    onSwitchToLogin,
    isLoading = false,
    error,
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);

        if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
            setLocalError('请填写所有字段');
            return;
        }

        if (password.length < 6) {
            setLocalError('密码至少需要 6 位');
            return;
        }

        if (password !== confirmPassword) {
            setLocalError('两次输入的密码不一致');
            return;
        }

        try {
            await onRegister({ username: username.trim(), password });
            setSuccess(true);
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : '注册失败');
        }
    };

    const displayError = error || localError;

    // 注册成功页面
    if (success) {
        return (
            <div className="flex-1 flex items-center justify-center relative overflow-hidden">
                {/* 背景光晕 */}
                <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-radial from-emerald-500/20 via-transparent to-transparent blur-3xl animate-pulse" />
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gradient-radial from-cyan-500/15 via-transparent to-transparent blur-3xl" />
                </div>

                <div className="relative z-10 text-center max-w-md mx-6">
                    {/* 成功图标 */}
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-2xl shadow-emerald-500/30 mb-8">
                        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>

                    <h2 className="text-3xl font-bold text-white mb-4">注册成功!</h2>
                    <p className="text-slate-400 mb-8 leading-relaxed">
                        您的账号已创建成功，请等待管理员审核后即可登录使用。
                    </p>

                    <button
                        onClick={onSwitchToLogin}
                        className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-emerald-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-emerald-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-emerald-500/25"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                        </svg>
                        返回登录
                    </button>
                </div>

                <style>{`
          .bg-gradient-radial {
            background: radial-gradient(circle, var(--tw-gradient-stops));
          }
        `}</style>
            </div>
        );
    }

    return (
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
            {/* 背景光晕效果 */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-radial from-cyan-500/15 via-transparent to-transparent blur-3xl animate-pulse"
                    style={{ animationDuration: '5s' }} />
                <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-radial from-purple-600/15 via-transparent to-transparent blur-3xl animate-pulse"
                    style={{ animationDuration: '4s', animationDelay: '1.5s' }} />
                <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-gradient-radial from-pink-400/10 via-transparent to-transparent blur-2xl" />
            </div>

            {/* 网格背景 */}
            <div
                className="absolute inset-0 opacity-[0.02]"
                style={{
                    backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
                    backgroundSize: '50px 50px'
                }}
            />

            {/* 注册卡片 */}
            <div className="relative z-10 w-full max-w-md mx-6">
                {/* Logo 区域 */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500 via-purple-500 to-pink-500 shadow-2xl shadow-purple-500/30 mb-6 transform hover:scale-105 transition-transform duration-300">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">
                        创建账号
                    </h1>
                    <p className="text-slate-400 text-sm">
                        注册后需等待管理员审批
                    </p>
                </div>

                {/* 玻璃质感卡片 */}
                <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/[0.08] p-8 shadow-2xl shadow-black/20">
                    {/* 顶部高光 */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* 错误提示 */}
                        {displayError && (
                            <div className="relative overflow-hidden bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                                <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent" />
                                <div className="relative flex items-center gap-3">
                                    <div className="flex-shrink-0 w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center">
                                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <p className="text-red-300 text-sm font-medium">{displayError}</p>
                                </div>
                            </div>
                        )}

                        {/* 用户名输入 */}
                        <div className="space-y-2">
                            <label className="block text-slate-300 text-sm font-medium pl-1">用户名</label>
                            <div className={`relative group ${focusedField === 'username' ? 'z-10' : ''}`}>
                                <div className={`absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl opacity-0 blur transition-opacity duration-300 ${focusedField === 'username' ? 'opacity-50' : 'group-hover:opacity-30'}`} />
                                <div className="relative flex items-center">
                                    <div className="absolute left-4 text-slate-500">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField(null)}
                                        placeholder="请输入用户名"
                                        className="w-full pl-12 pr-4 py-3.5 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-transparent transition-all duration-300"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 密码输入 */}
                        <div className="space-y-2">
                            <label className="block text-slate-300 text-sm font-medium pl-1">密码</label>
                            <div className={`relative group ${focusedField === 'password' ? 'z-10' : ''}`}>
                                <div className={`absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl opacity-0 blur transition-opacity duration-300 ${focusedField === 'password' ? 'opacity-50' : 'group-hover:opacity-30'}`} />
                                <div className="relative flex items-center">
                                    <div className="absolute left-4 text-slate-500">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        placeholder="至少 6 位"
                                        className="w-full pl-12 pr-4 py-3.5 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-transparent transition-all duration-300"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 确认密码 */}
                        <div className="space-y-2">
                            <label className="block text-slate-300 text-sm font-medium pl-1">确认密码</label>
                            <div className={`relative group ${focusedField === 'confirm' ? 'z-10' : ''}`}>
                                <div className={`absolute -inset-0.5 bg-gradient-to-r from-pink-500 to-orange-500 rounded-xl opacity-0 blur transition-opacity duration-300 ${focusedField === 'confirm' ? 'opacity-50' : 'group-hover:opacity-30'}`} />
                                <div className="relative flex items-center">
                                    <div className="absolute left-4 text-slate-500">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        onFocus={() => setFocusedField('confirm')}
                                        onBlur={() => setFocusedField(null)}
                                        placeholder="再次输入密码"
                                        className="w-full pl-12 pr-4 py-3.5 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-transparent transition-all duration-300"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 注册按钮 */}
                        <button
                            type="submit"
                            disabled={isLoading || !username.trim() || !password.trim() || !confirmPassword.trim()}
                            className="relative w-full group overflow-hidden mt-6"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 via-purple-600 to-pink-600 rounded-xl" />
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent rounded-xl" />
                            <div className="relative py-4 px-6 flex items-center justify-center gap-3">
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin w-5 h-5 text-white/80" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        <span className="text-white font-semibold">提交中...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-white font-semibold text-lg">注 册</span>
                                        <svg className="w-5 h-5 text-white/80 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                        </svg>
                                    </>
                                )}
                            </div>
                            <div className="absolute inset-0 rounded-xl shadow-lg shadow-purple-500/25 group-hover:shadow-purple-500/40 transition-shadow duration-300" />
                        </button>
                    </form>

                    {/* 分隔线 */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/10" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-transparent text-slate-500">已有账号?</span>
                        </div>
                    </div>

                    {/* 登录链接 */}
                    <button
                        type="button"
                        onClick={onSwitchToLogin}
                        className="w-full py-3.5 border border-white/10 rounded-xl text-slate-300 font-medium hover:bg-white/5 hover:border-white/20 hover:text-white transition-all duration-300 flex items-center justify-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                        </svg>
                        返回登录
                    </button>
                </div>

                {/* 底部版权 */}
                <p className="text-center text-slate-600 text-xs mt-8">
                    FD-AutoPilot · Freshdesk 智能工单处理系统
                </p>
            </div>

            <style>{`
        .bg-gradient-radial {
          background: radial-gradient(circle, var(--tw-gradient-stops));
        }
      `}</style>
        </div>
    );
};

export default AuthRegisterTab;
