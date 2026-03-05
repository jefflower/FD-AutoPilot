import React, { useEffect, useRef, useCallback } from 'react';
import { useAgentContext } from '../agents/AgentContext';
import { AgentRegistry } from '../agents/AgentRegistry';
import { taskApi } from '../services/serverApi';
import { getOrCreateClientId } from './mq-task/utils';
import type { TaskInstance, UserAgentConfigDTO } from '../types/server';

// ─── 常量 ────────────────────────────────────────────────────

/** 已有专用消费者的 agent code，不需要通用消费者处理 */
// 注意：MQTranslateAgentProvider / MQReplyAgentProvider 已从组件树移除，
// 所有 Agent 统一由 UniversalAgentConsumer 处理，不再排除任何 code。
const DEDICATED_CONSUMER_CODES = new Set<string>();

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 3_000;

/** 单次最多处理的任务数 */
const MAX_CONCURRENT = 1;

/** 任务执行超时（毫秒）—— 与 SyncBridge 的 10 分钟对齐 */
const EXEC_TIMEOUT_MS = 580_000; // 略小于后端 600s，留出网络开销

// ─── 工具函数 ────────────────────────────────────────────────

/** 从 taskType 提取 agentCode：  "agent.xxx" → "xxx" */
function extractAgentCode(taskType: string): string {
  return taskType.startsWith('agent.') ? taskType.slice(6) : taskType;
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms),
    ),
  ]);
}

// ─── 组件 ────────────────────────────────────────────────────

/**
 * 通用 Agent 任务消费者
 *
 * 约定：任何 AgentDefinition 只要 enabled=true 且不在 DEDICATED_CONSUMER_CODES 中，
 * 就自动按 agent code 轮询 claim 对应的 `agent.{code}` 类型任务，
 * 通过 AgentRegistry → Executor（Bridge / Tauri）执行，再上报结果。
 *
 * 新增 Agent 无需开发新消费者，只要注册 AgentDefinition 即可。
 */
