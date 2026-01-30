import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
    
    // 初始化时同步一次状态
    invoke<boolean>('get_notebook_window_visibility')
      .then(v => updateGlobalVisible(v))
      .catch(err => console.error('[useNotebookShadow] Failed to get initial visibility:', err));

    // 监听后端的通知事件
    const unlisten = listen<boolean>('notebook-window-visibility-changed', (event) => {
      console.log('[useNotebookShadow] Received visibility change:', event.payload);
      updateGlobalVisible(event.payload);
    });

    return () => {
      listeners.delete(callback);
      unlisten.then(fn => fn());
    };
  }, []);

  const toggle = useCallback(async () => {
    const nextValue = !globalShadowVisible;
    try {
      await invoke('toggle_notebook_window', { visible: nextValue });
      // toggle_notebook_window 会触发 notebook-window-visibility-changed 事件，
      // 所以这里不需要手动调用 updateGlobalVisible(nextValue)，
      // 依赖事件驱动以保证状态绝对同步。
    } catch (err) {
      console.error('[useNotebookShadow] Failed to toggle window:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const v = await invoke<boolean>('get_notebook_window_visibility');
      updateGlobalVisible(v);
    } catch (err) {
      console.error('[useNotebookShadow] Failed to refresh visibility:', err);
    }
  }, []);

  return { visible, toggle, refresh };
};
