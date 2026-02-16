/**
 * Tauri 桥接层：检测运行环境 + 条件加载 Tauri API。
 * Web 模式下所有 Tauri 调用返回空值/静默失败。
 */

export const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnv()) {
    throw new Error(`Tauri command "${cmd}" is not available in web mode`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

export async function tauriEmit(event: string, payload?: unknown): Promise<void> {
  if (!isTauriEnv()) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit(event, payload);
}

export async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauriEnv()) {
    return () => {}; // no-op unlisten
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<T>(event, (e) => handler(e.payload));
  return unlisten;
}
