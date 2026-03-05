/**
 * Agent Schema 工具
 */

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

/** 解析 agentConfig（字符串或对象） */
export function parseAgentConfig(config: string | Record<string, any>): Record<string, any> {
  if (typeof config === 'object' && config !== null) return config;
  try { return JSON.parse(config || '{}'); } catch { return {}; }
}
