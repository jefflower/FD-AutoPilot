/**
 * Tauri API Mock 工具
 *
 * 在 jsdom 测试环境中模拟 @tauri-apps/api/core 和 @tauri-apps/api/event。
 * 使用方式：
 *   mockInvokeResult('load_settings_cmd', { mq_host: 'localhost' });
 *   clearInvokeMocks();
 */
import { vi } from 'vitest';

// ============ invoke mock ============

const invokeResults = new Map<string, unknown>();

/**
 * 设置 invoke 特定命令的返回值
 */
export function mockInvokeResult(command: string, result: unknown) {
  invokeResults.set(command, result);
}

/**
 * 清除所有 invoke mock 返回值
 */
export function clearInvokeMocks() {
  invokeResults.clear();
}

/**
 * 默认的 invoke mock 实现
 * 如果命令已注册返回值则返回，否则 resolve undefined
 */
export const invokeMock = vi.fn(async (cmd: string) => {
  if (invokeResults.has(cmd)) {
    return invokeResults.get(cmd);
  }
  return undefined;
});

// ============ event mock ============

export const listenMock = vi.fn(async () => {
  // 返回 unlisten 函数
  return () => {};
});

export const emitMock = vi.fn(async () => {});
