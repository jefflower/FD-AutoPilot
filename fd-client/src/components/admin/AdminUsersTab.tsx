/**
 * 用户管理组件 (管理员专属)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../../services/serverApi';
import type { User, UserStatus, UserQueryParams } from '../../types/server';

const STATUS_LABELS: Record<UserStatus, { label: string; color: string }> = {
    PENDING: { label: '待审核', color: 'bg-yellow-500' },
    APPROVED: { label: '已批准', color: 'bg-green-500' },
    REJECTED: { label: '已拒绝', color: 'bg-red-500' },
};

const AdminUsersTab: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [operating, setOperating] = useState<number | null>(null);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const params: UserQueryParams = {
                page,
                size: 20,
            };
            if (statusFilter) params.status = statusFilter;
            if (searchQuery.trim()) params.username = searchQuery.trim();

            const result = await adminApi.getAllUsers(params);
            setUsers(result.content);
            setTotalPages(result.totalPages);
        } catch (err) {
            // 如果 getAllUsers 失败，尝试使用 getPendingUsers
            if (statusFilter === 'PENDING' || !statusFilter) {
                try {
                    const pendingUsers = await adminApi.getPendingUsers();
                    setUsers(pendingUsers);
                    setTotalPages(1);
                } catch (innerErr) {
                    setError(innerErr instanceof Error ? innerErr.message : '加载失败');
                }
            } else {
                setError(err instanceof Error ? err.message : '加载失败');
            }
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, searchQuery]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleApprove = async (userId: number, action: 'APPROVE' | 'REJECT') => {
        setOperating(userId);
        setError(null);

        try {
            await adminApi.approveUser(userId, action);
            loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : '操作失败');
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
                            placeholder="搜索用户名..."
                            className="w-full px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {/* 状态筛选 */}
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value as UserStatus | ''); setPage(0); }}
                        className="px-4 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">全部状态</option>
                        <option value="PENDING">待审核</option>
                        <option value="APPROVED">已批准</option>
                        <option value="REJECTED">已拒绝</option>
                    </select>

                    {/* 刷新按钮 */}
                    <button
                        onClick={loadUsers}
                        disabled={loading}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
                    >
                        {loading ? '加载中...' : '刷新'}
                    </button>
                </div>
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
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
                        加载中...
                    </div>
                ) : users.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        暂无用户数据
                    </div>
                ) : (
                    <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ID</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">用户名</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">角色</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">状态</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">创建时间</th>
                                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-400">操作</th>
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
                                                {user.role === 'ADMIN' ? '管理员' : '用户'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-1 rounded text-xs font-medium text-white ${STATUS_LABELS[user.status].color}`}>
                                                {STATUS_LABELS[user.status].label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-400">
                                            {new Date(user.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right">
                                            {user.status === 'PENDING' && (
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => handleApprove(user.id, 'APPROVE')}
                                                        disabled={operating === user.id}
                                                        className="px-3 py-1 bg-emerald-500 text-white text-xs rounded hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                                    >
                                                        批准
                                                    </button>
                                                    <button
                                                        onClick={() => handleApprove(user.id, 'REJECT')}
                                                        disabled={operating === user.id}
                                                        className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors disabled:opacity-50"
                                                    >
                                                        拒绝
                                                    </button>
                                                </div>
                                            )}
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
                        上一页
                    </button>
                    <span className="text-slate-400">
                        {page + 1} / {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="px-3 py-1.5 bg-slate-700 text-white rounded-lg disabled:opacity-50"
                    >
                        下一页
                    </button>
                </div>
            )}
        </div>
    );
};

export default AdminUsersTab;
