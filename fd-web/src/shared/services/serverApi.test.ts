import { describe, it, expect, beforeEach } from 'vitest';
import { isTokenExpired, setAuthToken, getAuthToken } from './serverApi';

// 生成一个 JWT token（仅含 payload，签名无意义）
function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('isTokenExpired', () => {
  it('未过期的 token 返回 false', () => {
    // exp 设为 1 小时后
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('已过期的 token 返回 true', () => {
    // exp 设为 1 小时前
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('即将过期的 token（30 秒内）返回 true', () => {
    // exp 设为 10 秒后（在 30 秒缓冲期内）
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('没有 exp 字段的 token 返回 false', () => {
    const token = makeToken({ sub: 'user123' });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('畸形 token（不是 3 段）返回 true', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(true);
    expect(isTokenExpired('only.two')).toBe(true);
  });

  it('payload 不是有效 base64 返回 true', () => {
    expect(isTokenExpired('a.!!!invalid!!!.c')).toBe(true);
  });
});

describe('setAuthToken / getAuthToken', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置模块内部状态：先设 null 清除缓存
    setAuthToken(null);
  });

  it('设置并读取 token', () => {
    setAuthToken('my-token-123');
    expect(getAuthToken()).toBe('my-token-123');
  });

  it('token 持久化到 localStorage', () => {
    setAuthToken('persisted-token');
    expect(localStorage.getItem('fd_auth_token')).toBe('persisted-token');
  });

  it('设置 null 清除 token', () => {
    setAuthToken('temp-token');
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem('fd_auth_token')).toBeNull();
  });

  it('从 localStorage 恢复 token', () => {
    // 模拟页面刷新后的状态：先清除内存缓存
    setAuthToken(null);
    // 直接写 localStorage
    localStorage.setItem('fd_auth_token', 'restored-token');
    expect(getAuthToken()).toBe('restored-token');
  });
});
