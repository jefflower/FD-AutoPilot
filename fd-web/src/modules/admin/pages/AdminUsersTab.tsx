/**
 * 用户管理组件 (管理员专属)
 * 支持多角色分配、权限查看
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, rbacApi, orgSyncApi } from '../../../shared/services/serverApi';
import type { User, UserStatus, UserQueryParams, UserRole, SysRole, SysDepartment } from '../../../shared/types/server';

const STATUS_COLORS: Record<UserStatus, string> = {
    PENDING: 'bg-yellow-500',
    APPROVED: 'bg-green-500',
    REJECTED: 'bg-red-500',
};

/** 角色 badge 颜色映射 */
const ROLE_BADGE_COLORS: Record<string, string> = {
    SUPER_ADMIN: 'bg-red-500/20 text-red-400',
    ADMIN: 'bg-purple-500/20 text-purple-400',
    USER: 'bg-blue-500/20 text-blue-400',
    AUDITOR: 'bg-green-500/20 text-green-400',
};

/** 获取角色 badge 颜色，未知角色使用灰色 */
const getRoleBadgeColor = (role: string): string => {
    return ROLE_BADGE_COLORS[role] || 'bg-slate-500/20 text-slate-400';
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
    const [sourceFilter, setSourceFilter] = useState<'' | 'local' | 'dingtalk' | 'wecom'>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    // 部门映射（id → name）
    const [deptMap, setDeptMap] = useState<Record<number, string>>({});

    // 密码重置弹窗
    const [resetTarget, setResetTarget] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');

    // 确认操作弹窗（审批确认）
    const [confirmAction, setConfirmAction] = useState<{
        user: User;
        action: 'APPROVE' | 'REJECT';
    } | null>(null);

    // 角色管理弹窗
    const [roleModalUser, setRoleModalUser] = useState<User | null>(null);
    const [allRoles, setAllRoles] = useState<SysRole[]>([]);
    const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);
    const [roleModalLoading, setRoleModalLoading] = useState(false);
    const [roleModalSaving, setRoleModalSaving] = useState(false);

    // 权限查看弹窗
    const [permModalUser, setPermModalUser] = useState<User | null>(null);
    const [userPermissions, setUserPermissions] = useState<string[]>([]);
    const [permModalLoading, setPermModalLoading] = useState(false);

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

    // 加载部门列表（用于显示部门名称）
    useEffect(() => {
        orgSyncApi.getDepartments()
            .then((depts: SysDepartment[]) => {
                const map: Record<number, string> = {};
                depts.forEach(d => { map[d.id] = d.name; });
                setDeptMap(map);
            })
            .catch(() => {}); // 部门列表加载失败不阻断页面
    }, []);

    /** 获取用户来源标识 */
    const getUserSource = (user: User): 'local' | 'dingtalk' | 'wecom' => {
        if (user.dingtalkUserId) return 'dingtalk';
        if (user.wecomUserId) return 'wecom';
        return 'local';
    };

    /** 来源 badge 颜色 */
    const SOURCE_BADGE: Record<string, string> = {
        local: 'bg-slate-500/20 text-slate-400',
        dingtalk: 'bg-blue-500/20 text-blue-400',
        wecom: 'bg-green-500/20 text-green-400',
    };

    /** 按来源过滤后的用户列表 */
    const filteredUsers = sourceFilter
        ? users.filter(u => getUserSource(u) === sourceFilter)
        : users;

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

    // ---- 角色管理弹窗逻辑 ----

    const openRoleModal = async (user: User) => {
        setRoleModalUser(user);
        setRoleModalLoading(true);
        setSelectedRoleCodes([]);
        setAllRoles([]);

        try {
            const [roles, userRoles] = await Promise.all([
                rbacApi.getRoles(),
                adminApi.getUserRoles(user.id),
            ]);
            setAllRoles(roles);
            setSelectedRoleCodes(userRoles);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.roleManage.loadFailed'));
        } finally {
            setRoleModalLoading(false);
        }
    };

    const toggleRoleSelection = (code: string) => {
        setSelectedRoleCodes(prev =>
            prev.includes(code)
                ? prev.filter(c => c !== code)
                : [...prev, code]
        );
    };

    const handleSaveRoles = async () => {
        if (!roleModalUser || selectedRoleCodes.length === 0) return;
        setRoleModalSaving(true);
        setError(null);

        try {
            await adminApi.setUserRoles(roleModalUser.id, selectedRoleCodes);
            showSuccess(t('users.roleManage.saveSuccess', { username: roleModalUser.username }));
            setRoleModalUser(null);
            loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.roleUpdateFailed'));
        } finally {
            setRoleModalSaving(false);
        }
    };

    // ---- 权限查看弹窗逻辑 ----

    const openPermModal = async (user: User) => {
        setPermModalUser(user);
        setPermModalLoading(true);
        setUserPermissions([]);

        try {
            const perms = await adminApi.getUserPermissions(user.id);
            setUserPermissions(perms);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('users.permView.loadFailed'));
        } finally {
            setPermModalLoading(false);
        }
    };

    /** 获取用户的角色列表（优先 roles 数组，fallback 到 [role]） */
    const getUserRoles = (user: User): UserRole[] => {
        if (user.roles && user.roles.length > 0) return user.roles;
        return [user.role];
    };

    /** 按模块前缀分组权限 */
    const groupPermissionsByModule = (perms: string[]): Record<string, string[]> => {
        const groups: Record<string, string[]> = {};
        for (const perm of perms) {
            // 权限格式通常为 "module:action" 或 "module.action"
            const sepIdx = perm.indexOf(':');
            const dotIdx = perm.indexOf('.');
            const idx = sepIdx >= 0 ? sepIdx : dotIdx;
            const module = idx >= 0 ? perm.substring(0, idx) : 'other';
            if (!groups[module]) groups[module] = [];
            groups[module].push(perm);
        }
        return groups;
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

                    {/* 来源筛选 */}
                    <select
                        value={sourceFilter}
                        onChange={(e) => { setSourceFilter(e.target.value as '' | 'local' | 'dingtalk' | 'wecom'); }}
                        className="px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">{t('users.filter.allSources')}</option>
                        <option value="local">{t('users.source.local')}</option>
                        <option value="dingtalk">{t('users.source.dingtalk')}</option>
                        <option value="wecom">{t('users.source.wecom')}</option>
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
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.department')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.source')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.role')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.status')}</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">{t('users.table.createdAt')}</th>
                                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-400">{t('users.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map(user => {
                                    const source = getUserSource(user);
                                    return (
                                    <tr key={user.id} className="border-b border-white/5 hover:bg-slate-700/30">
                                        <td className="px-4 py-3 text-sm text-slate-300">{user.id}</td>
                                        <td className="px-4 py-3 text-sm">
                                            <div className="flex items-center gap-2.5">
                                                {/* 头像 */}
                                                {user.avatar ? (
                                                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white font-medium flex-shrink-0">
                                                        {(user.displayName || user.username).charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="text-white font-medium truncate">{user.displayName || user.username}</div>
                                                    {user.displayName && user.displayName !== user.username && (
                                                        <div className="text-xs text-slate-500 truncate">{user.username}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-400">
                                            {user.departmentId && deptMap[user.departmentId]
                                                ? deptMap[user.departmentId]
                                                : t('users.noDepartment')}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_BADGE[source]}`}>
                                                {t(`users.source.${source}` as any)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <div className="flex flex-wrap gap-1">
                                                {getUserRoles(user).map(role => (
                                                    <span
                                                        key={role}
                                                        className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeColor(role)}`}
                                                    >
                                                        {t(`common:userRole.${role}` as any)}
                                                    </span>
                                                ))}
                                            </div>
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

                                                {/* 已批准用户：管理角色 + 查看权限 + 密码重置 */}
                                                {user.status === 'APPROVED' && (
                                                    <>
                                                        <button
                                                            onClick={() => openRoleModal(user)}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-violet-500 text-white text-xs rounded hover:bg-violet-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {t('users.action.manageRoles')}
                                                        </button>
                                                        <button
                                                            onClick={() => openPermModal(user)}
                                                            disabled={operating === user.id}
                                                            className="px-3 py-1 bg-cyan-500 text-white text-xs rounded hover:bg-cyan-600 transition-colors disabled:opacity-50"
                                                        >
                                                            {t('users.action.viewPermissions')}
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
                                    );
                                })}
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

            {/* 确认操作弹窗（审批确认） */}
            {confirmAction && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
                    <div className="bg-slate-800 border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white mb-3">{t('users.confirmDialog.title')}</h3>
                        <p className="text-slate-300 mb-6">
                            {confirmAction.action === 'APPROVE' && t('users.confirmDialog.confirmApprove', { username: confirmAction.user.username })}
                            {confirmAction.action === 'REJECT' && t('users.confirmDialog.confirmReject', { username: confirmAction.user.username })}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmAction(null)}
                                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                            >
                                {t('common:button.cancel')}
                            </button>
                            <button
                                onClick={() => handleApprove(confirmAction.user.id, confirmAction.action)}
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

            {/* 角色管理弹窗 */}
            {roleModalUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRoleModalUser(null)}>
                    <div className="bg-slate-800 border border-white/10 rounded-xl p-6 w-[480px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white mb-4">
                            {t('users.roleManage.title', { username: roleModalUser.username })}
                        </h3>

                        {roleModalLoading ? (
                            <div className="flex items-center justify-center py-8 text-slate-400">
                                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                {t('common:button.loading')}
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 overflow-auto space-y-2 mb-4">
                                    {allRoles.map(role => {
                                        const isSelected = selectedRoleCodes.includes(role.code);
                                        return (
                                            <label
                                                key={role.id}
                                                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                                                    isSelected
                                                        ? 'bg-indigo-500/10 border border-indigo-500/30'
                                                        : 'bg-slate-700/30 border border-white/5 hover:bg-slate-700/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleRoleSelection(role.code)}
                                                    className="mt-1 w-4 h-4 rounded border-white/20 bg-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeColor(role.code)}`}>
                                                            {role.name}
                                                        </span>
                                                        {role.builtIn && (
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/20 text-slate-400">
                                                                {t('users.roleManage.builtIn')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {role.description && (
                                                        <p className="text-xs text-slate-500 mt-1 truncate">{role.description}</p>
                                                    )}
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>

                                {selectedRoleCodes.length === 0 && (
                                    <p className="text-xs text-amber-400 mb-3">{t('users.roleManage.atLeastOne')}</p>
                                )}

                                <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
                                    <button
                                        onClick={() => setRoleModalUser(null)}
                                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                                    >
                                        {t('common:button.cancel')}
                                    </button>
                                    <button
                                        onClick={handleSaveRoles}
                                        disabled={selectedRoleCodes.length === 0 || roleModalSaving}
                                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
                                    >
                                        {roleModalSaving ? t('common:button.saving') : t('common:button.confirm')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* 权限查看弹窗 */}
            {permModalUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPermModalUser(null)}>
                    <div className="bg-slate-800 border border-white/10 rounded-xl p-6 w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white mb-4">
                            {t('users.permView.title', { username: permModalUser.username })}
                        </h3>

                        {permModalLoading ? (
                            <div className="flex items-center justify-center py-8 text-slate-400">
                                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                {t('common:button.loading')}
                            </div>
                        ) : userPermissions.length === 0 ? (
                            <div className="py-8 text-center text-slate-500">
                                {t('users.permView.noPermissions')}
                            </div>
                        ) : (
                            <div className="flex-1 overflow-auto space-y-4 mb-4">
                                {Object.entries(groupPermissionsByModule(userPermissions)).map(([module, perms]) => (
                                    <div key={module}>
                                        <h4 className="text-xs font-medium text-slate-400 uppercase mb-2 tracking-wider">
                                            {module}
                                        </h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {perms.map(perm => (
                                                <span
                                                    key={perm}
                                                    className="px-2 py-1 rounded text-xs font-medium bg-slate-600/40 text-slate-300"
                                                >
                                                    {perm}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end pt-3 border-t border-white/10">
                            <button
                                onClick={() => setPermModalUser(null)}
                                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                            >
                                {t('common:button.close')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsersTab;
