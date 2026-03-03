import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { invokeMock, listenMock, emitMock, clearInvokeMocks } from './tauriMock';

// ============ Mock @tauri-apps/api/core ============
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

// ============ Mock @tauri-apps/api/event ============
vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
  emit: emitMock,
  TauriEvent: {
    WINDOW_RESIZED: 'tauri://resize',
    WINDOW_MOVED: 'tauri://move',
    WINDOW_CLOSE_REQUESTED: 'tauri://close-requested',
  },
}));

// ============ Mock @tauri-apps/plugin-dialog ============
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

// ============ Mock react-i18next ============
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // 返回 key 本身，带 defaultValue 时返回 defaultValue
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        return opts.defaultValue as string;
      }
      return key;
    },
    i18n: {
      language: 'zh-CN',
      changeLanguage: vi.fn(),
    },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ============ Cleanup ============
afterEach(() => {
  cleanup();
  clearInvokeMocks();
  localStorage.clear();
  vi.restoreAllMocks();
});
