/**
 * 用户管理组件 (管理员专属)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../services/serverApi';
import type { User, UserStatus, UserQueryParams, UserRole } from '../../types/server';

const STATUS_COLORS: Record<UserStatus, string> = {
    PENDING: 'bg-yellow-500',
    APPROVED: 'bg-green-500',
    REJECTED: 'bg-red-500',
};

const AdminUsersTab: React.FC = () => {
    const { t, i18n } = useTranslation(['admin', 'common']);

    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [operating, setOperating] = useState<number | null>(null);
    const [totalElements, setTotalElements] = useState(0);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    // 密码重置弹窗
    const [resetTarget, setResetTarget] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');

    // 确认操作弹窗
    const [confirmAction, setConfirmAction] = useState<{
        user: User;
        action: 'APPROVE' | 'REJECT' | 'ROLE';
        role?: UserRole;
    } | null>(null);

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const params: UserQueryParams = { page, size: 20 };
            if (statusFilter) params.status = statusFilter;
            if (searchQuery.trim()) params.username = searchQuery.trim();

            const result = await adminApi.getAllUsers(params);
            setUsers(result.content);
            setTotalPages(result.totalPages);
            setTotalElements(result.totalElements);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, searchQuery, t]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleApprove = async (userId: number, action: 'APPROVE' | 'REJECT') => {
        setOperating(userId);
        setError(null);
        setConfirmAction(null);

        try {
            await adminApi.approveUser(userId, action);
            showSuccess(action === 'APPROVE' ? t('users.userApproved') : t('users.userRejected'));
            loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.operationFailed'));
        } finally {
            setOperating(null);
        }
    };

    const handleRoleChange = async (userId: number, role: UserRole) => {
        setOperating(userId);
        setError(null);
        setConfirmAction(null);

        try {
            await adminApi.updateUserRole(userId, role);
            showSuccess(t('users.roleUpdated', { role: t(`common:userRole.${role}`) }));
            loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.roleUpdateFailed'));
        } finally {
            setOperating(null);
        }
    };

    const handleResetPassword = async () => {
        if (!resetTarget || newPassword.length < 6) return;
        setOperating(resetTarget.id);
        setError(null);

        try {
            await adminApi.resetPassword(resetTarget.id, newPassword);
            showSuccess(t('users.passwordResetSuccess', { username: resetTarget.username }));
            setResetTarget(null);
            setNewPassword('');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.passwordResetFailed'));
        } finally {
            setOperating(null);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* 顶部工具栏 */}
            <div className="p-4 border-b border-white/10 bg-slate-800/30">
                <div className="flex items-center gap-4 flex-wrap">
                    {/* 搜索框 */}
                    <div className="flex-1 min-w-[200px]">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                            placeholder={t('users.searchPlaceholder')}
                            className="w-full px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {/* 状态筛选 */}
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value as UserStatus | ''); setPage(0); }}
                        className="px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">{t('common:label.allStatus')}</option>
                        <option value="PENDING">{t('common:userStatus.PENDING')}</option>
                        <option value="APPROVED">{t('common:userStatus.APPROVED')}</option>
                        <option value="REJECTED">{t('common:userStatus.REJECTED')}</option>
                    </select>

                    {/* 统计 + 刷新 */}
                    <span className="text-sm text-slate-400">{t('users.totalCount', { count: totalElements })}</span>
                    <button
                        onClick={loadUsers}
                        disabled={loading}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
                    >
                        {loading ? t('common:button.loading') : t('common:button.refresh')}
                    </button>
                </div>
            </div>

            {/* 提示信息 */}
            {error && (
                <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
                </div>
            )}
            {successMsg && (
                <div className="mx-4 mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm">
                    {successMsg}
                </div>
            )}

            {/* 用户列表 */}
            <div className="flex-1 overflow-auto p-4">
                {loading && users.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        <svg className="animate-spin w-8 h-8 mr-2" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {t('common:button.loading')}
                    </div>
                ) : users.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        {t('users.noData')}
                    </div>
                ) : (
                    <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.id')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.username')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.role')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.status')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.createdAt')}</th>
                                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-400">{t('users.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user.id} className="border-b border-white/5 hover:bg-slate-700/30">
                                        <td className="px-4 py-3 text-sm text-slate-300">{user.id}</td>
                                        <td className="px-4 py-3 text-sm text-white font-medium">{user.username}</td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${user.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                                                }`}>
                                                {t(`common:userRole.${user.role}`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-1 rounded text-xs font-medium text-white ${STATUS_COLORS[user.status] || 'bg-gray-500'}`}>
                                                {t(`common:userStatus.${user.status}`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-400">
                                            {new Date(user.createdAt).toLocaleString(i18n.language)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right">
                                            <div className="flex justify-end gap-2">
                                                {/* 审批操作 */}
                                                {user.status === 'PENDING' && (
                                                    <>
                                                        <button
                                                            onClick={() => setConfirmAction({ user, action: 'APPROVE' })}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-emerald-500 text-white text-xs rounded hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {t('users.action.approve')}
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmAction({ user, action: 'REJECT' })}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {t('users.action.reject')}
                                                        </button>
                                                    </>
                                                )}

                                                {/* 已批准用户：角色切换 + 密码重置 */}
                                                {user.status === 'APPROVED' && (
                                                    <>
                                                        <button
                                                            onClick={() => setConfirmAction({
                                                                user,
                                                                action: 'ROLE',
                                                                role: user.role === 'ADMIN' ? 'USER' : 'ADMIN',
                                                            })}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-violet-500 text-white text-xs rounded hover:bg-violet-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {user.role === 'ADMIN' ? t('users.action.demoteToUser') : t('users.action.promoteToAdmin')}
                                                        </button>
                                                        <button
                                                            onClick={() => { setResetTarget(user); setNewPassword(''); }}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {t('users.action.resetPassword')}
                                                        </button>
                                                    </>
                                                )}

                                                {/* 已拒绝用户：可重新批准 */}
                                                {user.status === 'REJECTED' && (
                                                    <button
                                                        onClick={() => setConfirmAction({ user, action: 'APPROVE' })}
                                                        disabled={operating === user.id}
                                                        className="px-3 py-1 bg-emerald-500 text-white text-xs rounded hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                                    >
                                                        {t('users.action.reApprove')}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
                <div className="p-4 border-t border-white/10 bg-slate-800/30 flex items-center justify-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="px-3 py-1.5 bg-slate-700 text-white rounded-lg disabled:opacity-50"
                    >
                        {t('common:button.previousPage')}
                    </button>
                    <span className="text-slate-400">
                        {t('common:label.pageInfo', { current: page + 1, total: totalPages })}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="px-3 py-1.5 bg-slate-700 text-white rounded-lg disabled:opacity-50"
                    >
                        {t('common:button.nextPage')}
                    </button>
                </div>
            )}

            {/* 确认操作弹窗 */}
            {confirmAction && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
                    <div className="bg-slate-800 border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white mb-3">{t('users.confirmDialog.title')}</h3>
                        <p className="text-slate-300 mb-6">
                            {confirmAction.action === 'APPROVE' && t('users.confirmDialog.confirmApprove', { username: confirmAction.user.username })}
                            {confirmAction.action === 'REJECT' && t('users.confirmDialog.confirmReject', { username: confirmAction.user.username })}
                            {confirmAction.action === 'ROLE' && t('users.confirmDialog.confirmRoleChange', { username: confirmAction.user.username, role: t(`common:userRole.${confirmAction.role}` as any) })}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmAction(null)}
                                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                            >
                                {t('common:button.cancel')}
                            </button>
                            <button
                                onClick={() => {
                                    if (confirmAction.action === 'ROLE' && confirmAction.role) {
                                        handleRoleChange(confirmAction.user.id, confirmAction.role);
                                    } else {
                                        handleApprove(confirmAction.user.id, confirmAction.action as 'APPROVE' | 'REJECT');
                                    }
                                }}
                                className={`px-4 py-2 text-white rounded-lg transition-colors ${confirmAction.action === 'REJECT'
                                    ? 'bg-red-500 hover:bg-red-600'
                                    : 'bg-indigo-500 hover:bg-indigo-600'
                                    }`}
                            >
                                {t('common:button.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 密码重置弹窗 */}
            {resetTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setResetTarget(null)}>
                    <div className="bg-slate-800 border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white mb-3">
                            {t('users.resetPasswordDialog.title', { username: resetTarget.username })}
                        </h3>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder={t('users.resetPasswordDialog.placeholder')}
                            className="w-full px-4 py-2 mb-2 bg-slate-700/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            autoFocus
                        />
                        {newPassword.length > 0 && newPassword.length < 6 && (
                            <p className="text-red-400 text-xs mb-4">{t('users.resetPasswordDialog.minLengthError')}</p>
                        )}
                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                onClick={() => setResetTarget(null)}
                                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                            >
                                {t('common:button.cancel')}
                            </button>
                            <button
                                onClick={handleResetPassword}
                                disabled={newPassword.length < 6 || operating === resetTarget.id}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                            >
                                {operating === resetTarget.id ? t('users.resetPasswordDialog.processing') : t('users.resetPasswordDialog.reset')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsersTab;
