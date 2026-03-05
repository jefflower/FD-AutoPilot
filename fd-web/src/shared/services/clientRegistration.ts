/**
 * 客户端注册与心跳服务
 *
 * 负责将 Web/Tauri 客户端注册到服务端，并维持周期性心跳。
 * 心跳间隔 30 秒，每次心跳会上报当前运行中的 Agent 列表。
 *
 * v0.4 增强：
 * - 心跳失败自动重试（最多 3 次，指数退避 1s→2s→4s）
 * - 注册失败自动重试（最多 3 次，指数退避 1s→2s→4s）
 * - 心跳状态暴露（connected / disconnected / retrying）
 * - 连续 3 次心跳周期全部失败后标记 disconnected
 */
import { clientApi } from './serverApi';
import { isTauriEnv } from '../../tauri/bridge';
import type { CapabilityDefinition, ClientSkillItem } from '../types/server';

// ============ 类型定义 ============

export type HeartbeatStatus = 'connected' | 'disconnected' | 'retrying';

// ============ 私有状态 ============

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let registered = false;

/** 当前心跳状态 */
let _heartbeatStatus: HeartbeatStatus = 'disconnected';

/** 连续心跳周期失败计数（每个周期内所有重试都失败才 +1） */
let consecutiveFailures = 0;

/** 最大连续失败次数，超过此值标记为 disconnected */
const MAX_CONSECUTIVE_FAILURES = 3;

/** 每次操作（心跳/注册）的最大重试次数 */
const MAX_RETRIES = 3;

/** 基础退避间隔（毫秒） */
const BASE_BACKOFF_MS = 1000;

/** 心跳是否已停止（用于阻止卸载后的异步重试继续执行） */
let heartbeatStopped = true;

/** 心跳执行函数引用（供 triggerImmediateHeartbeat 使用） */
let heartbeatFn: (() => Promise<void>) | null = null;

/** 状态变化监听器列表 */
type StatusListener = (status: HeartbeatStatus) => void;
const statusListeners: Set<StatusListener> = new Set();

// ============ ClientId 工具函数 ============

const CLIENT_ID_KEY = 'fd_task_client_id';

/**
 * 获取或创建客户端唯一标识（与 createMQTaskContext 中的逻辑一致）
 */
export function getOrCreateClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

// ============ 客户端类型检测 ============

function determineClientType(canExecute: boolean): 'TAURI' | 'WEB' | 'BRIDGE' {
  if (isTauriEnv()) return 'TAURI';
  if (canExecute) return 'BRIDGE'; // 有 bridge 执行能力但非原生 Tauri（如 Tauri 加载远程 URL）
  return 'WEB';
}

// ============ 内部工具函数 ============

/**
 * 更新心跳状态并通知监听器
 */
function setHeartbeatStatus(status: HeartbeatStatus): void {
  if (_heartbeatStatus !== status) {
    _heartbeatStatus = status;
    statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (e) {
        console.warn('[ClientRegistration] Status listener error:', e);
      }
    });
  }
}

/**
 * 带指数退避的重试执行器
 * @param fn 要执行的异步操作
 * @param label 日志标签
 * @param shouldAbort 每次重试前检查是否应中止（用于组件卸载场景）
 * @returns 操作结果，所有重试都失败时返回 null
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  shouldAbort?: () => boolean,
): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 检查是否应中止
    if (shouldAbort?.()) {
      console.log(`[ClientRegistration] ${label} aborted (stopped)`);
      return null;
    }

    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES - 1;
      if (isLastAttempt) {
        console.error(`[ClientRegistration] ${label} failed after ${MAX_RETRIES} attempts:`, err);
        return null;
      }

      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt); // 1s → 2s → 4s
      console.warn(
        `[ClientRegistration] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${delay}ms:`,
        err,
      );

      // 等待退避间隔
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

// ============ 公共 API ============

/**
 * 注册客户端到服务端（失败自动重试最多 3 次，指数退避）
 * @param capabilities 已加载的 CapabilityDefinition 列表
 * @param runningAgents 当前正在运行的 Agent code 列表
 * @param canExecute 当前环境是否具有执行能力（用于区分 BRIDGE / WEB 类型）
 * @param detectedSkills 客户端检测到的 AI Skills，按 capability 分组
 * @returns 注册响应（包含在线客户端数量），所有重试都失败时返回 null
 */
