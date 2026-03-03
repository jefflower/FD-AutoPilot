/**
 * 测试渲染工具
 *
 * 封装 @testing-library/react 的 render，自动包裹常用 Provider。
 */
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * 带 Provider 的 render 封装
 *
 * 当前 i18n 已在 setup.ts 中全局 mock，此函数主要用于未来扩展
 * （如需要包裹 Context Provider 时）。
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { ...options });
}

export { render };
