/**
 * 角色权限管理组件 (管理员专属)
 * 双 Tab 布局：权限总览 + 权限配置
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rbacApi } from '../../../shared/services/serverApi';
import type { SysRole, SysPermission, SysModule, PermissionOverview } from '../../../shared/types/server';

// 权限类型颜色映射
const PERMISSION_TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ROUTE: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: '路由' },
  OPERATION: { bg: 'bg-green-500/20', text: 'text-green-400', label: '操作' },
  DATA: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: '数据' },
};

const getPermissionTypeColor = (type?: string) => {
  if (!type) return { bg: 'bg-slate-500/20', text: 'text-slate-400', label: '未分类' };
  return PERMISSION_TYPE_COLORS[type] || { bg: 'bg-slate-500/20', text: 'text-slate-400', label: '未分类' };
};

// 角色 code 对应的颜色方案
const ROLE_CODE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    SUPER_ADMIN: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500' },
    ADMIN: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500' },
    USER: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500' },
    AUDITOR: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500' },
};

const DEFAULT_ROLE_COLOR = { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500' };

const getRoleColor = (code: string) => ROLE_CODE_COLORS[code] || DEFAULT_ROLE_COLOR;

// 权限类型排序权重（ROUTE 在前、OPERATION 居中、DATA 在后、无类型排最后）
const PERMISSION_TYPE_ORDER: Record<string, number> = {
  ROUTE: 0,
  OPERATION: 1,
  DATA: 2,
};
const getTypeOrder = (type?: string): number =>
  type ? (PERMISSION_TYPE_ORDER[type] ?? 3) : 4;

// 按模块分组权限（每组内按 type 排序）
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
            // 模块内按 type 排序
            const sorted = [...perms].sort((a, b) => getTypeOrder(a.type) - getTypeOrder(b.type));
            result.push({ module: mod, permissions: sorted });
        }
    }

    // 添加未匹配到模块的权限（用虚拟模块包裹）
    grouped.forEach((perms, moduleCode) => {
        if (!moduleMap.has(moduleCode)) {
            const sorted = [...perms].sort((a, b) => getTypeOrder(a.type) - getTypeOrder(b.type));
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
                permissions: sorted,
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
// 弹窗：新增/编辑权限
// =====================================================================
interface PermissionDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  permission?: SysPermission;
  modules: SysModule[];
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  isLoading?: boolean;
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({
  isOpen,
  mode,
  permission,
  modules,
  onClose,
  onSubmit,
  isLoading = false,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    module: string;
    description: string;
    type: 'ROUTE' | 'OPERATION' | 'DATA';
  }>({
    code: permission?.code || '',
    name: permission?.name || '',
    module: permission?.module || '',
    description: permission?.description || '',
    type: (permission?.type as 'ROUTE' | 'OPERATION' | 'DATA') || 'OPERATION',
  });

  useEffect(() => {
    if (permission && mode === 'edit') {
      setFormData({
        code: permission.code,
        name: permission.name || '',
        module: permission.module,
        description: permission.description || '',
        type: (permission.type as 'ROUTE' | 'OPERATION' | 'DATA') || 'OPERATION',
      });
    } else if (!isOpen) {
      setFormData({
        code: '',
        name: '',
        module: '',
        description: '',
        type: 'OPERATION',
      });
    }
  }, [isOpen, permission, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.module.trim() || (mode === 'create' && !formData.code.trim())) {
      alert(t('common:messages.fillRequired', '请填写所有必填字段'));
      return;
    }

    try {
      if (mode === 'create') {
        await onSubmit(formData);
      } else {
        // 内置权限仅允许修改 name 和 description
        const updateData: { name: string; description: string; type?: string } = {
          name: formData.name,
          description: formData.description,
        };
        if (!isBuiltIn) {
          updateData.type = formData.type;
        }
        await onSubmit(updateData);
      }
      onClose();
    } catch (err) {
      // Error handled by parent
    }
  };

  if (!isOpen) return null;

  const isBuiltIn = mode === 'edit' && permission?.builtIn;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-white/10 rounded-lg max-w-md w-full shadow-lg">
          {/* Header */}
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              {mode === 'create' ? t('admin:roles.createPermission', '新增权限') : t('admin:roles.editPermission', '编辑权限')}
            </h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* 权限代码（新增模式）*/}
            {mode === 'create' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  {t('admin:roles.permissionCode', '权限代码')} *
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="如: ticket:view, ticket:edit"
                  className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  disabled={isLoading}
                />
              </div>
            )}

            {/* 权限名称 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {t('admin:roles.permissionName', '权限名称')} *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="如: 查看工单, 编辑工单"
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                disabled={isLoading}
              />
            </div>

            {/* 所属模块 */}
            {mode === 'create' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  {t('admin:roles.module', '所属模块')} *
                </label>
                <select
                  value={formData.module}
                  onChange={(e) => setFormData({ ...formData, module: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                  disabled={isLoading}
                >
                  <option value="">请选择模块</option>
                  {modules.map((mod) => (
                    <option key={mod.id} value={mod.code}>
                      {mod.name} ({mod.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 编辑模式下显示所属模块（只读） */}
            {mode === 'edit' && permission && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  {t('admin:roles.module', '所属模块')} ({t('admin:roles.readonly', '只读')})
                </label>
                <input
                  type="text"
                  value={permission.module}
                  disabled
                  className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-slate-400 cursor-not-allowed"
                />
              </div>
            )}

            {/* 权限类型 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {t('admin:roles.permissionType', '权限类型')} {isBuiltIn && `(${t('admin:roles.readonly', '只读')})`}
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as 'ROUTE' | 'OPERATION' | 'DATA' })}
                disabled={isBuiltIn || isLoading}
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                <option value="ROUTE">{t('admin:roles.typeRoute', '路由')}</option>
                <option value="OPERATION">{t('admin:roles.typeOperation', '操作')}</option>
                <option value="DATA">{t('admin:roles.typeData', '数据')}</option>
              </select>
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {t('admin:roles.description', '描述')}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="权限功能描述"
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                disabled={isLoading}
              />
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {t('common:button.cancel', '取消')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading && (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {isLoading ? t('common:button.saving', '保存中...') : t('common:button.save', '保存')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// =====================================================================
// 子组件：权限总览面板
// =====================================================================
const PermissionOverviewPanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);

    const [overview, setOverview] = useState<PermissionOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
    const [togglingModuleId, setTogglingModuleId] = useState<number | null>(null);

    // 权限管理弹窗
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
    const [editingPermission, setEditingPermission] = useState<SysPermission | null>(null);
    const [dialogLoading, setDialogLoading] = useState(false);

    // 权限类型筛选
    const [typeFilter, setTypeFilter] = useState<string | null>(null);

    const showSuccess = (msg: string) => {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 3000);
    };

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

    const handleCreatePermission = () => {
      setDialogMode('create');
      setEditingPermission(null);
      setDialogOpen(true);
    };

    const handleEditPermission = (permission: SysPermission) => {
      setDialogMode('edit');
      setEditingPermission(permission);
      setDialogOpen(true);
    };

    const handleDeletePermission = async (permission: SysPermission) => {
      if (permission.builtIn) {
        setError(t('admin:roles.cannotDeleteBuiltIn', '内置权限无法删除'));
        return;
      }

      if (!confirm(t('admin:roles.confirmDeletePermission', '确认删除该权限？'))) {
        return;
      }

      try {
        await rbacApi.deletePermission(permission.id);
        showSuccess(t('admin:roles.deleteSuccess', '权限删除成功'));
        await loadOverview();
      } catch (err) {
        setError(
          t('admin:roles.deleteFailed', '删除权限失败') +
          ': ' +
          (err instanceof Error ? err.message : String(err))
        );
      }
    };

    const handleDialogSubmit = async (data: any) => {
      setDialogLoading(true);
      try {
        if (dialogMode === 'create') {
          await rbacApi.createPermission(data);
          showSuccess(t('admin:roles.createSuccess', '权限创建成功'));
        } else if (editingPermission) {
          await rbacApi.updatePermission(editingPermission.id, data);
          showSuccess(t('admin:roles.updateSuccess', '权限更新成功'));
        }
        await loadOverview();
      } catch (err) {
        setError(
          (dialogMode === 'create' ? t('admin:roles.createFailed', '创建权限失败') : t('admin:roles.updateFailed', '更新权限失败')) +
          ': ' +
          (err instanceof Error ? err.message : String(err))
        );
      } finally {
        setDialogLoading(false);
      }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
                <LoadingSpinner text={t('common:button.loading', '...')} />
            </div>
        );
    }

    if (!overview && error) {
        return (
            <div className="p-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button
                      onClick={() => { setError(null); loadOverview(); }}
                      className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 rounded transition-colors"
                    >
                      {t('common:button.retry', '重试')}
                    </button>
                </div>
            </div>
        );
    }

    if (!overview) return null;

    const { modules, permissions, roles, matrix, stats } = overview;
    let filteredPermissions = permissions;
    if (typeFilter === 'UNCATEGORIZED') {
      filteredPermissions = permissions.filter(p => !p.type);
    } else if (typeFilter) {
      filteredPermissions = permissions.filter(p => p.type === typeFilter);
    }

    const grouped = groupPermissionsByModule(filteredPermissions, modules);
    const moduleByCode = new Map<string, SysModule>();
    modules.forEach(m => moduleByCode.set(m.code, m));

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 统计栏 + 操作栏 */}
            <div className="px-4 py-3 border-b border-white/10 bg-slate-800/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">
                    {t('admin:roles.overviewStats', {
                        modules: stats.moduleCount,
                        permissions: stats.permissionCount,
                        roles: stats.roleCount,
                    })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreatePermission}
                    className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('admin:roles.createPermission', '新增权限')}
                  </button>
                  <button
                    onClick={loadOverview}
                    className="px-3 py-1.5 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                  >
                    {t('common:button.refresh', '刷新')}
                  </button>
                </div>
              </div>

              {/* 类型筛选 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{t('admin:roles.filterByType', '按类型筛选')}:</span>
                <button
                  onClick={() => setTypeFilter(null)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    typeFilter === null
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
                  }`}
                >
                  {t('common:button.all', '全部')}
                </button>
                {Object.entries(PERMISSION_TYPE_COLORS).map(([type, { bg, text, label }]) => (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                      typeFilter === type
                        ? `${bg} ${text}`
                        : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {/* 未分类筛选 */}
                <button
                  onClick={() => setTypeFilter(typeFilter === 'UNCATEGORIZED' ? null : 'UNCATEGORIZED')}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    typeFilter === 'UNCATEGORIZED'
                      ? 'bg-slate-500/20 text-slate-400'
                      : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
                  }`}
                >
                  {t('admin:roles.uncategorized', '未分类')}
                </button>
              </div>

              {/* 错误提示（非阻塞） */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 text-red-400 text-xs flex items-center justify-between">
                  <span>{error}</span>
                  <button
                    onClick={() => setError(null)}
                    className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 rounded transition-colors"
                  >
                    {t('common:button.dismiss', '关闭')}
                  </button>
                </div>
              )}

              {/* 成功提示 */}
              {successMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-emerald-400 text-xs flex items-center justify-between">
                  <span>{successMsg}</span>
                  <button
                    onClick={() => setSuccessMsg(null)}
                    className="text-xs px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 rounded transition-colors"
                  >
                    {t('common:button.dismiss', '关闭')}
                  </button>
                </div>
              )}
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
                                                    <th className="text-left py-2 px-3 text-slate-400 font-medium w-24">
                                                        {t('admin:roles.type', '类型')}
                                                    </th>
                                                    <th className="text-left py-2 px-3 text-slate-400 font-medium w-16">
                                                        {t('admin:roles.actions', '操作')}
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
                                                {perms.map(perm => {
                                                    const typeColor = getPermissionTypeColor(perm.type);
                                                    return (
                                                    <tr key={perm.id} className="border-b border-white/5 hover:bg-slate-700/20">
                                                        <td className="py-2 px-3">
                                                            <div className="flex items-center gap-2">
                                                              {perm.builtIn && (
                                                                <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                                                                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                                                                </svg>
                                                              )}
                                                              <span className="text-slate-200">{perm.name}</span>
                                                              <span className="text-slate-500 text-xs font-mono">({perm.code})</span>
                                                            </div>
                                                        </td>
                                                        <td className="py-2 px-3">
                                                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor.bg} ${typeColor.text}`}>
                                                            {typeColor.label}
                                                          </span>
                                                        </td>
                                                        <td className="py-2 px-3">
                                                          <div className="flex items-center gap-1">
                                                            <button
                                                              onClick={() => handleEditPermission(perm)}
                                                              className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
                                                              title={t('common:button.edit', '编辑')}
                                                            >
                                                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                              </svg>
                                                            </button>
                                                            {!perm.builtIn && (
                                                              <button
                                                                onClick={() => handleDeletePermission(perm)}
                                                                className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                                                                title={t('common:button.delete', '删除')}
                                                              >
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                              </button>
                                                            )}
                                                          </div>
                                                        </td>
                                                        {roles.map(r => {
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
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 权限管理弹窗 */}
            <PermissionDialog
              isOpen={dialogOpen}
              mode={dialogMode}
              permission={editingPermission || undefined}
              modules={modules}
              onClose={() => {
                setDialogOpen(false);
                setEditingPermission(null);
              }}
              onSubmit={handleDialogSubmit}
              isLoading={dialogLoading}
            />
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

                                        // 按权限类型分组
                                        const permsByType = new Map<string, SysPermission[]>();
                                        const typeOrder = ['ROUTE', 'OPERATION', 'DATA', undefined];
                                        perms.forEach(p => {
                                            const type = p.type || 'UNCATEGORIZED';
                                            const list = permsByType.get(type) || [];
                                            list.push(p);
                                            permsByType.set(type, list);
                                        });

                                        const sortedTypes = typeOrder.filter(t => permsByType.has(t || 'UNCATEGORIZED'));

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

                                                {/* 权限列表按类型分组（可折叠） */}
                                                {!isCollapsed && (
                                                    <div className="border-t border-white/5">
                                                        {sortedTypes.map((type) => {
                                                            const typePerms = permsByType.get(type || 'UNCATEGORIZED') || [];
                                                            const typeColor = getPermissionTypeColor(type);
                                                            return (
                                                                <div key={type || 'UNCATEGORIZED'}>
                                                                    {/* 权限类型小标题 */}
                                                                    <div className="px-4 py-2 bg-slate-700/20 border-b border-white/5">
                                                                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeColor.bg} ${typeColor.text}`}>
                                                                            {typeColor.label} ({typePerms.length})
                                                                        </span>
                                                                    </div>

                                                                    {/* 权限项目 */}
                                                                    <div className="px-4 py-2">
                                                                        {typePerms.map(perm => (
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
                                                                </div>
                                                            );
                                                        })}
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
