import { describe, it, expect } from 'vitest';
import { getTicketStatusLabel, getUserStatusLabel, getUserRoleLabel, getTicketStatusOptions } from './statusLabels';

// mock t 函数：模拟 i18next 行为，返回 key 或 defaultValue
const mockT = (key: string, opts?: { ns?: string; defaultValue?: string }) => {
  if (opts?.defaultValue) return opts.defaultValue;
  return key;
};

describe('getTicketStatusLabel', () => {
  it('已知状态使用正确的 key 调用 t 函数', () => {
    // getTicketStatusLabel 传入 defaultValue: status，所以 mockT 返回 defaultValue
    const result = getTicketStatusLabel(mockT, 'PENDING_TRANS');
    expect(result).toBe('PENDING_TRANS');
  });

  it('未知状态返回 defaultValue（即状态本身）', () => {
    const result = getTicketStatusLabel(mockT, 'UNKNOWN_STATUS');
    // defaultValue 被设置为 status 本身
    expect(result).toBe('UNKNOWN_STATUS');
  });
});

describe('getUserStatusLabel', () => {
  it('返回用户状态翻译 key', () => {
    expect(getUserStatusLabel(mockT, 'APPROVED')).toBe('APPROVED');
  });
});

describe('getUserRoleLabel', () => {
  it('返回角色翻译 key', () => {
    expect(getUserRoleLabel(mockT, 'ADMIN')).toBe('ADMIN');
  });
});

describe('getTicketStatusOptions', () => {
  it('返回包含全部状态加一个"全部"选项', () => {
    const options = getTicketStatusOptions(mockT);
    // "全部" + 5 个状态 = 6
    expect(options).toHaveLength(6);
  });

  it('第一个选项的 value 为空（全部筛选）', () => {
    const options = getTicketStatusOptions(mockT);
    expect(options[0].value).toBe('');
  });

  it('每个选项都有 value, label, color', () => {
    const options = getTicketStatusOptions(mockT);
    for (const opt of options) {
      expect(opt).toHaveProperty('value');
      expect(opt).toHaveProperty('label');
      expect(opt).toHaveProperty('color');
      expect(typeof opt.color).toBe('string');
    }
  });

  it('包含所有预期状态', () => {
    const options = getTicketStatusOptions(mockT);
    const values = options.map(o => o.value);
    expect(values).toContain('PENDING_TRANS');
    expect(values).toContain('PROCESSING');
    expect(values).toContain('PENDING_AUDIT');
    expect(values).toContain('APPROVED');
    expect(values).toContain('COMPLETED');
  });
});
