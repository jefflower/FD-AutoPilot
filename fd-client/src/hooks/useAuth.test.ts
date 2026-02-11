import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

// Mock serverApi 模块
vi.mock('../services/serverApi', () => {
  let _token: string | null = null;

  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    authApi: {
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      checkAdmin: vi.fn(),
      initAdmin: vi.fn(),
      superResetPassword: vi.fn(),
    },
    getAuthToken: () => _token,
    setAuthToken: (t: string | null) => {
      _token = t;
      if (t) {
        localStorage.setItem('fd_auth_token', t);
      } else {
        localStorage.removeItem('fd_auth_token');
      }
    },
    isTokenExpired: vi.fn(() => false),
    getServerBaseUrl: () => 'http://localhost:9988',
    setServerBaseUrl: vi.fn(),
  };
});

// 在 mock 之后动态引入
const getServerApiMock = async () => {
  const mod = await import('../services/serverApi');
  return {
    authApi: mod.authApi as {
      login: ReturnType<typeof vi.fn>;
      register: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
      checkAdmin: ReturnType<typeof vi.fn>;
      initAdmin: ReturnType<typeof vi.fn>;
      superResetPassword: ReturnType<typeof vi.fn>;
    },
    isTokenExpired: mod.isTokenExpired as ReturnType<typeof vi.fn>,
    setAuthToken: mod.setAuthToken,
  };
};

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('初始状态：未登录', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it('初始化加载完成后 isLoading 为 false', async () => {
    const { result } = renderHook(() => useAuth());
    // useEffect 异步完成后
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('login 成功后更新状态', async () => {
    const mocks = await getServerApiMock();
    const mockUser = { id: 1, username: 'testuser', role: 'USER', status: 'APPROVED' };
    mocks.authApi.login.mockResolvedValue({
      token: 'test-jwt-token',
      user: mockUser,
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login({ username: 'testuser', password: 'pass123' });
    });

    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('admin 用户登录后 isAdmin 为 true', async () => {
    const mocks = await getServerApiMock();
    const adminUser = { id: 1, username: 'admin', role: 'ADMIN', status: 'APPROVED' };
    mocks.authApi.login.mockResolvedValue({
      token: 'admin-token',
      user: adminUser,
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login({ username: 'admin', password: 'pass' });
    });

    expect(result.current.isAdmin).toBe(true);
  });

  it('login 失败后设置 error', async () => {
    const mocks = await getServerApiMock();
    mocks.authApi.login.mockRejectedValue(new Error('用户名或密码错误'));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      try {
        await result.current.login({ username: 'bad', password: 'bad' });
      } catch {
        // expected
      }
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.error).toBe('用户名或密码错误');
  });

  it('logout 清除所有状态', async () => {
    const mocks = await getServerApiMock();
    const mockUser = { id: 1, username: 'user', role: 'USER', status: 'APPROVED' };
    mocks.authApi.login.mockResolvedValue({ token: 'tok', user: mockUser });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login({ username: 'user', password: 'pass' });
    });
    expect(result.current.isLoggedIn).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it('clearError 清除错误消息', async () => {
    const mocks = await getServerApiMock();
    mocks.authApi.login.mockRejectedValue(new Error('err'));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      try {
        await result.current.login({ username: 'x', password: 'x' });
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBe('err');

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
