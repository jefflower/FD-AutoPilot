/**
 * 路由模块公开导出
 *
 * 当前应用使用 Tab-based 路由模式。此文件导出路由配置和守卫组件。
 * 如未来迁移到 React Router，可在此文件扩展完整的路由树定义。
 */

export { routes } from './routes';
export type { RouteConfig } from './routes';
export { AuthGuard, PermissionGuard } from './guards';
