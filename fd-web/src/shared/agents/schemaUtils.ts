import type { StandardAgentInput } from '../types/server';

/**
 * Agent Schema 工具
 */

/** 从工单数据 + inputSchema 自动构建标准化输入 */
export function buildInputFromTicket(
  schema: Record<string, any>,
  ticket: any,
  extraParams?: Record<string, any>
): StandardAgentInput {
  const input: StandardAgentInput = {};
  const props = schema.properties || {};

  // 如果 schema 要求 ticket 字段
  if (props.ticket) {
    input.ticket = {
      id: ticket.id,
      subject: ticket.subject || '',
      content: ticket.content || '',
    };
  }

  // 如果 schema 要求 targetLang
  if (props.targetLang && extraParams?.targetLang) {
    input.targetLang = extraParams.targetLang;
  }

  // 如果 schema 要求 lastAuditRemark
  if (props.lastAuditRemark) {
    input.lastAuditRemark = ticket.lastAuditRemark || extraParams?.lastAuditRemark || '';
  }

  // 如果 schema 要求 trackingNumbers
  if (props.trackingNumbers && extraParams?.trackingNumbers) {
    input.trackingNumbers = extraParams.trackingNumbers;
  }

  // 合并其他 extraParams（但不覆盖已设置的字段）
  if (extraParams) {
    for (const key of Object.keys(extraParams)) {
      if (props[key] && !(key in input)) {
        input[key] = extraParams[key];
      }
    }
  }

  return input;
}

/** 轻量级 Schema 校验（检查 required 字段是否存在） */
export function validateInput(
  schema: Record<string, any>,
  data: any
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const required = schema.required || [];

  for (const field of required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  // 递归检查 nested required
  const props = schema.properties || {};
  for (const [key, propSchema] of Object.entries(props)) {
    if (data[key] && typeof data[key] === 'object' && typeof propSchema === 'object') {
      const nested = propSchema as Record<string, any>;
      if (nested.required && nested.type === 'object') {
        const nestedResult = validateInput(nested, data[key]);
        if (!nestedResult.valid) {
          errors.push(...nestedResult.errors.map(e => `${key}.${e}`));
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 模板变量替换：${VAR_NAME} -> actual value */
export function resolveTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // 支持 ${KEY} 格式
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/** 解析 agentConfig（字符串或对象） */
export function parseAgentConfig(config: string | Record<string, any>): Record<string, any> {
  if (typeof config === 'object' && config !== null) return config;
  try { return JSON.parse(config || '{}'); } catch { return {}; }
}