export const UniversalAgentConsumer: React.FC = () => {
  const { definitions, manualAgentOverrides, canExecute, userAgentConfigs } = useAgentContext();
  const clientId = getOrCreateClientId();

  // 记录当前正在处理的任务 ID，避免重复执行
  const processingRef = useRef<Set<number>>(new Set());
  // 轮询锁：同一时间只允许一轮轮询
  const pollingRef = useRef(false);
  // 是否已启动
  const activeRef = useRef(false);
  // round-robin 指针
  const rrIndexRef = useRef(0);
  // 用户 Agent 配置 Ref（供 processTask 回调使用）
  const userAgentConfigsRef = useRef<UserAgentConfigDTO[]>(userAgentConfigs);
  userAgentConfigsRef.current = userAgentConfigs;

  // 筛选需要通用消费者处理的 agent 列表
  // 无执行能力时（纯网页端）返回空列表，不消费任务
  // 条件：有执行能力 且 enabled=true 且 轮询生效（手动覆盖优先，否则看 autoStart）且不在专用消费者中
  const genericAgents = canExecute
    ? definitions.filter(
        (d: { enabled: boolean; code: string; autoStart?: boolean }) => {
          if (!d.enabled) return false;
          if (DEDICATED_CONSUMER_CODES.has(d.code)) return false;
          // 查找用户的 Agent 配置
          const userConfig = userAgentConfigs.find(c => c.agentCode === d.code);
          if (!userConfig || !userConfig.enabled) return false; // 未订阅或用户级已禁用
          // 手动覆盖优先，否则用用户配置的 autoStart
          const shouldPoll = manualAgentOverrides.has(d.code)
            ? manualAgentOverrides.get(d.code)!
            : userConfig.autoStart;
          return shouldPoll;
        },
      )
    : [];

  // ── 执行单个任务 ──
  const processTask = useCallback(
    async (task: TaskInstance) => {
      const agentCode = extractAgentCode(task.taskType);
      console.log(
        `[UniversalAgent] Processing task ${task.id} for agent=${agentCode}`,
      );

      try {
        // 1. 解析 payload（SyncBridge payload 结构：{agentCode, syncMode, mergedConfig, resolvedPrompt}）
        // 服务端不再下发业务原始数据，客户端只需 resolvedPrompt + 执行配置
        const rawPayload = task.payload ? JSON.parse(task.payload) : {};
        const mergedConfig: Record<string, any> = rawPayload.mergedConfig || {};
        if (rawPayload.resolvedPrompt) {
          mergedConfig.resolvedPrompt = rawPayload.resolvedPrompt;
        }

        // 1.5. 合并用户自定义配置（最高优先级，覆盖 definition/instance 的默认值）
        const userCfg = userAgentConfigsRef.current.find(c => c.agentCode === agentCode);
        if (userCfg?.customConfig) {
          try {
            const custom = JSON.parse(userCfg.customConfig);
            Object.assign(mergedConfig, custom);
            console.log(`[UniversalAgent] Merged user customConfig for ${agentCode}:`, Object.keys(custom));
          } catch (e) {
            console.warn(`[UniversalAgent] Invalid customConfig JSON for ${agentCode}, skipped`);
          }
        }

        // 2. 通过 AgentRegistry 解析 executor
        const registry = AgentRegistry.getInstance();
        const resolved = registry.resolve(agentCode);

        if (!resolved) {
          throw new Error(`Agent "${agentCode}" 在 Registry 中未找到或不可用`);
        }

        // 3. 执行（带超时保护）
        const result = await withTimeout(
          resolved.executor.execute(resolved.definition, {
            data: {},
            params: mergedConfig,
          }),
          EXEC_TIMEOUT_MS,
          `Agent ${agentCode}`,
        );

        // 4. 上报结果
        const output =
          typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output);

        await taskApi.completeTask(task.id, {
          clientId,
          success: result.success,
          message: result.success ? output : result.error || 'Agent 执行失败',
        });

        console.log(
          `[UniversalAgent] Task ${task.id} completed (success=${result.success}), output length=${output.length}`,
        );
      } catch (err: any) {
        console.error(
          `[UniversalAgent] Task ${task.id} failed:`,
          err.message,
        );

        try {
          await taskApi.completeTask(task.id, {
            clientId,
            success: false,
            message: err.message || String(err),
          });
        } catch (reportErr) {
          console.error(
            `[UniversalAgent] Failed to report error for task ${task.id}:`,
            reportErr,
          );
        }
      } finally {
        processingRef.current.delete(task.id);
      }
    },
    [clientId],
  );

  // ── 单轮轮询：Round-Robin 遍历所有 generic agent，每轮只 claim 一个 ──
  const pollOnce = useCallback(async () => {
    if (pollingRef.current || !activeRef.current) return;
    if (genericAgents.length === 0) return;
    if (processingRef.current.size >= MAX_CONCURRENT) return;

    pollingRef.current = true;

    try {
      // Round-Robin：从上次停下的位置继续
      const startIdx = rrIndexRef.current % genericAgents.length;
      let tried = 0;

      while (tried < genericAgents.length) {
        const idx = (startIdx + tried) % genericAgents.length;
        const agent = genericAgents[idx];
        tried++;

        if (processingRef.current.size >= MAX_CONCURRENT) break;

        try {
          const claimed = await taskApi.claimTasks(
            `agent.${agent.code}`,
            clientId,
            1,
          );

          if (claimed.length > 0) {
            const task = claimed[0];
            if (!processingRef.current.has(task.id)) {
              processingRef.current.add(task.id);
              // 异步执行，不阻塞轮询
              processTask(task);
              rrIndexRef.current = idx + 1;
              break; // 每轮最多 claim 一个
            }
          }
        } catch (err: any) {
          // 单个 agent claim 失败不影响其他
          if (err?.message?.includes('401') || err?.message?.includes('403')) {
            // 认证失败，停止轮询
            console.error('[UniversalAgent] Auth error, stopping poll');
            activeRef.current = false;
            return;
          }
          // 其他错误静默跳过
        }
      }

      rrIndexRef.current = (startIdx + tried) % genericAgents.length;
    } finally {
      pollingRef.current = false;
    }
  }, [genericAgents, clientId, processTask]);

  // ── 启动轮询（canExecute 已在 genericAgents 过滤中保证，此处无需再检查 bridge） ──
  useEffect(() => {
    if (genericAgents.length === 0) {
      activeRef.current = false;
      return;
    }

    activeRef.current = true;
    console.log(
      `[UniversalAgent] 启动通用消费者，监听 ${genericAgents.length} 个 agent:`,
      genericAgents.map((a) => a.code).join(', '),
    );

    // 立即执行一次
    pollOnce();
    // 定时轮询
    const timer = setInterval(pollOnce, POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      clearInterval(timer);
    };
    // 仅在 agent 列表变化时重新启动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genericAgents.map((a) => a.code).join(',')]);

  // 无 UI 渲染
  return null;
};

export default UniversalAgentConsumer;
