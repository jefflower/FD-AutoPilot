/**
 * Tauri 桥接层：检测运行环境 + 条件加载 Tauri API。
 *
 * - Tauri 桌面模式：通过 IPC 直接调用 Rust 命令
 * - Web 浏览器模式：AI 命令通过 HTTP bridge 调用本地 fd-bridge 服务器，
 *   Shadow Window 等 Tauri 专属命令优雅降级
 */

export const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// HTTP bridge 命令到端点的映射（仅 CLI Agent 命令）
const BRIDGE_CMD_MAP: Record<string, string> = {
  translate_ticket_direct_cmd: '/bridge/translate',
  execute_gemini_cmd: '/bridge/gemini',
  sync_translate_reply_cmd: '/bridge/sync-translate',
};

// bridge server 可用性缓存
let bridgeAvailable: boolean | null = null;

export async function checkBridgeAvailable(): Promise<boolean> {
  if (bridgeAvailable !== null) return bridgeAvailable;
  try {
    const resp = await fetch('/bridge/health', { signal: AbortSignal.timeout(2000) });
    bridgeAvailable = resp.ok;
  } catch {
    bridgeAvailable = false;
  }
  // 30 秒后重新探测（支持 bridge server 后启动的情况）
  setTimeout(() => { bridgeAvailable = null; }, 30000);
  return bridgeAvailable;
}

async function bridgeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const path = BRIDGE_CMD_MAP[cmd];
  if (!path) {
    throw new Error(
      `Tauri command "${cmd}" is not available in web mode (no HTTP bridge mapping)`
    );
  }

  const isAvailable = await checkBridgeAvailable();
  if (!isAvailable) {
    throw new Error(
      `fd-bridge server is not running. Start with: cargo run --bin fd-bridge --no-default-features --manifest-path fd-client/src-tauri/Cargo.toml`
    );
  }

  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });

  const json = await resp.json();
  if (!json.success) {
    throw new Error(json.error || `Bridge call failed: ${cmd}`);
  }
  return json.data as T;
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriEnv()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
  }
  // Web 模式：尝试 HTTP bridge
  return bridgeInvoke<T>(cmd, args);
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
