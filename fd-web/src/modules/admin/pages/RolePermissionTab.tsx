/**
 * 角色权限管理组件 (管理员专属)
 * 双 Tab 布局：权限总览 + 权限配置
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rbacApi } from '../../../shared/services/serverApi';
import type { SysRole, SysPermission, SysModule, PermissionOverview } from '../../../shared/types/server';

// 角色 code 对应的颜色方案
const ROLE_CODE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    SUPER_ADMIN: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500' },
    ADMIN: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500' },
    USER: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500' },
    AUDITOR: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500' },
};

const DEFAULT_ROLE_COLOR = { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500' };

const getRoleColor = (code: string) => ROLE_CODE_COLORS[code] || DEFAULT_ROLE_COLOR;

// 按模块分组权限
const groupPermissionsByModule = (
    permissions: SysPermission[],
    modules: SysModule[]
): { module: SysModule; permissions: SysPermission[] }[] => {
    const moduleMap = new Map<string, SysModule>();
    modules.forEach(m => moduleMap.set(m.code, m));

    const grouped = new Map<string, SysPermission[]>();
    permissions.forEach(p => {
        const list = grouped.get(p.module) || [];
        list.push(p);
        grouped.set(p.module, list);
    });

    // 按模块 sortOrder 排序
    const result: { module: SysModule; permissions: SysPermission[] }[] = [];
    const sortedModules = [...modules].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const mod of sortedModules) {
        const perms = grouped.get(mod.code);
        if (perms && perms.length > 0) {
            result.push({ module: mod, permissions: perms });
        }
    }

    // 添加未匹配到模块的权限（用虚拟模块包裹）
    grouped.forEach((perms, moduleCode) => {
        if (!moduleMap.has(moduleCode)) {
            result.push({
                module: {
                    id: -1,
                    code: moduleCode,
                    name: moduleCode,
                    sortOrder: 9999,
                    enabled: true,
                    builtIn: false,
                    createdAt: '',
                },
                permissions: perms,
            });
        }
    });

    return result;
};

// 加载指示器（共用）
const LoadingSpinner: React.FC<{ text?: string }> = ({ text }) => (
    <div className="flex items-center justify-center h-full text-slate-400">
        <svg className="animate-spin w-8 h-8 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        {text || '...'}
    </div>
);

// =====================================================================
// 子组件：权限总览面板
// =====================================================================
const PermissionOverviewPanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);

    const [overview, setOverview] = useState<PermissionOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
    const [togglingModuleId, setTogglingModuleId] = useState<number | null>(null);

    const loadOverview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await rbacApi.getPermissionOverview();
            setOverview(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    const toggleCollapse = (moduleCode: string) => {
        setCollapsedModules(prev => {
            const next = new Set(prev);
            if (next.has(moduleCode)) {
                next.delete(moduleCode);
            } else {
                next.add(moduleCode);
            }
            return next;
        });
    };

    const handleToggleModule = async (mod: SysModule) => {
        if (mod.builtIn) return;
        setTogglingModuleId(mod.id);
        try {
            await rbacApi.toggleModule(mod.id, !mod.enabled);
            // 刷新总览数据
            await loadOverview();
        } catch (err) {
            setError(
                t('admin:roles.toggleModuleFailed') +
                ': ' +
                (err instanceof Error ? err.message : String(err))
            );
        } finally {
            setTogglingModuleId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
                <LoadingSpinner text={t('common:button.loading', '...')} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
                </div>
            </div>
        );
    }

    if (!overview) return null;

    const { modules, permissions, roles, matrix, stats } = overview;
    const grouped = groupPermissionsByModule(permissions, modules);
    // 构建快速查找：moduleCode → SysModule
    const moduleByCode = new Map<string, SysModule>();
    modules.forEach(m => moduleByCode.set(m.code, m));

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 统计栏 */}
            <div className="px-4 py-3 border-b border-white/10 bg-slate-800/30">
                <span className="text-sm text-slate-300">
                    {t('admin:roles.overviewStats', {
                        modules: stats.moduleCount,
                        permissions: stats.permissionCount,
                        roles: stats.roleCount,
                    })}
                </span>
            </div>

            {/* 权限矩阵 */}
            <div className="flex-1 overflow-auto p-4">
                <div className="space-y-3">
                    {grouped.map(({ module: mod, permissions: perms }) => {
                        const isCollapsed = collapsedModules.has(mod.code);
                        const realModule = moduleByCode.get(mod.code) || mod;
                        const isToggling = togglingModuleId === realModule.id;

                        return (
                            <div
                                key={mod.code}
                                className="bg-slate-800/30 backdrop-blur border border-white/10 rounded-lg overflow-hidden"
                            >
                                {/* 模块标题栏 */}
                                <div
                                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/20 transition-colors"
                                    onClick={() => toggleCollapse(mod.code)}
                                >
                                    {/* 折叠箭头 */}
                                    <svg
                                        className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>

                                    {/* 模块名称 */}
                                    <span className="text-sm font-medium text-white">
                                        {mod.name}
                                    </span>
                                    <span className="text-xs text-slate-500 font-mono">
                                        ({mod.code})
                                    </span>

                                    {/* 权限计数 */}
                                    <span className="text-xs text-slate-500">
                                        {perms.length} {t('admin:roles.permissionColumn', '权限')}
                                    </span>

                                    {/* 右侧：模块状态徽章 + 切换按钮 */}
                                    <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                        {/* 状态徽章 */}
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            realModule.enabled
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-slate-500/20 text-slate-400'
                                        }`}>
                                            {realModule.enabled
                                                ? t('admin:roles.moduleEnabled', '已启用')
                                                : t('admin:roles.moduleDisabled', '已禁用')
                                            }
                                        </span>

                                        {/* 切换按钮 */}
                                        {realModule.builtIn ? (
                                            <button
                                                disabled
                                                className="px-2 py-1 text-xs rounded bg-slate-700/30 text-slate-600 cursor-not-allowed"
                                                title={t('admin:roles.builtInCannotToggle', '内置模块不可禁用')}
                                            >
                                                {realModule.enabled
                                                    ? t('admin:roles.moduleDisabled', '禁用')
                                                    : t('admin:roles.moduleEnabled', '启用')
                                                }
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleToggleModule(realModule)}
                                                disabled={isToggling}
                                                className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
                                                    realModule.enabled
                                                        ? 'bg-slate-600/30 text-slate-300 hover:bg-slate-600/50'
                                                        : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                                }`}
                                            >
                                                {isToggling ? '...' : (
                                                    realModule.enabled
                                                        ? t('admin:roles.moduleDisabled', '禁用')
                                                        : t('admin:roles.moduleEnabled', '启用')
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* 权限矩阵表格（可折叠） */}
                                {!isCollapsed && (
                                    <div className="border-t border-white/5">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-white/10">
                                                    <th className="text-left py-2 px-3 text-slate-400 font-medium">
                                                        {t('admin:roles.permissionColumn', '权限')}
                                                    </th>
                                                    {roles.map(r => (
                                                        <th key={r.id} className="text-center py-2 px-2 text-slate-400 font-medium min-w-[80px]">
                                                            <span className={`px-1.5 py-0.5 rounded text-xs ${getRoleColor(r.code).bg} ${getRoleColor(r.code).text}`}>
                                                                {r.name}
                                                            </span>
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {perms.map(perm => (
                                                    <tr key={perm.id} className="border-b border-white/5 hover:bg-slate-700/20">
                                                        <td className="py-2 px-3">
                                                            <span className="text-slate-200">{perm.name}</span>
                                                            <span className="text-slate-500 text-xs ml-1">({perm.code})</span>
                                                        </td>
                                                        {roles.map(r => {
                                                            // SUPER_ADMIN 自动拥有所有权限
                                                            const has = r.code === 'SUPER_ADMIN'
                                                                || (matrix[r.code]?.includes(perm.code) ?? false);
                                                            return (
                                                                <td key={r.id} className="text-center py-2 px-2">
                                                                    {has
                                                                        ? <span className="text-emerald-400">&#10003;</span>
                                                                        : <span className="text-slate-600">&mdash;</span>
                                                                    }
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// =====================================================================
// 子组件：权限配置面板（保留原有逻辑）
// =====================================================================
const PermissionConfigPanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);

    // 左侧：角色列表
    const [roles, setRoles] = useState<SysRole[]>([]);
    const [rolesLoading, setRolesLoading] = useState(true);
    const [rolesError, setRolesError] = useState<string | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

    // 右侧：权限配置
    const [allModules, setAllModules] = useState<SysModule[]>([]);
    const [allPermissions, setAllPermissions] = useState<SysPermission[]>([]);
    const [rolePermissionCodes, setRolePermissionCodes] = useState<Set<string>>(new Set());
    const [permLoading, setPermLoading] = useState(false);
    const [permError, setPermError] = useState<string | null>(null);

    // 保存状态
    const [saving, setSaving] = useState(false);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // 折叠状态（key = module code）
    const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

    const selectedRole = roles.find(r => r.id === selectedRoleId) || null;
    const isSuperAdmin = selectedRole?.code === 'SUPER_ADMIN';

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    // 加载角色列表
    const loadRoles = useCallback(async () => {
        setRolesLoading(true);
        setRolesError(null);
        try {
            const data = await rbacApi.getRoles();
            setRoles(data);
        } catch (err) {
            setRolesError(err instanceof Error ? err.message : '加载角色列表失败');
        } finally {
            setRolesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadRoles();
    }, [loadRoles]);

    // 选中角色时加载权限数据
    const loadPermissions = useCallback(async (roleId: number) => {
        setPermLoading(true);
        setPermError(null);
        try {
            const [modules, permissions, rolePerms] = await Promise.all([
                rbacApi.getModules(),
                rbacApi.getPermissions(),
                rbacApi.getRolePermissions(roleId),
            ]);
            setAllModules(modules);
            setAllPermissions(permissions);
            setRolePermissionCodes(new Set(rolePerms));
        } catch (err) {
            setPermError(err instanceof Error ? err.message : '加载权限数据失败');
        } finally {
            setPermLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedRoleId !== null) {
            loadPermissions(selectedRoleId);
        }
    }, [selectedRoleId, loadPermissions]);

    // 切换单个权限
    const togglePermission = (code: string) => {
        if (isSuperAdmin) return;
        setRolePermissionCodes(prev => {
            const next = new Set(prev);
            if (next.has(code)) {
                next.delete(code);
            } else {
                next.add(code);
            }
            return next;
        });
    };

    // 切换整个模块的权限
    const toggleModulePermissions = (modulePerms: SysPermission[]) => {
        if (isSuperAdmin) return;
        const codes = modulePerms.map(p => p.code);
        const allChecked = codes.every(c => rolePermissionCodes.has(c));
        setRolePermissionCodes(prev => {
            const next = new Set(prev);
            if (allChecked) {
                codes.forEach(c => next.delete(c));
            } else {
                codes.forEach(c => next.add(c));
            }
            return next;
        });
    };

    // 切换模块折叠
    const toggleCollapse = (moduleCode: string) => {
        setCollapsedModules(prev => {
            const next = new Set(prev);
            if (next.has(moduleCode)) {
                next.delete(moduleCode);
            } else {
                next.add(moduleCode);
            }
            return next;
        });
    };

    // 保存权限
    const handleSave = async () => {
        if (selectedRoleId === null || isSuperAdmin) return;
        setSaving(true);
        setPermError(null);
        try {
            await rbacApi.setRolePermissions(selectedRoleId, Array.from(rolePermissionCodes));
            showSuccess('权限保存成功');
        } catch (err) {
            setPermError(err instanceof Error ? err.message : '保存权限失败');
        } finally {
            setSaving(false);
        }
    };

    const groupedPermissions = groupPermissionsByModule(allPermissions, allModules);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧：角色列表 */}
            <div className="w-1/3 border-r border-white/10 flex flex-col">
                {/* 角色列表标题栏 */}
                <div className="p-4 border-b border-white/10 bg-slate-800/30">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">
                            {t('roles.roleList', '角色列表')}
                        </h3>
                        <button
                            onClick={loadRoles}
                            disabled={rolesLoading}
                            className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
                        >
                            {rolesLoading ? t('common:button.loading', '加载中...') : t('common:button.refresh', '刷新')}
                        </button>
                    </div>
                </div>

                {/* 角色列表错误 */}
                {rolesError && (
                    <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                        {rolesError}
                    </div>
                )}

                {/* 角色列表内容 */}
                <div className="flex-1 overflow-auto p-2">
                    {rolesLoading && roles.length === 0 ? (
                        <LoadingSpinner text={t('common:button.loading', '...')} />
                    ) : roles.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                            {t('roles.noRoles', '暂无角色数据')}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {roles.map(role => {
                                const color = getRoleColor(role.code);
                                const isSelected = selectedRoleId === role.id;

                                return (
                                    <button
                                        key={role.id}
                                        onClick={() => setSelectedRoleId(role.id)}
                                        className={`w-full text-left p-3 rounded-lg transition-colors border-l-4 ${
                                            isSelected
                                                ? 'bg-slate-700/50 border-l-indigo-500'
                                                : 'bg-slate-800/20 border-l-transparent hover:bg-slate-700/30'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-medium text-white">
                                                {role.name}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${color.bg} ${color.text}`}>
                                                {role.code}
                                            </span>
                                            {role.builtIn && (
                                                <span className="px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400">
                                                    {t('roles.builtIn', '内置')}
                                                </span>
                                            )}
                                        </div>
                                        {role.description && (
                                            <p className="text-xs text-slate-400 line-clamp-2">
                                                {role.description}
                                            </p>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧：权限配置面板 */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedRole === null ? (
                    /* 未选中角色时的空状态 */
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <svg className="w-16 h-16 mx-auto mb-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            <p className="text-slate-400 text-sm">
                                {t('roles.selectRoleHint', '请从左侧选择一个角色来管理其权限')}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* 权限面板标题 */}
                        <div className="p-4 border-b border-white/10 bg-slate-800/30">
                            <div className="flex items-center gap-3">
                                <h3 className="text-sm font-semibold text-white">
                                    {t('roles.permissionConfig', '权限配置')}
                                </h3>
                                <span className="text-slate-400 text-sm">-</span>
                                <span className="text-sm text-white font-medium">{selectedRole.name}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${getRoleColor(selectedRole.code).bg} ${getRoleColor(selectedRole.code).text}`}>
                                    {selectedRole.code}
                                </span>
                            </div>
                        </div>

                        {/* SUPER_ADMIN 提示 */}
                        {isSuperAdmin && (
                            <div className="mx-4 mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm flex items-center gap-2">
                                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {t('roles.superAdminHint', '超级管理员拥有所有权限，无法修改')}
                            </div>
                        )}

                        {/* 权限面板错误 */}
                        {permError && (
                            <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                                {permError}
                            </div>
                        )}

                        {/* 保存成功提示 */}
                        {successMsg && (
                            <div className="mx-4 mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm">
                                {successMsg}
                            </div>
                        )}

                        {/* 权限列表 */}
                        <div className="flex-1 overflow-auto p-4">
                            {permLoading ? (
                                <LoadingSpinner text={t('common:button.loading', '...')} />
                            ) : groupedPermissions.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                    {t('roles.noPermissions', '暂无权限数据')}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {groupedPermissions.map(({ module: mod, permissions: perms }) => {
                                        const isCollapsed = collapsedModules.has(mod.code);
                                        const allChecked = isSuperAdmin || perms.every(p => rolePermissionCodes.has(p.code));
                                        const someChecked = !allChecked && perms.some(p => rolePermissionCodes.has(p.code));

                                        return (
                                            <div
                                                key={mod.code}
                                                className="bg-slate-800/30 backdrop-blur border border-white/10 rounded-lg overflow-hidden"
                                            >
                                                {/* 模块标题栏 */}
                                                <div
                                                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/20 transition-colors"
                                                    onClick={() => toggleCollapse(mod.code)}
                                                >
                                                    {/* 折叠箭头 */}
                                                    <svg
                                                        className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                        stroke="currentColor"
                                                        strokeWidth={2}
                                                    >
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                    </svg>

                                                    {/* 模块全选 checkbox */}
                                                    <input
                                                        type="checkbox"
                                                        checked={allChecked}
                                                        ref={(el) => {
                                                            if (el) el.indeterminate = someChecked;
                                                        }}
                                                        disabled={isSuperAdmin}
                                                        onChange={(e) => {
                                                            e.stopPropagation();
                                                            toggleModulePermissions(perms);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="w-4 h-4 rounded border-white/20 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                                                    />

                                                    {/* 模块名称 */}
                                                    <span className="text-sm font-medium text-white">
                                                        {mod.name}
                                                    </span>
                                                    <span className="text-xs text-slate-500 font-mono">
                                                        ({mod.code})
                                                    </span>

                                                    {/* 权限计数 */}
                                                    <span className="ml-auto text-xs text-slate-500">
                                                        {isSuperAdmin
                                                            ? `${perms.length}/${perms.length}`
                                                            : `${perms.filter(p => rolePermissionCodes.has(p.code)).length}/${perms.length}`
                                                        }
                                                    </span>
                                                </div>

                                                {/* 权限列表（可折叠） */}
                                                {!isCollapsed && (
                                                    <div className="border-t border-white/5 px-4 py-2">
                                                        {perms.map(perm => (
                                                            <label
                                                                key={perm.id}
                                                                className={`flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-700/20 transition-colors ${
                                                                    isSuperAdmin ? 'cursor-not-allowed' : 'cursor-pointer'
                                                                }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSuperAdmin || rolePermissionCodes.has(perm.code)}
                                                                    disabled={isSuperAdmin}
                                                                    onChange={() => togglePermission(perm.code)}
                                                                    className="w-4 h-4 rounded border-white/20 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                                                                />
                                                                <span className="text-sm text-slate-200">
                                                                    {perm.name}
                                                                </span>
                                                                <span className="text-xs text-slate-500 font-mono">
                                                                    {perm.code}
                                                                </span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* 底部保存按钮 */}
                        {!isSuperAdmin && selectedRole && !permLoading && (
                            <div className="p-4 border-t border-white/10 bg-slate-800/30">
                                <div className="flex items-center justify-end gap-3">
                                    <span className="text-xs text-slate-500">
                                        {t('roles.selectedCount', '已选 {{count}} 项权限').replace('{{count}}', String(rolePermissionCodes.size))}
                                    </span>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-6 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && (
                                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                        )}
                                        {saving
                                            ? t('common:button.saving', '保存中...')
                                            : t('common:button.save', '保存')
                                        }
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

// =====================================================================
// 主组件：双 Tab 布局
// =====================================================================
type TabKey = 'overview' | 'config';

const RolePermissionTab: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [activeTab, setActiveTab] = useState<TabKey>('overview');

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* 顶部 Tab 切换 */}
            <div className="flex border-b border-white/10 bg-slate-800/30">
                <button
                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                        activeTab === 'overview'
                            ? 'text-indigo-400 border-b-2 border-indigo-400'
                            : 'text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setActiveTab('overview')}
                >
                    {t('admin:roles.overview', '权限总览')}
                </button>
                <button
                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                        activeTab === 'config'
                            ? 'text-indigo-400 border-b-2 border-indigo-400'
                            : 'text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setActiveTab('config')}
                >
                    {t('admin:roles.permConfig', '权限配置')}
                </button>
            </div>

            {/* Tab 内容区 */}
            <div className="flex-1 flex overflow-hidden">
                {activeTab === 'overview' ? (
                    <PermissionOverviewPanel />
                ) : (
                    <PermissionConfigPanel />
                )}
            </div>
        </div>
    );
};

export default RolePermissionTab;
