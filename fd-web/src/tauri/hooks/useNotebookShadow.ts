import { useState, useEffect, useCallback } from 'react';
import { isTauriEnv, tauriInvoke, tauriListen } from '../bridge';

// 全局变量用于跨 Hook 实例共享状态，避免状态不一致
let globalShadowVisible = false;
const listeners = new Set<(visible: boolean) => void>();

const updateGlobalVisible = (visible: boolean) => {
  globalShadowVisible = visible;
  listeners.forEach(fn => fn(visible));
};

export const useNotebookShadow = () => {
  const [visible, setVisible] = useState(globalShadowVisible);

  useEffect(() => {
    const callback = (v: boolean) => setVisible(v);
    listeners.add(callback);

    // Web 模式下跳过 Tauri 初始化
    if (!isTauriEnv()) {
      return () => { listeners.delete(callback); };
    }

    // 初始化时同步一次状态
    tauriInvoke<boolean>('get_notebook_window_visibility')
      .then(v => updateGlobalVisible(v))
      .catch(err => console.error('[useNotebookShadow] Failed to get initial visibility:', err));

    // 监听后端的通知事件
    const unlistenPromise = tauriListen<boolean>('notebook-window-visibility-changed', (payload) => {
      console.log('[useNotebookShadow] Received visibility change:', payload);
      updateGlobalVisible(payload);
    });

    return () => {
      listeners.delete(callback);
      unlistenPromise.then(fn => fn());
    };
  }, []);

  /**
   * 切换影子窗口可见性
   * @param notebookId - NotebookLM ID（首次创建窗口时必需）
   * @param notebookUrl - NotebookLM URL（可选）
   */
  const toggle = useCallback(async (notebookId?: string, notebookUrl?: string) => {
    if (!isTauriEnv()) {
      console.warn('[useNotebookShadow] Shadow window is not available in web mode');
      return;
    }
    const nextValue = !globalShadowVisible;
    try {
      await tauriInvoke('toggle_notebook_window', {
        visible: nextValue,
        notebookId: notebookId || null,
        notebookUrl: notebookUrl || null
      });
      // toggle_notebook_window 会触发 notebook-window-visibility-changed 事件，
      // 所以这里不需要手动调用 updateGlobalVisible(nextValue)，
      // 依赖事件驱动以保证状态绝对同步。
    } catch (err) {
      console.error('[useNotebookShadow] Failed to toggle window:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauriEnv()) return;
    try {
      const v = await tauriInvoke<boolean>('get_notebook_window_visibility');
      updateGlobalVisible(v);
    } catch (err) {
      console.error('[useNotebookShadow] Failed to refresh visibility:', err);
    }
  }, []);

  return { visible, toggle, refresh };
};