export async function registerClient(
  capabilities: CapabilityDefinition[],
  runningAgents: string[] = [],
  canExecute: boolean = false,
  detectedSkills?: Record<string, ClientSkillItem[]>,
): Promise<{ onlineClients: number } | null> {
  const clientId = getOrCreateClientId();
  const enabledCapabilities = capabilities
    .filter(c => c.enabled)
    .map(c => c.code);
  const clientType = determineClientType(canExecute);

  const result = await withRetry(
    async () => {
      const response = await clientApi.register({
        clientId,
        clientType,
        version: '0.4.0',
        enabledCapabilities,
        runningAgents,
        detectedSkills,
      });
      return response;
    },
    'Registration',
  );

  if (result) {
    registered = true;
    setHeartbeatStatus('connected');
    console.log('[ClientRegistration] Registered successfully, onlineClients:', result.onlineClients);
    return { onlineClients: result.onlineClients };
  }

  // 所有重试都失败，返回 null（不抛异常）
  return null;
}

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 30000;

/**
 * 启动心跳定时器（30 秒间隔，每次心跳失败自动重试）
 * @param getRunningAgents 获取当前运行中 Agent code 列表的回调
 * @returns 清理函数（用于组件卸载时停止心跳）
 */
export function startHeartbeat(getRunningAgents: () => string[]): () => void {
  stopHeartbeat(); // 先清理旧的

  heartbeatStopped = false;
  consecutiveFailures = 0;

  // 提取心跳逻辑为独立函数，供定时器和立即触发共用
  const doHeartbeat = async () => {
    const clientId = getOrCreateClientId();

    // 标记为 retrying（如果当前不是 connected 状态）
    if (_heartbeatStatus === 'disconnected') {
      setHeartbeatStatus('retrying');
    }

    const result = await withRetry(
      async () => {
        await clientApi.heartbeat({
          clientId,
          runningAgents: getRunningAgents(),
        });
        return true;
      },
      'Heartbeat',
      () => heartbeatStopped,
    );

    if (heartbeatStopped) return; // 心跳已停止，忽略结果

    if (result) {
      // 心跳成功：重置连续失败计数，恢复 connected
      consecutiveFailures = 0;
      setHeartbeatStatus('connected');
    } else {
      // 本周期所有重试都失败：累计失败
      consecutiveFailures++;
      console.warn(
        `[ClientRegistration] Heartbeat cycle failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        setHeartbeatStatus('disconnected');
      } else {
        setHeartbeatStatus('retrying');
      }
    }
  };

  // 保存心跳函数引用，供 triggerImmediateHeartbeat 使用
  heartbeatFn = doHeartbeat;

  heartbeatTimer = setInterval(doHeartbeat, HEARTBEAT_INTERVAL);

  // 监听 Agent 变更事件，立即触发心跳
  const handleAgentChanged = () => triggerImmediateHeartbeat();
  window.addEventListener('fd:agent-changed', handleAgentChanged);

  // 返回清理函数
  return () => {
    window.removeEventListener('fd:agent-changed', handleAgentChanged);
    stopHeartbeat();
  };
}

/**
 * 停止心跳定时器
 */
export function stopHeartbeat(): void {
  heartbeatStopped = true;
  heartbeatFn = null;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 检查客户端是否已注册
 */
export function isRegistered(): boolean {
  return registered;
}

/**
 * 获取当前心跳状态
 */
export function getHeartbeatStatus(): HeartbeatStatus {
  return _heartbeatStatus;
}

/**
 * 订阅心跳状态变化
 * @param listener 状态变化回调
 * @returns 取消订阅函数
 */
export function onHeartbeatStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * 立即触发一次心跳，不等待下一个 interval。
 * 同时重置 interval 计时器，避免短时间内重复心跳。
 */
export function triggerImmediateHeartbeat(): void {
  if (!heartbeatFn || heartbeatStopped) {
    console.log('[ClientRegistration] triggerImmediateHeartbeat skipped (heartbeat not running)');
    return;
  }

  console.log('[ClientRegistration] Triggering immediate heartbeat due to agent change');

  // 立即执行心跳
  heartbeatFn();

  // 重置 interval 计时器，避免短时间内重复心跳
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(heartbeatFn, HEARTBEAT_INTERVAL);
  }
}

/**
 * 派发 Agent 变更事件。
 * 供 Agent 管理页面和 AgentContext 在 Agent 注册/注销/启停/变更后调用，
 * 触发心跳服务立即上报最新的 Agent 列表。
 */
export function dispatchAgentChanged(): void {
  window.dispatchEvent(new CustomEvent('fd:agent-changed'));
}
