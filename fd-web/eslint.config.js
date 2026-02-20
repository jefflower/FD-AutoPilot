import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 全局忽略
  {
    ignores: ['dist/', 'node_modules/', '*.config.*'],
  },

  // 基础 JS 推荐规则（降级为 warn）
  {
    ...js.configs.recommended,
    rules: Object.fromEntries(
      Object.entries(js.configs.recommended.rules || {}).map(([key, val]) => [
        key,
        val === 'error' || val === 2 ? 'warn' : val,
      ])
    ),
  },

  // TypeScript 推荐规则（降级为 warn）
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    rules: config.rules
      ? Object.fromEntries(
          Object.entries(config.rules).map(([key, val]) => [
            key,
            val === 'error' || val === 2 ? 'warn' : val,
          ])
        )
      : undefined,
  })),

  // 项目级规则覆盖
  {
    rules: {
      // 项目大量使用 any，关闭此规则
      '@typescript-eslint/no-explicit-any': 'off',
      // 允许下划线前缀的未使用变量
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }
);
